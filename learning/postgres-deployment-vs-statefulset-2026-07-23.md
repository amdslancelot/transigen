# Why the shared Postgres is a Deployment, not a StatefulSet (2026-07-23)

This note records the reasoning behind commit `d12cdbc2` ("Converge on the
snoopy_home-owned Postgres data plane; drop the StatefulSet") so the decision
does not get relitigated from first principles later.

## The situation that forced the question

Three apps (snoopy, gelp, transigen) share one Postgres server per cluster in
a neutral `data` namespace, per the role-isolation design in
`snoopy_home/docs/PLAN-postgres-role-isolation.md`. When transigen's dev setup
was being aligned with that design, the repos turned out to disagree about who
owns the data-plane manifests and what kind they are:

- **snoopy_home** shipped a `postgres:17` **Deployment** (`replicas: 1`,
  `strategy: Recreate`, one PVC) and had already applied it in both clusters.
  The live minikube staging instance and the live OCI k3s prod instance were
  both this Deployment.
- **gelp** had **no Postgres manifests at all** anymore. Its `stage.sh` and
  `deploy.sh` only preflight-check that `svc postgres` exists in `data` and
  name snoopy_home as the owner.
- **transigen** carried a **StatefulSet** under `deploy/k8s/data/`, described
  in its own README as "a verbatim copy of gelp's data/base" — a copy of a
  gelp version that no longer existed. Its `stage.sh` waited on
  `statefulset/postgres` and exec'd into `postgres-0`.

Running transigen's `stage.sh` in this state would have applied a StatefulSet
next to the live Deployment. Both workloads carry the same `app: postgres`
labels, so the Service would have load-balanced connections across two
different Postgres servers with different data — intermittent, very confusing
breakage.

## What a StatefulSet actually buys a database, and why it does not matter here

1. **Stable pod name.** The pod is always `postgres-0`, so runbooks and
   scripts can hardcode it. A Deployment pod name changes every rollout; you
   target `deploy/postgres` instead. Purely a convention difference.
2. **At-most-one-pod semantics.** A StatefulSet never starts a replacement pod
   until the old one is confirmed dead. This is the real safety argument: two
   postgres processes on one data directory corrupt it. But a *default*
   RollingUpdate Deployment is the only dangerous shape — snoopy's manifest
   sets `strategy: Recreate`, which kills the old pod before starting the new
   one. On a single-node cluster with one replica and an RWO volume, a
   Recreate-Deployment and a StatefulSet behave identically in practice.
3. **volumeClaimTemplates.** Per-replica PVCs matter only if you scale out
   replicas, which a single shared instance at this scale never will.

So at one replica on one node with `strategy: Recreate`, the StatefulSet is
convention rather than correctness. Choosing it would still have been fine on
a green field — but the field was not green.

## The deciding fact

Both clusters were already live on snoopy's Deployment, with real data
(snoopy prod had completed its SQLite-to-Postgres migration onto it; staging
held snoopy, gelp, and by then transigen's databases). Converging on the
StatefulSet would have meant dump-and-restore migrations of healthy databases
in two clusters purely to change the workload kind. Converging on the
Deployment meant editing manifests and scripts in one repo and touching no
data anywhere. The ecosystem had also effectively voted already: gelp had
deleted its manifests and deferred to snoopy_home.

**Decision: snoopy_home owns the data-plane manifests (the Deployment);
transigen ships no data-plane manifests at all and only provisions its own
slice into the running instance.**

## What changed in this repo

- `deploy/k8s/data/` deleted entirely.
- The idempotent per-app provisioning script survived as
  `deploy/provision-db.sh` (it was the best provisioning tool of the three
  repos — role + database + `REVOKE CONNECT` isolation hardening). It is now
  piped over `kubectl exec` into `deploy/postgres` instead of assuming a
  `postgres-0` pod.
- `stage.sh`, `deploy.sh`, and `setup-app.sh` preflight-check
  `deployment/postgres -n data` and point at snoopy_home
  (`deploy/setup-minikube.sh` for staging, `docs/prod-k3s-runbook.md` for
  prod) when it is missing.
- One capability was consciously given up: the StatefulSet mounted the
  provisioning script into `/docker-entrypoint-initdb.d`, so a re-initialised
  volume would re-provision apps automatically. Snoopy's Deployment has no
  such hook. A re-initialised volume now requires re-running
  `deploy/provision-db.sh` per app and restoring from backup, which
  `setup-app.sh` and the script header document.

## Lessons

- **"Verbatim copy of another repo" manifests rot silently.** Transigen's
  copy outlived the original it was copied from. If another repo owns shared
  infrastructure, reference it (preflight-check plus a pointer to the owning
  repo), do not vendor it.
- **Check what is actually running before applying "the design".** The
  StatefulSet was the documented plan; the Deployment was reality in both
  clusters. `kubectl get deploy,statefulset -n data` before the first apply
  prevented a two-Postgres split-brain behind one Service.
- **Workload-kind arguments are contextual.** "Databases should be
  StatefulSets" is a good default that stops mattering at
  one-replica-one-node-Recreate scale, and stops being worth a data migration
  the moment real data is live on the other shape.
