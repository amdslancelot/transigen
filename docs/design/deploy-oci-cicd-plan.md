# Deploy plan: OCI + Terraform + Kubernetes (OKE), pull-based in-cluster CD

Status: implemented. Originally written 2026-07-13 as a GitHub Actions based plan; revised the same day to the final pull-based design below before any infrastructure was provisioned. See `docs/design/deploy-oci-cicd-plan.md.bak` for the earlier draft.

> **SUPERSEDED 2026-07-17.** This OKE/Terraform/deploy-poller design was replaced wholesale by gelp's deploy pattern: staging on local minikube, prod on the shared OCI k3s server via a push webhook, kustomize overlays, and the shared multi-app Postgres data plane. See `deploy/README.md` for the current setup. The infra/, k8s/, and deploy/bootstrap.sh files this document describes have been deleted.

> **Update 2026-07-16 — Supabase removed.** The app migrated from Supabase to plain PostgreSQL (`pg` + raw SQL) with Google OAuth via Auth.js; every Supabase reference below is superseded. Consequences for this plan: there are no `NEXT_PUBLIC_*` build args anymore (the `web-build-args` ConfigMap and kaniko `--build-arg` flags were removed), the `web-runtime` Secret now carries `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and `YOUTUBE_API_KEY`, and the post-deploy manual step is registering the load balancer IP in the Google OAuth client (redirect URI `http://<LB-IP>/api/auth/callback/google`) instead of Supabase redirect URLs. **Open decision: where production Postgres runs** — the Terraform stack does not provision a database; `DATABASE_URL` must point at one you operate separately.

## Goal and scope

Deploy the transigen web app to Oracle Cloud Infrastructure with reproducible infrastructure (Terraform) and automated build/deploy that requires no external CI system. Only the Next.js web app is deployed; Supabase stays external and managed, and the Python beat-analysis worker (`worker/`) stays local, run by hand via podman or `python worker/worker.py`.

Keeping the worker local is a deliberate scope decision, not an oversight: the worker downloads audio via yt-dlp, and YouTube aggressively bot-checks datacenter IP ranges. Running the worker from a cloud node risked 403/429 failures that a residential IP does not hit. Removing the worker from the deployed surface removes that risk entirely rather than requiring proxy infrastructure or cookie exports to work around it.

