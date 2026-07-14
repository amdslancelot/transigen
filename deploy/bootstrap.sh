#!/usr/bin/env bash
# One-click deploy entry point: provisions OCI infrastructure with
# Terraform, wires up Kubernetes secrets and config, applies the
# kustomize base, and triggers the first in-cluster build. Safe to
# re-run — every step is idempotent (terraform apply against existing
# state, kubectl apply/create --dry-run|apply, etc.).
#
# After this script finishes, upgrades happen automatically: the
# deploy-poller CronJob inside the cluster polls GitHub every 3 minutes
# and rebuilds/redeploys on every push to main. See
# docs/design/deploy-oci-cicd-plan.md for the full design and
# README.md for the operator-facing quick start.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.production"
KUBECONFIG_FILE="${SCRIPT_DIR}/kubeconfig"
NAMESPACE="transigen"

log() { echo "[bootstrap] $*"; }
die() { echo "[bootstrap] ERROR: $*" >&2; exit 1; }

# --- (a) Prerequisite check ---------------------------------------------

log "Checking prerequisites..."

for cmd in oci terraform kubectl; do
  command -v "${cmd}" >/dev/null 2>&1 || die "'${cmd}' is not on PATH. Install it and re-run this script."
done

if ! oci iam region list >/dev/null 2>&1; then
  die "'oci iam region list' failed. Run 'oci setup config' to configure the OCI CLI (tenancy/user OCID, API key, region), then re-run this script."
fi

log "Prerequisites OK (oci, terraform, kubectl on PATH; OCI CLI authenticated)."

# --- (b) Require deploy/.env.production ---------------------------------

if [ ! -f "${ENV_FILE}" ]; then
  die "Missing ${ENV_FILE}. Run: cp deploy/.env.production.example deploy/.env.production, fill in the values, then re-run this script."
fi

# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a

for var in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_AUTH_FLOW \
  SUPABASE_SERVICE_ROLE_KEY OCIR_USERNAME OCIR_AUTH_TOKEN \
  TF_VAR_tenancy_ocid TF_VAR_compartment_ocid TF_VAR_region; do
  if [ -z "${!var:-}" ]; then
    die "${var} is not set in ${ENV_FILE}. Fill in all required values (see deploy/.env.production.example) and re-run."
  fi
done

if [ "${NEXT_PUBLIC_AUTH_FLOW}" != "magic_link" ]; then
  die "NEXT_PUBLIC_AUTH_FLOW must be 'magic_link' in production. Never deploy with dev_email_only."
fi

log "Loaded ${ENV_FILE}."

# --- (c) Terraform init + apply ------------------------------------------

log "Running terraform init..."
terraform -chdir="${REPO_ROOT}/infra" init -input=false

log "Running terraform plan (summary below)..."
terraform -chdir="${REPO_ROOT}/infra" plan -input=false \
  -var="tenancy_ocid=${TF_VAR_tenancy_ocid}" \
  -var="compartment_ocid=${TF_VAR_compartment_ocid}" \
  -var="region=${TF_VAR_region}"

log "Applying terraform (auto-approve; this is the one-click path)..."
terraform -chdir="${REPO_ROOT}/infra" apply -input=false -auto-approve \
  -var="tenancy_ocid=${TF_VAR_tenancy_ocid}" \
  -var="compartment_ocid=${TF_VAR_compartment_ocid}" \
  -var="region=${TF_VAR_region}"

CLUSTER_ID=$(terraform -chdir="${REPO_ROOT}/infra" output -raw cluster_id)
# ocir_repo_path is "<tenancy-namespace>/transigen-web" and ocir_region_key
# is the short lowercase region key (e.g. "iad"), both computed by
# Terraform from data sources — nothing region- or tenancy-specific is
# hardcoded here.
OCIR_REPO_PATH=$(terraform -chdir="${REPO_ROOT}/infra" output -raw ocir_repo_path)
OCIR_REGION_KEY=$(terraform -chdir="${REPO_ROOT}/infra" output -raw ocir_region_key)

log "Cluster OCID: ${CLUSTER_ID}"

# --- (d) kubeconfig --------------------------------------------------------

log "Generating kubeconfig at ${KUBECONFIG_FILE}..."
oci ce cluster create-kubeconfig \
  --cluster-id "${CLUSTER_ID}" \
  --file "${KUBECONFIG_FILE}" \
  --region "${TF_VAR_region}" \
  --token-version 2.0.0

