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

echo "==> Applying shared data plane (Postgres in namespace 'data')"
kubectl apply -k deploy/k8s/data/overlays/staging

echo "==> Waiting for the shared Postgres to become ready"
kubectl rollout status statefulset/postgres -n data --timeout=180s

# The init script only runs automatically on a fresh data volume; re-running it
# by hand is idempotent and covers a volume that was initialised before
# transigen existed (e.g. by gelp's own stage.sh).
echo "==> Provisioning the transigen database/role (idempotent)"
kubectl -n data exec postgres-0 -- \
  env PROVISION_APPS="transigen" TRANSIGEN_DB_PASSWORD="transigen" \
  bash /docker-entrypoint-initdb.d/10-provision-apps.sh

echo "==> Applying staging app overlay"
kubectl apply -k deploy/k8s/overlays/staging

echo "==> Restarting deployment/transigen so the fresh image is picked up"
kubectl rollout restart deployment/transigen -n transigen-staging

echo "==> Waiting for the app to become ready"
kubectl rollout status deployment/transigen -n transigen-staging --timeout=180s

echo "==> Staging deploy complete"
