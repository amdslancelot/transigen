# Transigen deployment

This directory mirrors gelp's deploy setup (the same stage/prod pattern; see
`/opt/gelp` on the node or the gelp repo's `deploy/`): a container image
built locally with no registry, Kustomize base + `staging`/`prod` overlays,
a manual minikube staging deploy, and a webhook-driven prod deploy onto the
shared k3s node the **`platform`** repo bootstraps and owns (k3s/Traefik, the
webhook listener, the `*.lans-h.cc` wildcard TLS cert, and the shared Postgres).

Data lives in the **shared PostgreSQL** server in the `data` namespace: every
app on the node gets its own database and least-privilege role. The data plane
itself (a single `postgres:17` Deployment + Service, identical shape in both
clusters) is **owned by the snoopy_home repo** — `deploy/setup-minikube.sh`
there stands it up on staging, `docs/prod-k3s-runbook.md` on prod. Transigen
never applies data-plane manifests; it only provisions its own slice
(database `transigen`, role `transigen_rw`) into the running instance via
`deploy/provision-db.sh`, connects at
`postgres.data.svc.cluster.local:5432/transigen`, and applies its own SQL
migrations lazily on first DB use (`src/lib/db.ts`), so deploys need no
separate migrate step.

**Dev shares the staging data plane**: local development has no standalone
Postgres. It reaches the same minikube `data`-namespace instance through
`kubectl -n data port-forward svc/postgres 54321:5432`, connecting as
`transigen_rw` (the superuser is provisioning-only, never an app credential).
See the root `README.md` setup section.

## Layout

- `Dockerfile` — multi-stage build producing the `transigen` runtime image from
  the Next.js standalone output (plus sharp for image optimization and the
  `db/migrations/` folder for runtime migrations).
- `k8s/base/` — namespace-agnostic app manifests: Deployment, Service, Ingress
  (plain HTTP). Probes hit `/api/health`.
- `provision-db.sh` — idempotent per-app database/role provisioning (with
  `REVOKE CONNECT` isolation hardening), piped into the shared postgres pod
  over `kubectl exec`. Used by `stage.sh` for the local **minikube staging**
  data plane; **prod** DB provisioning is the platform repo's job
  (`cluster/data-postgres/provision-db.sh`, `PROVISION_APPS="transigen"`). The
  data-plane manifests themselves live in the snoopy_home repo, not here.
- `k8s/overlays/staging/` — minikube, namespace `transigen-staging`, image tag
  `staging`, host `transigen.staging.localhost`.
- `k8s/overlays/prod/` — shared k3s node, namespace `transigen`, image tag
  `latest`, host `${TRANSIGEN_HOST}`. TLS is the platform's `*.lans-h.cc`
  wildcard cert (Traefik's default certificate) — no per-app ClusterIssuer or
  `tls` block.
- `.env.staging.example` / `.env.prod.example` — committed templates for the
  `transigen-env` Secret, following snoopy_home's password policy: **no real
  secrets are committed.** Copy each to its gitignored sibling and fill in real
  values — `deploy/.env.prod` on the server, and `deploy/.env.staging` for local
  staging (stage.sh falls back to the committed `.env.staging.example` if you
  don't create one, so a fresh clone still works). The Secret is created from
  the env file at deploy time — no Secret YAML anywhere.
- `stage.sh` — build with podman → load into minikube → verify the shared
  data plane + provision the transigen DB → apply the staging overlay.
- `deploy.sh` — prod build-and-deploy on the node; run by the platform's shared
  webhook listener on every push to `main`, and safe to run by hand.
- `setup-app.sh` — one-time onboarding of transigen onto a node the **platform**
  repo has already bootstrapped (checkout, app config, first deploy). Node
  bootstrap, the webhook listener + `deploy-transigen` hook, wildcard TLS, and
  prod DB provisioning are the platform repo's, not here.

## Staging (local minikube)

Prereqs (one-time, shared with gelp's staging): a running minikube with a
native driver, Traefik for ingress, and the snoopy_home-owned data plane:

```sh
minikube start --driver=vfkit
helm repo add traefik https://traefik.github.io/charts && helm install traefik traefik/traefik
# Shared Postgres in namespace `data` — owned by the snoopy_home repo:
#   snoopy_home/deploy/setup-minikube.sh
```

Then each deploy:

```sh
deploy/stage.sh
```

Reach the app with `kubectl -n transigen-staging port-forward svc/transigen 3000:80`
(then <http://localhost:3000>), or via `minikube tunnel` on
<http://transigen.staging.localhost>. Real Google sign-in on staging needs a
real OAuth client in `deploy/.env.staging` — copy it from
`.env.staging.example`; it is gitignored, so the client secret is never
committed (see its comments).

## Prod (shared platform k3s node)

Prod runs on the shared fleet node owned by the **`platform`** repo. Provision
transigen's DB/role first (platform `cluster/data-postgres/provision-db.sh` with
`PROVISION_APPS="transigen"`; keep the password), then onboard the app, one-time
as root on the node:

```sh
TRANSIGEN_HOST=transigen.lans-h.cc \
TRANSIGEN_DB_PASSWORD=<the transigen_rw password provisioning set> \
bash deploy/setup-app.sh
```

Then: fill the `AUTH_GOOGLE_*` values in the node-local gitignored
`deploy/.env.prod` and re-run `deploy/deploy.sh`. The `deploy-transigen` hook is
defined in the platform repo's `webhook/hooks.json` (rendered onto the node by
its `bootstrap/install-webhook.sh`); point the GitHub webhook at
`http://deploy.lans-h.cc:9000/hooks/deploy-transigen` (push events, the
`TRANSIGEN_WEBHOOK_SECRET` used there). DNS resolves via the `*.lans-h.cc`
wildcard and TLS is the platform wildcard cert — no per-app record or cert.
Every push to `main` afterwards rebuilds the image on the node and rolls the
deployment.

Known gaps inherited from the gelp pattern, unchanged: no automated rollback
(use `kubectl rollout undo` by hand) and no deploy lock around concurrent
webhook deliveries.