export KUBECONFIG="${KUBECONFIG_FILE}"

log "Waiting for at least one Ready node (this can take several minutes on a fresh cluster)..."
for _ in $(seq 1 60); do
  if kubectl get nodes --no-headers 2>/dev/null | grep -qw "Ready"; then
    break
  fi
  sleep 10
done
kubectl get nodes --no-headers 2>/dev/null | grep -qw "Ready" || die "No Ready node after 10 minutes. Check the node pool in the OCI Console."

# --- (e) Namespace, secrets, ConfigMap ------------------------------------

log "Ensuring namespace/${NAMESPACE} exists..."
kubectl create namespace "${NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

# Full image repository reference: <region-key>.ocir.io/<tenancy-namespace>/transigen-web
OCIR_HOST="${OCIR_REGION_KEY}.ocir.io"
OCIR_IMAGE_REPO="${OCIR_HOST}/${OCIR_REPO_PATH}"

log "Creating/updating secret ocir-cred (OCIR push credential)..."
kubectl create secret docker-registry ocir-cred \
  --namespace "${NAMESPACE}" \
  --docker-server="${OCIR_HOST}" \
  --docker-username="${OCIR_USERNAME}" \
  --docker-password="${OCIR_AUTH_TOKEN}" \
  --docker-email="none@example.com" \
  --dry-run=client -o yaml | kubectl apply -f -

log "Creating/updating secret web-runtime (server-side secrets)..."
kubectl create secret generic web-runtime \
  --namespace "${NAMESPACE}" \
  --from-literal="SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}" \
  --from-literal="YOUTUBE_API_KEY=${YOUTUBE_API_KEY:-}" \
  --dry-run=client -o yaml | kubectl apply -f -

log "Creating/updating configmap web-build-args (NEXT_PUBLIC_* build args for kaniko)..."
kubectl create configmap web-build-args \
  --namespace "${NAMESPACE}" \
  --from-literal="NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}" \
  --from-literal="NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
  --from-literal="NEXT_PUBLIC_AUTH_FLOW=${NEXT_PUBLIC_AUTH_FLOW}" \
  --dry-run=client -o yaml | kubectl apply -f -

# --- (f) Apply the kustomize base ------------------------------------------

log "Applying k8s/ (kustomize base)..."
kubectl apply -k "${REPO_ROOT}/k8s/"

log "Patching deploy-poller CronJob with the real OCIR image repo path..."
kubectl set env cronjob/deploy-poller \
  --namespace "${NAMESPACE}" \
  "OCIR_REPO=${OCIR_IMAGE_REPO}"

# --- (g) Trigger the first build/deploy ------------------------------------

log "Triggering the first in-cluster build via deploy-poller..."
kubectl delete job initial-deploy --namespace "${NAMESPACE}" --ignore-not-found
kubectl create job initial-deploy --namespace "${NAMESPACE}" --from=cronjob/deploy-poller

log "Waiting for the first build + rollout (this can take several minutes)..."
kubectl wait --for=condition=complete "job/initial-deploy" --namespace "${NAMESPACE}" --timeout=1200s \
  || die "Initial build/deploy did not complete within 20 minutes. Check: kubectl -n ${NAMESPACE} logs job/initial-deploy"

# --- (h) Wait for rollout and print the LB IP -------------------------------

log "Waiting for deployment/web rollout..."
kubectl rollout status "deployment/web" --namespace "${NAMESPACE}" --timeout=600s

log "Waiting for the LoadBalancer to get a public IP (can take a few minutes)..."
LB_IP=""
for _ in $(seq 1 60); do
  LB_IP=$(kubectl get svc web --namespace "${NAMESPACE}" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [ -n "${LB_IP}" ]; then
    break
  fi
  sleep 10
done

if [ -z "${LB_IP}" ]; then
  log "LoadBalancer IP not yet assigned. Check later with: kubectl get svc web -n ${NAMESPACE}"
else
  log "App is live at: http://${LB_IP}"
fi

log ""
log "Next step (required for login to work): add http://${LB_IP:-<LB-IP>} to Supabase Auth -> URL Configuration -> Redirect URLs."
log "Production auth flow is magic_link. Never set AUTH_DEV_EMAIL_BYPASS or NEXT_PUBLIC_AUTH_FLOW=dev_email_only in production."
log ""
log "Bootstrap complete. Future upgrades: git push to main; the deploy-poller CronJob picks it up within ~3 minutes."
