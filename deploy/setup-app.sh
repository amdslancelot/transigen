#!/usr/bin/env bash
#
# One-time onboarding of Transigen onto the shared platform k3s node.
#
# The node itself — k3s/Traefik/podman, the adnanh/webhook listener + the
# deploy-transigen hook, cert-manager and the *.lans-h.cc wildcard TLS cert, and
# the shared Postgres data plane in namespace `data` — is owned and provisioned
# by the `platform` repo, not by this script anymore. This only puts *this app*
# on a node the platform has already prepared: clone to /opt/transigen, write the
# app config, and run the first deploy. See the platform repo for the pieces this
# no longer does:
#
#   - node bootstrap (k3s + Traefik + podman) ...... platform bootstrap/bootstrap-node.sh
#   - webhook listener + deploy-transigen hook ..... platform webhook/hooks.json + bootstrap/install-webhook.sh
#   - wildcard *.lans-h.cc TLS (Traefik default) ... platform cluster/cert-manager/ (Gate 4)
#   - transigen DB/role on shared Postgres ......... platform cluster/data-postgres/provision-db.sh (PROVISION_APPS="transigen")
#
# (deploy/provision-db.sh is KEPT in this repo for the local minikube *staging*
# data plane — stage.sh still pipes it into the staging postgres pod; only the
# *prod* DB provisioning moved to platform.) Idempotent: safe to re-run.
#
# Run as root on the node:
#
#   TRANSIGEN_HOST=transigen.lans-h.cc \
#   TRANSIGEN_DB_PASSWORD=<the password platform's provision-db.sh set> \
#   bash setup-app.sh
#
# Optional: REPO_URL (defaults to the GitHub transigen repo).
#
# What it does:
#   1. Clones/updates the repo at /opt/transigen and writes /opt/transigen/deploy.env.
#   2. Creates the gitignored deploy/.env.prod from .env.prod.example with the
#      DB password and a generated AUTH_SECRET filled in (Google OAuth values
#      stay placeholders — fill them in before sign-in will work). deploy.sh
#      creates the transigen-env Secret from this file on every deploy.
#   3. Runs the first deploy.

set -euo pipefail

log() { echo "[setup-app] $*"; }
die() { echo "[setup-app] ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (the deploy needs k3s ctr access)."

: "${TRANSIGEN_HOST:?set TRANSIGEN_HOST (public hostname for the app, e.g. transigen.lans-h.cc)}"
: "${TRANSIGEN_DB_PASSWORD:?set TRANSIGEN_DB_PASSWORD (must match what platform's provision-db.sh set for transigen_rw)}"
REPO_URL="${REPO_URL:-https://github.com/amdslancelot/transigen.git}"

APP_DIR=/opt/transigen
export KUBECONFIG="${KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

command -v kubectl >/dev/null 2>&1 || die "kubectl not found — is this the platform k3s node?"

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

# --- 2. App secrets ----------------------------------------------------------
# Prod DB provisioning is the platform repo's job (see the header); this only
# writes the app config whose DATABASE_URL must carry the password platform's
# provision-db.sh set for transigen_rw.

ENV_FILE="${APP_DIR}/deploy/.env.prod"
if [ -f "${ENV_FILE}" ]; then
  log "Env file already exists at ${ENV_FILE}; leaving it as-is"
else
  log "Creating ${ENV_FILE} from .env.prod.example (DB password + AUTH_SECRET filled)"
  AUTH_SECRET_VALUE="$(openssl rand -base64 32)"
  sed -e "s|replace-with-transigen-db-password|${TRANSIGEN_DB_PASSWORD}|" \
      -e "s|replace-with-openssl-rand-base64-32|${AUTH_SECRET_VALUE}|" \
      "${APP_DIR}/deploy/.env.prod.example" > "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  log "NOTE: AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are still placeholders in ${ENV_FILE}."
  log "Fill them in (Google Cloud Console OAuth client) or sign-in will not work."
fi

# --- 3. First deploy ----------------------------------------------------------

log "Running the first deploy"
bash "${APP_DIR}/deploy/deploy.sh"

log ""
log "Setup complete. Remaining steps (mostly in the platform repo):"
log "  1. DB: ensure transigen's DB/role exists on the shared Postgres —"
log "     platform cluster/data-postgres/provision-db.sh (PROVISION_APPS=\"transigen\")."
log "     Its transigen_rw password must match the TRANSIGEN_DB_PASSWORD above."
log "  2. Webhook: the deploy-transigen hook is defined in platform webhook/hooks.json"
log "     and rendered onto the node by its bootstrap/install-webhook.sh. Point the"
log "     GitHub webhook at http://deploy.lans-h.cc:9000/hooks/deploy-transigen"
log "     (push events, the TRANSIGEN_WEBHOOK_SECRET used there)."
log "  3. DNS resolves via the *.lans-h.cc wildcard and TLS is the platform's"
log "     wildcard cert (Traefik default) — no per-app DNS record or cert needed."
log "  4. In the Google OAuth client, add https://${TRANSIGEN_HOST}/api/auth/callback/google"
log "     as an authorized redirect URI, and fill AUTH_GOOGLE_* in ${ENV_FILE},"
log "     then re-run ${APP_DIR}/deploy/deploy.sh."
