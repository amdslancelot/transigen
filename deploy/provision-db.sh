#!/bin/bash
# Provision one database + one least-privilege login role per app on the shared
# data-plane Postgres. The data plane itself (a single postgres:17 Deployment +
# Service in namespace `data`) is owned by the snoopy_home repo; this script
# only adds/refreshes an app's slice inside it. It runs INSIDE the postgres
# pod — pipe it in over kubectl exec. Idempotent: safe to re-run to add a new
# app or rotate a password:
#
#   kubectl -n data exec -i deploy/postgres -- \
#     env PROVISION_APPS="transigen" TRANSIGEN_DB_PASSWORD=... \
#     bash -s < deploy/provision-db.sh
#
# For each <app> in PROVISION_APPS (a space-separated list) it creates database
# <app>, role <app>_rw, and reads the role password from the env var
# <APP>_DB_PASSWORD. Note the shared Postgres has no automatic re-provisioning:
# if its data volume is ever re-initialised, re-run this script (and restore
# from backup) for every app.
set -euo pipefail

admin="${POSTGRES_USER:-postgres}"
psql_admin() { psql -v ON_ERROR_STOP=1 --username "$admin" --dbname postgres "$@"; }

apps="${PROVISION_APPS:-}"
if [ -z "$apps" ]; then
  echo "provision: PROVISION_APPS is empty — pass it in the kubectl exec env (e.g. \"transigen\")" >&2
  exit 1
fi

# Isolation hardening: these apps only ever connect to their own database, so
# revoke the default PUBLIC CONNECT on the maintenance databases too. Without it
# an app role could still connect to `postgres`/`template1` and enumerate the
# other apps' database and role names. Idempotent; the superuser is unaffected.
psql_admin <<'EOSQL'
REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
REVOKE CONNECT ON DATABASE template1 FROM PUBLIC;
EOSQL

# provision <database> <role> <password>
provision() {
  local db="$1" role="$2" pw="$3"
  if [ -z "${pw:-}" ]; then
    echo "provision: missing password for role '$role' (pass <APP>_DB_PASSWORD in the exec env)" >&2
    exit 1
  fi

  # Role: create if absent, and always (re)set the login password. The password
  # is passed as a psql variable (:'pw') and the role name as an identifier
  # (:"role"), so psql quotes both — special characters can't break the statement.
  if [ "$(psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$role'")" = "1" ]; then
    psql_admin -v role="$role" -v pw="$pw" <<'EOSQL'
ALTER ROLE :"role" WITH LOGIN PASSWORD :'pw';
EOSQL
  else
    psql_admin -v role="$role" -v pw="$pw" <<'EOSQL'
CREATE ROLE :"role" WITH LOGIN PASSWORD :'pw';
EOSQL
  fi

  # Database: created once, owned by the app role. As the owner it also owns the
  # public schema (via pg_database_owner on PG15+), so it can create tables with
  # no extra grants.
  if [ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = '$db'")" != "1" ]; then
    createdb --username "$admin" --owner "$role" "$db"
  fi

  # Isolation: revoke the default PUBLIC CONNECT so no other app's role can reach
  # this database, then grant it back to just the owner.
  psql_admin -v role="$role" -v db="$db" <<'EOSQL'
REVOKE CONNECT ON DATABASE :"db" FROM PUBLIC;
GRANT ALL PRIVILEGES ON DATABASE :"db" TO :"role";
EOSQL

  echo "provisioned: database '$db' owned by role '$role'"
}

for app in $apps; do
  role="${app}_rw"
  pwvar="${app^^}_DB_PASSWORD"
  provision "$app" "$role" "${!pwvar:-}"
done

echo "app provisioning complete: $apps"