Out of scope: moving the database (Supabase remains the DB/Auth/Realtime provider), multi-environment promotion (single production environment), TLS/custom domain (the app is served over bare HTTP on the load balancer's public IP; see risks below).

## Architecture

```
Bootstrap (once, local machine):
  deploy/bootstrap.sh
    -> terraform apply (infra/): VCN, OKE cluster, A1 node pool, OCIR repo
    -> oci ce cluster create-kubeconfig
    -> create/update Kubernetes secrets and ConfigMaps
    -> kubectl apply -k k8s/
    -> trigger the first in-cluster image build
    -> print the load balancer's public IP

Upgrade (every push to main, no local step required):
  git push to main
    -> deploy-poller CronJob (runs every 3 minutes inside the cluster)
       queries the GitHub API for main's HEAD SHA
    -> if the SHA differs from the currently deployed image tag:
         spawns a kaniko Job that builds the arm64 image directly from
         the git context (git://github.com/amdslancelot/transigen#refs/heads/main)
         and pushes it to OCIR as transigen-web:<sha>
    -> kubectl set image on the web Deployment
    -> rolling update
```

No GitHub Actions or other external CI/CD system is involved anywhere in this pipeline. The cluster polls for its own updates and builds its own images; the local machine is only needed once, for bootstrap.

Notes on choices:

- **Ampere A1 (arm64) node pool, single node.** OCI's always-free tier is commonly described as covering up to 4 OCPU / 24 GB of A1 Flex compute and a basic OKE control plane. This is UNVERIFIED against current terms — confirm at https://www.oracle.com/cloud/free/ before relying on it. `infra/variables.tf` defaults to 3 OCPU / 18 GB for the single node, leaving headroom under the 4/24 cap. Consequence: the web image must be built for `linux/arm64`; `node:22-alpine` supports arm64 natively, and kaniko builds directly on whatever architecture the node pool runs (no cross-compilation step needed).
- **OCIR** (OCI Container Registry) for the image — same tenancy, no cross-cloud pulls, and the free tier includes a generous OCIR allowance (also UNVERIFIED, same caveat).
- **Pull-based CD instead of GitHub Actions.** A CronJob inside the cluster polls the public GitHub API (unauthenticated, no token needed) rather than a webhook or external runner pushing in. This means zero external CI minutes, zero GitHub Actions configuration, and zero secrets stored outside the cluster. The tradeoff is up to a 3-minute delay between push and deploy, and the poller needs RBAC permissions scoped to Jobs and the web Deployment within its own namespace.
- **kaniko for in-cluster builds.** kaniko builds container images inside a Kubernetes Job without a Docker daemon, which is what makes in-cluster building practical on OKE. It reads the Dockerfile directly from the git context, so no separate checkout step is needed.
- **No TLS, no custom domain.** The app is reachable at `http://<load-balancer-ip>`. This is acceptable for the current stage but is a real limitation — see risks below.

## Repo additions

```
infra/                        Terraform root module (local state, no backend block)
  providers.tf                 oci provider, version constraints
  variables.tf                 tenancy/compartment/region, node shape/ocpus/memory
  network.tf                   VCN, public LB subnet, private node subnet, gateways, route tables, security lists
  oke.tf                       OKE cluster (basic) + A1 Flex node pool
  ocir.tf                      OCIR repository for the web image
  outputs.tf                   cluster OCID/name, OCIR repo path, region
k8s/                           kustomize base
  namespace.yaml                namespace "transigen"
  web-deployment.yaml            Deployment, 1 replica, envFrom web-runtime secret
  web-service.yaml               LoadBalancer Service, flexible OCI LB annotations
  kustomization.yaml
  ci/
    serviceaccount.yaml          deploy-poller ServiceAccount
    rbac.yaml                    Role/RoleBinding scoped to the transigen namespace
    configmap-build-args.yaml    NEXT_PUBLIC_* placeholders (overwritten by bootstrap.sh)
    configmap-poller-script.yaml the poll/build/deploy shell script
    cronjob.yaml                 deploy-poller, schedule */3 * * * *
deploy/
  bootstrap.sh                  one-click bootstrap entry point
  .env.production.example       documented secrets/config template
Dockerfile                      multi-stage node:22-alpine build, output: standalone runner
```

`next.config.ts` sets `output: "standalone"` so the web image is a small self-contained server rather than the whole `node_modules` tree, and pins `outputFileTracingRoot` to the package directory so the standalone output layout does not depend on lockfiles elsewhere on the build machine.

## Secrets and configuration

- `NEXT_PUBLIC_*` variables are baked into the JS bundle **at image build time** — they are passed as Docker build args, not runtime env. Changing one means rebuilding the image. `deploy/bootstrap.sh` reads them from `deploy/.env.production` and writes them into the `web-build-args` ConfigMap; the kaniko build reads them from that ConfigMap on every in-cluster build.
- Server-side secrets (`SUPABASE_SERVICE_ROLE_KEY`, `YOUTUBE_API_KEY`) live in the `web-runtime` Kubernetes Secret, created by `deploy/bootstrap.sh` from `deploy/.env.production`. They are never baked into the image or exposed to the client.
- Production must NOT set `AUTH_DEV_EMAIL_BYPASS` or `NEXT_PUBLIC_AUTH_FLOW=dev_email_only`. Production auth flow is `magic_link`, which requires adding the load balancer's public IP (as `http://<ip>`) to Supabase Auth redirect URLs — `bootstrap.sh` prints a reminder to do this after the first deploy.
- The OCIR push credential (`OCIR_USERNAME` / `OCIR_AUTH_TOKEN`, an OCI Auth Token) is stored as the `ocir-cred` Kubernetes Secret (`kubernetes.io/dockerconfigjson`), created by `deploy/bootstrap.sh`. kaniko mounts it at `/kaniko/.docker/config.json` to push built images; the web Deployment references it via `imagePullSecrets` to pull them.
- No secret material is committed to git. `deploy/.env.production`, the generated `deploy/kubeconfig`, and all Terraform state/var files are gitignored.

## Bootstrap flow (deploy/bootstrap.sh)

1. Check `oci`, `terraform`, `kubectl` are on PATH and the OCI CLI is authenticated.
2. Require `deploy/.env.production` to exist (copied and filled in from the `.example` template).
3. `terraform init` and `apply` against `infra/`, printing a plan summary first.
4. Generate a kubeconfig via `oci ce cluster create-kubeconfig` and export it for the rest of the script.
5. Create the `transigen` namespace, the `ocir-cred` and `web-runtime` secrets, and the `web-build-args` ConfigMap.
6. `kubectl apply -k k8s/`.
7. Patch the `deploy-poller` CronJob with the real OCIR image repository path, then trigger a one-off Job from that CronJob to perform the first build and deploy (there is no pre-existing image to deploy otherwise).
8. Wait for the rollout to complete and the load balancer to receive a public IP, then print it along with the Supabase redirect URL reminder.

The script is idempotent: re-running it after infrastructure already exists re-applies Terraform (a no-op if nothing changed), re-applies secrets/ConfigMaps (updating values if `.env.production` changed), and re-applies the kustomize base.

## Risks and open questions

- **A1 Flex free-tier capacity contention.** Free A1 Flex capacity is frequently exhausted in popular regions; node pool creation can fail with "out of host capacity." Mitigation: pick a less popular home region, or fall back to a paid shape with a budget alert. Not automated — a capacity failure during `terraform apply` requires manually retrying or changing `TF_VAR_region`.
- **kaniko build resource pressure on a small node.** The kaniko Job builds the image on the same single node that runs the web app (there is only one node). A build competing with the running app for the node's 3 OCPU / 18 GB could cause transient slowness or, in the worst case, resource pressure evictions. Mitigation if this becomes a problem: add resource requests/limits to the kaniko Job pod spec, or move to a two-node pool (still within the 4 OCPU / 24 GB free-tier ceiling at smaller per-node sizes).
- **Bare IP, no TLS.** Magic-link auth redirects go to `http://<load-balancer-ip>`, which is unencrypted and will change if the Service is ever recreated (e.g. after a `terraform destroy`/`apply` cycle, since OCI does not guarantee static IP reuse for a new LoadBalancer Service). A changed IP requires manually updating the Supabase redirect URL list. Adding a custom domain and TLS (e.g. via cert-manager) would fix both issues but was left out of this phase to keep the one-click path simple.
- **Free-tier limits are UNVERIFIED.** The OCPU/memory ceiling, OCIR storage allowance, and LB bandwidth allowance are all commonly cited numbers that were not independently reconfirmed against Oracle's current terms as of this writing. Check https://www.oracle.com/cloud/free/ before assuming the defaults in `infra/variables.tf` stay within any free allowance.
- **GitHub API rate limiting.** The poller makes one unauthenticated call to the GitHub API every 3 minutes (20/hour), well under the 60/hour unauthenticated limit for a single source IP. If GitHub becomes unreachable or rate-limits anyway, the poller script exits 0 quietly and simply retries on its next scheduled run — it will not fail loudly or block other cluster activity.
- **Single-node cluster has no redundancy.** If the one node fails or is being replaced, both the web app and the deploy-poller's build capacity are unavailable simultaneously. Acceptable for a small personal project; would need a multi-node pool for any real availability guarantee.
- **YouTube IFrame playback is client-side**, so hosting location does not affect transition timing — no risk there, unchanged from the original draft.
