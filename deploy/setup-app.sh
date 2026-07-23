#!/usr/bin/env bash
#
# One-time setup that adds Transigen to an EXISTING gelp-style k3s server
# (the box bootstrapped by gelp's deploy/setup-server.sh, which already runs
# k3s, Traefik, cert-manager, and the adnanh/webhook service; the shared
# Postgres data plane in namespace `data` is owned by the snoopy_home repo,
# see its docs/prod-k3s-runbook.md). Idempotent: safe to re-run.
#
# Run as root on the server:
#
#   TRANSIGEN_HOST=transigen.example.com \
#   WEBHOOK_SECRET=<github webhook secret for this repo> \
#   TRANSIGEN_DB_PASSWORD=<openssl rand -hex 24> \
#   bash setup-app.sh
#
# Optional: REPO_URL (defaults to the GitHub transigen repo).
#
# What it does:
#   1. Clones/updates the repo at /opt/transigen and writes /opt/transigen/deploy.env.
#   2. Provisions the `transigen` database/role in the shared Postgres
#      (deploy/provision-db.sh piped into the postgres pod). There is no
#      automatic re-provisioning: if the Postgres volume is ever
#      re-initialised, re-run this script and restore from backup.
#   3. Creates deploy/k8s/overlays/prod/secrets.yaml from the example with the
#      DB password and a generated AUTH_SECRET filled in (Google OAuth values
#      stay placeholders — fill them in before sign-in will work).
#   4. Adds the deploy-transigen hook to /etc/webhook/hooks.json and restarts
#      the webhook service.
#   5. Runs the first deploy.

set -euo pipefail

log() { echo "[setup-app] $*"; }
die() { echo "[setup-app] ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (the deploy needs k3s ctr and /etc/webhook access)."

: "${TRANSIGEN_HOST:?set TRANSIGEN_HOST (public hostname for the app)}"
: "${WEBHOOK_SECRET:?set WEBHOOK_SECRET (GitHub webhook HMAC secret for this repo)}"
: "${TRANSIGEN_DB_PASSWORD:?set TRANSIGEN_DB_PASSWORD (URL-safe, e.g. openssl rand -hex 24)}"
REPO_URL="${REPO_URL:-https://github.com/amdslancelot/transigen.git}"

APP_DIR=/opt/transigen
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

command -v kubectl >/dev/null 2>&1 || die "kubectl not found — is this the gelp k3s server?"
command -v jq >/dev/null 2>&1 || die "jq not found (gelp's setup-server.sh installs it)."

# --- 1. Repo checkout + deploy.env -----------------------------------------

if [ -d "${APP_DIR}/.git" ]; then
  log "Repo already present at ${APP_DIR}; pulling latest"
  git -C "${APP_DIR}" pull --ff-only
else
  log "Cloning ${REPO_URL} to ${APP_DIR}"
  git clone "${REPO_URL}" "${APP_DIR}"
fi

log "Writing ${APP_DIR}/deploy.env"
cat > "${APP_DIR}/deploy.env" <<EOF
# Written by deploy/setup-app.sh; sourced by deploy/deploy.sh on every deploy.
TRANSIGEN_HOST=${TRANSIGEN_HOST}
KUBECONFIG=${KUBECONFIG}
EOF
chmod 600 "${APP_DIR}/deploy.env"

# --- 2. Database provisioning in the shared Postgres ------------------------

log "Waiting for the shared Postgres (namespace data)"
kubectl get deployment postgres -n data >/dev/null 2>&1 \
  || die "deployment/postgres not found in namespace data — it is owned by the snoopy_home repo (docs/prod-k3s-runbook.md)."
kubectl rollout status deployment/postgres -n data --timeout=180s

log "Provisioning database 'transigen' / role 'transigen_rw' (idempotent)"
kubectl -n data exec -i deploy/postgres -- \
  env PROVISION_APPS="transigen" TRANSIGEN_DB_PASSWORD="${TRANSIGEN_DB_PASSWORD}" \
  bash -s < "${APP_DIR}/deploy/provision-db.sh"

log "NOTE: the shared Postgres has no automatic re-provisioning. If its data"
log "volume is ever re-initialised, re-run this script (idempotent) and restore"
log "the transigen database from backup."

# --- 3. App secrets ----------------------------------------------------------

SECRETS_FILE="${APP_DIR}/deploy/k8s/overlays/prod/secrets.yaml"
if [ -f "${SECRETS_FILE}" ]; then
  log "Secrets file already exists at ${SECRETS_FILE}; leaving it as-is"
else
  log "Creating ${SECRETS_FILE} from the example (DB password + AUTH_SECRET filled)"
  AUTH_SECRET_VALUE="$(openssl rand -base64 32)"
  sed -e "s|replace-with-transigen-db-password|${TRANSIGEN_DB_PASSWORD}|" \
      -e "s|replace-with-openssl-rand-base64-32|${AUTH_SECRET_VALUE}|" \
      "${APP_DIR}/deploy/k8s/overlays/prod/transigen-env.example.yaml" > "${SECRETS_FILE}"
  chmod 600 "${SECRETS_FILE}"
  log "NOTE: AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are still placeholders in ${SECRETS_FILE}."
  log "Fill them in (Google Cloud Console OAuth client) or sign-in will not work."
fi

# --- 4. Webhook hook ----------------------------------------------------------

HOOKS_FILE=/etc/webhook/hooks.json
if [ ! -f "${HOOKS_FILE}" ]; then
  die "${HOOKS_FILE} not found — the webhook service is set up by gelp's setup-server.sh."
fi

if jq -e '.[] | select(.id == "deploy-transigen")' "${HOOKS_FILE}" >/dev/null; then
  log "deploy-transigen hook already present in ${HOOKS_FILE}"
else
  log "Adding deploy-transigen hook to ${HOOKS_FILE}"
  # One jq invocation reading the secret from the environment (env.WEBHOOK_SECRET),
  # so the secret never appears in any process argument list, and no sed can
  # corrupt the JSON when the secret contains characters like | & or quotes.
  export WEBHOOK_SECRET
  jq -n \
    --slurpfile existing "${HOOKS_FILE}" \
    --slurpfile tmpl "${APP_DIR}/deploy/webhook/hooks.json" \
    '$existing[0] + [$tmpl[0][0] | walk(if . == "{{WEBHOOK_SECRET}}" then env.WEBHOOK_SECRET else . end)]' \
    > "${HOOKS_FILE}.tmp" \
    && mv "${HOOKS_FILE}.tmp" "${HOOKS_FILE}"
  systemctl restart webhook
fi

# --- 5. First deploy ----------------------------------------------------------

log "Running the first deploy"
bash "${APP_DIR}/deploy/deploy.sh"

log ""
log "Setup complete. Remaining manual steps:"
log "  1. Point a DNS A record for ${TRANSIGEN_HOST} at this server's public IP"
log "     (cert-manager will then issue the TLS certificate automatically)."
log "  2. Add a GitHub webhook on the transigen repo:"
log "     URL http://<server-ip>:9000/hooks/deploy-transigen, content type json,"
log "     secret = the WEBHOOK_SECRET you used, push events only."
log "  3. In the Google OAuth client, add https://${TRANSIGEN_HOST}/api/auth/callback/google"
log "     as an authorized redirect URI, and fill AUTH_GOOGLE_* in ${SECRETS_FILE},"
log "     then re-run ${APP_DIR}/deploy/deploy.sh."
