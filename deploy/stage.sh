#!/usr/bin/env bash
#
# Build the Transigen image with podman, load it into the local minikube
# cluster, and deploy the staging overlay. No registry, no Docker.
#
# Prereqs (one-time):
#   minikube start --driver=vfkit           # real upstream k8s, no Docker
#   helm install traefik traefik/traefik    # ingress (shared with gelp staging)
# Then, each deploy:
#   deploy/stage.sh
#
# Reach the app with `kubectl -n transigen-staging port-forward svc/transigen 3000:80`
# (then http://localhost:3000), or via Traefik + `minikube tunnel` on
# http://transigen.staging.localhost.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

IMAGE="transigen:staging"

echo "==> Building ${IMAGE} with podman"
podman build -f deploy/Dockerfile -t "${IMAGE}" .

echo "==> Loading ${IMAGE} into minikube"
# podman save streams a docker-archive that `minikube image load` accepts on
# stdin, so nothing touches a registry. The image must be saved under the
# fully-qualified docker.io/library/ name: podman stores unqualified tags as
# localhost/<name>, but kubelet resolves the pod spec's "transigen:staging"
# to docker.io/library/transigen:staging — the stored name has to match or
# the kubelet ignores the loaded image and tries a registry pull.
podman tag "${IMAGE}" "docker.io/library/${IMAGE}"
podman save "docker.io/library/${IMAGE}" | minikube image load -

# The shared data plane (a postgres:17 Deployment + Service in namespace
# `data`) is owned by the snoopy_home repo — snoopy_home/deploy/setup-minikube.sh
# stands it up on this minikube. Transigen only provisions its own slice into it.
echo "==> Preflight: shared Postgres in namespace 'data'"
if ! kubectl get deployment postgres -n data >/dev/null 2>&1; then
  echo "ERROR: deployment/postgres not found in namespace 'data'." >&2
  echo "The shared data plane is provisioned by the snoopy_home repo:" >&2
  echo "  snoopy_home/deploy/setup-minikube.sh" >&2
  exit 1
fi
kubectl rollout status deployment/postgres -n data --timeout=180s

echo "==> Provisioning the transigen database/role (idempotent)"
kubectl -n data exec -i deploy/postgres -- \
  env PROVISION_APPS="transigen" TRANSIGEN_DB_PASSWORD="transigen" \
  bash -s < "${SCRIPT_DIR}/provision-db.sh"

# Secrets follow the snoopy_home pattern: values live in an env file (dev/test
# values, committed) and the Secret is created from it at deploy time — no
# Secret YAML anywhere. The namespace must exist before the Secret can.
echo "==> Creating/refreshing the transigen-env Secret from deploy/env.staging"
kubectl apply -f deploy/k8s/overlays/staging/namespace.yaml
kubectl -n transigen-staging create secret generic transigen-env \
  --from-env-file=deploy/env.staging --dry-run=client -o yaml | kubectl apply -f -

echo "==> Applying staging app overlay"
kubectl apply -k deploy/k8s/overlays/staging

echo "==> Restarting deployment/transigen so the fresh image is picked up"
kubectl rollout restart deployment/transigen -n transigen-staging

echo "==> Waiting for the app to become ready"
kubectl rollout status deployment/transigen -n transigen-staging --timeout=180s

echo "==> Staging deploy complete"
