#!/usr/bin/env bash
#
# Builds and deploys Transigen to the shared k3s cluster it lives on alongside
# gelp. Designed to be idempotent and safe to run both from the adnanh/webhook
# listener (on every push to main) and by hand on the server for a manual
# redeploy.
#
# Shared infrastructure (k3s, Traefik, cert-manager + wildcard TLS, the
# Postgres data plane in namespace `data`, the webhook listener) is owned by
# the platform repo. This script only verifies Postgres exists; it deploys
# the transigen app on top.
#
# Usage: deploy/deploy.sh   (no arguments)

set -euo pipefail

# k3s installs its binaries (k3s, and the kubectl/ctr symlinks) into
# /usr/local/bin. That is on the PATH for the webhook's systemd service and for
# an interactive root login, but NOT under `sudo bash deploy.sh`: sudo resets
# PATH to its secure_path, which excludes /usr/local/bin — so bare `k3s`/
# `kubectl` fail with "command not found" on a manual run. Prepend it so the
# script works identically whether the webhook or a human invokes it.
export PATH="/usr/local/bin:${PATH}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# kubectl needs no setup here: the webhook listener runs as root, and the
# platform repo's node bootstrap symlinks /root/.kube/config to the k3s
# kubeconfig (bootstrap/bootstrap-node.sh).

cd "${REPO_ROOT}"

echo "==> Deploying Transigen from ${REPO_ROOT}"

# ---------------------------------------------------------------------------
# 1. Pull the latest code, but only when this checkout is actually a git repo
#    with an "origin" remote configured.
# ---------------------------------------------------------------------------
if git rev-parse --is-inside-work-tree >/dev/null 2>&1 && git remote get-url origin >/dev/null 2>&1; then
  echo "==> Pulling latest changes (git pull --ff-only)"
  git pull --ff-only
else
  echo "==> Skipping git pull (not a git repo with an origin remote)"
fi

# ---------------------------------------------------------------------------
# 2. Preflight: the shared Postgres (namespace 'data') must already exist. It
#    is deployed and owned by the platform repo, not by transigen — transigen
#    only connects to it as transigen_rw.
# ---------------------------------------------------------------------------
if ! kubectl get deployment postgres -n data >/dev/null 2>&1; then
  echo "ERROR: the shared Postgres (deployment/postgres in namespace 'data') is missing." >&2
  echo "It is owned by the platform repo — see cluster/data-postgres/." >&2
  exit 1
fi
echo "==> Waiting for the shared Postgres to be ready"
kubectl rollout status deployment/postgres -n data --timeout=180s

# ---------------------------------------------------------------------------
# 3. Build the image and import it directly into k3s's containerd, since
#    there is no registry in this setup (imagePullPolicy: IfNotPresent in the
#    Deployment relies on the image already being present locally).
# ---------------------------------------------------------------------------
if command -v docker >/dev/null 2>&1; then
  CONTAINER_TOOL=docker
elif command -v podman >/dev/null 2>&1; then
  CONTAINER_TOOL=podman
else
  echo "ERROR: neither docker nor podman found; install one to build the image" >&2
  exit 1
fi

# Build and import under an explicit localhost/ name. The prod overlay's
# images transformer sets the pod spec to localhost/transigen:latest, and
# containerd treats "localhost" as the registry host — so it uses the imported
# local image directly, never normalizing a bare name to docker.io/library/
# and never attempting a registry pull. This is also exactly the name podman
# gives an unqualified build, so no retag is needed. --format docker-archive
# because podman's default oci-archive output is not what `ctr images import`
# expects.
IMAGE="localhost/transigen:latest"
echo "==> Building ${IMAGE} with ${CONTAINER_TOOL}"
"${CONTAINER_TOOL}" build -f deploy/Dockerfile -t "${IMAGE}" .

echo "==> Importing ${IMAGE} into k3s containerd"
if [ "${CONTAINER_TOOL}" = "podman" ]; then
  podman save --format docker-archive "${IMAGE}" | k3s ctr images import -
else
  docker save "${IMAGE}" | k3s ctr images import -
fi

# ---------------------------------------------------------------------------
# 4. Apply the prod Kustomize overlay. The host is baked into the overlay
#    (transigen.lans-h.cc) — no placeholder substitution needed. Secrets are
#    NOT part of the overlay: real values live only in the gitignored
#    deploy/.env.prod and the transigen-env Secret is created from it here —
#    no Secret YAML anywhere.
# ---------------------------------------------------------------------------
PROD_OVERLAY="${SCRIPT_DIR}/k8s/overlays/prod"
echo "==> Applying prod overlay from ${PROD_OVERLAY}"

# Ensure the namespace exists before secrets are applied into it.
kubectl apply -f "${PROD_OVERLAY}/namespace.yaml"

ENV_FILE="${SCRIPT_DIR}/.env.prod"
if [ -f "${ENV_FILE}" ]; then
  echo "==> Creating/refreshing the transigen-env Secret from deploy/.env.prod"
  kubectl -n transigen create secret generic transigen-env \
    --from-env-file="${ENV_FILE}" \
    --dry-run=client -o yaml | kubectl apply -f -
elif kubectl get secret transigen-env -n transigen >/dev/null 2>&1; then
  echo "==> deploy/.env.prod not found; existing transigen-env Secret left as-is"
else
  echo "##############################################################"
  echo "# WARNING: the transigen-env secret is missing and no"
  echo "# ${ENV_FILE}"
  echo "# was found. The app will not start until it exists."
  echo "# Copy deploy/.env.prod.example to deploy/.env.prod, fill in real"
  echo "# values (chmod 600), then re-run this script."
  echo "# Continuing deployment without it."
  echo "##############################################################"
fi

kubectl kustomize "${PROD_OVERLAY}" | kubectl apply -f -

# ---------------------------------------------------------------------------
# 5. Roll out the new image and wait for it to become healthy.
# ---------------------------------------------------------------------------
echo "==> Restarting deployment/transigen"
kubectl rollout restart deployment/transigen -n transigen
kubectl rollout status deployment/transigen -n transigen --timeout=180s

echo "==> Deploy complete"
