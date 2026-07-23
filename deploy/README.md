# Transigen deployment

This directory mirrors gelp's deploy setup (the same stage/prod pattern; see
`/opt/gelp` on the server or the gelp repo's `deploy/`): a container image
built locally with no registry, Kustomize base + `staging`/`prod` overlays,
a manual minikube staging deploy, and a webhook-driven prod deploy onto the
shared OCI k3s server that gelp bootstrapped.

Data lives in the **shared PostgreSQL** server in the `data` namespace: every
app on the node gets its own database and least-privilege role. Transigen
connects at `postgres.data.svc.cluster.local:5432/transigen` and applies its
own SQL migrations lazily on first DB use (`src/lib/db.ts`), so deploys need no
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
- `k8s/data/` — transigen's view of the shared data plane: a verbatim copy of
  gelp's base plus a staging overlay. **No prod data overlay** — in prod the
  data plane is owned by the gelp checkout. See `k8s/data/README.md`.
- `k8s/overlays/staging/` — minikube, namespace `transigen-staging`, image tag
  `staging`, host `transigen.staging.localhost`, committed dev secrets.
- `k8s/overlays/prod/` — shared k3s server, namespace `transigen`, image tag
  `latest`, host `${TRANSIGEN_HOST}` with TLS via the existing
  `letsencrypt-prod` ClusterIssuer. Secrets applied from a server-local
  `secrets.yaml` (template: `transigen-env.example.yaml`).
- `stage.sh` — build with podman → load into minikube → apply data plane +
  provision the transigen DB → apply the staging overlay.
- `deploy.sh` — prod build-and-deploy on the server; run by the webhook on
  every push to `main`, and safe to run by hand.
- `setup-app.sh` — one-time root script that adds transigen to the existing
  gelp server (checkout, DB provisioning, secrets, webhook hook, first deploy).
- `webhook/hooks.json` — the `deploy-transigen` hook entry merged into the
  server's `/etc/webhook/hooks.json` by `setup-app.sh`.

## Staging (local minikube)

Prereqs (one-time, shared with gelp's staging): a running minikube with a
native driver and Traefik for ingress:

```sh
minikube start --driver=vfkit
helm repo add traefik https://traefik.github.io/charts && helm install traefik traefik/traefik
```

Then each deploy:

```sh
deploy/stage.sh
```

Reach the app with `kubectl -n transigen-staging port-forward svc/transigen 3000:80`
(then <http://localhost:3000>), or via `minikube tunnel` on
<http://transigen.staging.localhost>. Real Google sign-in on staging needs a
real OAuth client in `k8s/overlays/staging/secrets.yaml` (see its comments).

## Prod (shared k3s server)

One-time, as root on the server gelp already runs on:

```sh
TRANSIGEN_HOST=<public hostname> \
WEBHOOK_SECRET=<openssl rand -hex 32> \
TRANSIGEN_DB_PASSWORD=<openssl rand -hex 24> \
bash deploy/setup-app.sh
```

Then: point DNS at the server, add the GitHub webhook
(`http://<server-ip>:9000/hooks/deploy-transigen`, push events, the same
secret), and fill the `AUTH_GOOGLE_*` values in the server-local
`deploy/k8s/overlays/prod/secrets.yaml`. Every push to `main` afterwards
rebuilds the image on the server and rolls the deployment.

Known gaps inherited from the gelp pattern, unchanged: no automated rollback
(use `kubectl rollout undo` by hand) and no deploy lock around concurrent
webhook deliveries.
