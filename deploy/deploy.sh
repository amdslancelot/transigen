#!/usr/bin/env bash
#
# Builds and deploys Transigen to the shared k3s cluster it lives on alongside
# gelp. Designed to be idempotent and safe to run both from the adnanh/webhook
# listener (on every push to main) and by hand on the server for a manual
# redeploy.
#
# The shared infrastructure is owned by other checkouts on the server: the k3s
# cluster, Traefik, cert-manager, and the letsencrypt-prod ClusterIssuer by
# gelp (/opt/gelp, its setup-server.sh), and the Postgres data plane in
# namespace `data` by snoopy_home (its docs/prod-k3s-runbook.md). This script
# only verifies those exist; it deploys the transigen app on top.
#
# Usage: deploy/deploy.sh   (no arguments)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# /opt/transigen/deploy.env is written by deploy/setup-app.sh on the server
# and supplies TRANSIGEN_HOST and KUBECONFIG. It won't exist when this script
# is run outside that server, so tolerate its absence rather than failing.
# set -a exports everything the file defines: envsubst and kubectl run as
# child processes and only see exported variables — a plain `source` would
# leave ${TRANSIGEN_HOST} rendering as an empty string on every
# webhook-triggered deploy.
if [ -f /opt/transigen/deploy.env ]; then
  set -a
  # shellcheck disable=SC1091
  source /opt/transigen/deploy.env
  set +a
fi

cd "${REPO_ROOT}"

echo "==> Deploying Transigen from ${REPO_ROOT}"

# Fail on missing configuration before spending minutes on an image build.
if [ -z "${TRANSIGEN_HOST:-}" ]; then
  echo "ERROR: TRANSIGEN_HOST is not set (expected from /opt/transigen/deploy.env)." >&2
  exit 1
fi

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
# 2. Verify the shared infrastructure this app depends on.
# ---------------------------------------------------------------------------
if ! kubectl get deployment postgres -n data >/dev/null 2>&1; then
  echo "ERROR: the shared Postgres (deployment/postgres in namespace 'data') is missing." >&2
  echo "It is owned by the snoopy_home checkout on this server — see" >&2
  echo "snoopy_home/docs/prod-k3s-runbook.md." >&2
  exit 1
fi
echo "==> Waiting for the shared Postgres to be ready"
kubectl rollout status deployment/postgres -n data --timeout=180s

if ! kubectl get clusterissuer letsencrypt-prod >/dev/null 2>&1; then
  echo "WARNING: ClusterIssuer letsencrypt-prod not found (owned by the gelp deployment)."
  echo "TLS certificates will not be issued until it exists. Continuing."
fi

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

echo "==> Building transigen:latest with ${CONTAINER_TOOL}"
"${CONTAINER_TOOL}" build -f deploy/Dockerfile -t transigen:latest .

echo "==> Importing transigen:latest into k3s containerd"
if [ "${CONTAINER_TOOL}" = "podman" ]; then
  # Save under the fully-qualified docker.io/library/ name: podman stores
  # unqualified tags as localhost/<name>, but the kubelet resolves the pod
  # spec's "transigen:latest" to docker.io/library/transigen:latest — the
  # imported name has to match or containerd's local image is ignored and a
  # registry pull is attempted. --format docker-archive because podman's
  # default oci-archive output is not what `ctr images import` expects.
  podman tag transigen:latest docker.io/library/transigen:latest
  podman save --format docker-archive docker.io/library/transigen:latest | k3s ctr images import -
else
  docker save transigen:latest | k3s ctr images import -
fi

# ---------------------------------------------------------------------------
# 4. Apply the prod Kustomize overlay. The rendered manifests contain
#    ${TRANSIGEN_HOST} placeholders (in the Ingress) that need shell
#    substitution before they're valid for kubectl. Secrets are NOT part of
#    the overlay: the real transigen-env value is applied from a server-local
#    secrets.yaml.
# ---------------------------------------------------------------------------
PROD_OVERLAY="${SCRIPT_DIR}/k8s/overlays/prod"
echo "==> Applying prod overlay from ${PROD_OVERLAY}"

# Ensure the namespace exists before secrets are applied into it.
kubectl apply -f "${PROD_OVERLAY}/namespace.yaml"

SECRETS_FILE="${PROD_OVERLAY}/secrets.yaml"
if [ -f "${SECRETS_FILE}" ]; then
  echo "==> Applying local secrets.yaml (transigen-env)"
  # shellcheck disable=SC2016  # envsubst takes the ${VAR} names literally
  envsubst '${TRANSIGEN_HOST}' < "${SECRETS_FILE}" | kubectl apply -f -
elif kubectl get secret transigen-env -n transigen >/dev/null 2>&1; then
  echo "==> Secret transigen-env already exists, leaving it as-is"
else
  echo "##############################################################"
  echo "# WARNING: the transigen-env secret is missing and no"
  echo "# ${SECRETS_FILE}"
  echo "# was found. The app will not start until it exists."
  echo "# Copy transigen-env.example.yaml to secrets.yaml in that directory,"
  echo "# fill in real values, then re-run this script."
  echo "# Continuing deployment without it."
  echo "##############################################################"
fi

# shellcheck disable=SC2016  # envsubst takes the ${VAR} names literally
kubectl kustomize "${PROD_OVERLAY}" \
  | envsubst '${TRANSIGEN_HOST}' \
  | kubectl apply -f -

# ---------------------------------------------------------------------------
# 5. Roll out the new image and wait for it to become healthy.
# ---------------------------------------------------------------------------
echo "==> Restarting deployment/transigen"
kubectl rollout restart deployment/transigen -n transigen
kubectl rollout status deployment/transigen -n transigen --timeout=180s

echo "==> Deploy complete"
