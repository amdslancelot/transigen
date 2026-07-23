# Shared data plane (`data` namespace) — transigen's view

Transigen stores its data in the shared PostgreSQL server that gelp introduced:
one Postgres 17 StatefulSet in the `data` namespace serving every app on the
node, with one database and one least-privilege login role per app. Transigen's
slice is database `transigen`, role `transigen_rw`, reachable at
`postgres.data.svc.cluster.local:5432/transigen`.

`base/` here is a **verbatim copy of gelp's `deploy/k8s/data/base`** (same
files, same generated ConfigMap hash) so that on the shared staging minikube
either repo can apply the data plane without disturbing the other. The full
design rationale lives in gelp's `deploy/k8s/data/README.md`.

## Staging (minikube)

`deploy/stage.sh` applies `overlays/staging` (PROVISION_APPS covers both gelp
and transigen; the committed dev secret carries both passwords) and then
re-runs the provisioning script for transigen explicitly, which also covers a
Postgres volume that was initialised before transigen existed:

```sh
kubectl -n data exec postgres-0 -- \
  env PROVISION_APPS="transigen" TRANSIGEN_DB_PASSWORD=transigen \
  bash /docker-entrypoint-initdb.d/10-provision-apps.sh
```

Note one cross-repo wrinkle: gelp's own staging overlay sets
`PROVISION_APPS: "gelp"` and a secret without `TRANSIGEN_DB_PASSWORD`, so
whichever repo's `stage.sh` ran last owns those two objects (last apply wins).
That is harmless on the common path — the explicit re-run above provisions
transigen regardless — but if the Postgres volume is wiped while gelp's
version is the applied one, a fresh init provisions only gelp until
transigen's `stage.sh` runs again. Aligning gelp's staging overlay to list
both apps would remove the wrinkle; that change belongs in the gelp repo.

## Prod (shared OCI k3s server)

There is **no prod data overlay in this repo**: the prod data plane — the
StatefulSet, its server-local `postgres-secret.yaml`, and `PROVISION_APPS` —
is owned and applied by the gelp checkout on the server (`/opt/gelp`).
Transigen's `deploy/deploy.sh` only checks that the shared Postgres is ready;
it never applies data-plane manifests in prod.

`deploy/setup-app.sh` performs transigen's one-time prod provisioning: it
re-runs the provisioning script with `TRANSIGEN_DB_PASSWORD`, and appends that
key to the server-local `/opt/gelp/deploy/k8s/data/overlays/prod/postgres-secret.yaml`
so a future Postgres volume re-initialisation still provisions transigen. Two
follow-ups belong in the gelp repo (out of transigen's control): adding
`transigen` to the prod `PROVISION_APPS` patch and
`TRANSIGEN_DB_PASSWORD` to its `postgres-secret.example.yaml`.
