#!/usr/bin/env bash
# All-in-one image entrypoint (MVP, shell-orchestrated — s6-overlay is a follow-up).
# Starts Postgres → first-boot init (JWT secret + schema/RPCs + roles) → PostgREST →
# cerefox-server (the gateway). Idempotent across restarts.
set -euo pipefail

CEREFOX="bun /opt/cerefox/dist/bin/cerefox.js"
DATA_DIR=/var/lib/postgresql/data
SECRET_FILE="$DATA_DIR/.cerefox_jwt_secret"
log() { echo "[cerefox-entrypoint] $*"; }

# 1. Start Postgres via the base image's entrypoint (handles first-boot initdb +
#    POSTGRES_USER/DB), backgrounded so we can run the other services alongside.
log "starting postgres…"
docker-entrypoint.sh postgres &

# 2. Wait for readiness.
until pg_isready -h 127.0.0.1 -U cerefox -d cerefox >/dev/null 2>&1; do sleep 1; done
log "postgres ready."

# 3. JWT secret: env override > persisted (data volume) > freshly generated.
if [ -n "${PGRST_JWT_SECRET:-}" ]; then
  log "using PGRST_JWT_SECRET from env."
elif [ -f "$SECRET_FILE" ]; then
  PGRST_JWT_SECRET="$(cat "$SECRET_FILE")"
  log "loaded persisted JWT secret."
else
  PGRST_JWT_SECRET="$(bun -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  printf '%s' "$PGRST_JWT_SECRET" > "$SECRET_FILE" && chmod 600 "$SECRET_FILE" || true
  log "generated + persisted a new JWT secret."
fi
export PGRST_JWT_SECRET

# 4. Mint the service_role JWT for cerefox-server's own data client.
export CEREFOX_SUPABASE_KEY="$(SECRET="$PGRST_JWT_SECRET" bun -e 'const c=require("node:crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"});const p=b({role:"service_role"});process.stdout.write(h+"."+p+"."+c.createHmac("sha256",process.env.SECRET).update(h+"."+p).digest("base64url"))')"

# 5. Deploy schema + RPCs (idempotent, bundled assets) + roles (must precede PostgREST).
log "deploying schema + RPCs (idempotent)…"
echo y | $CEREFOX server deploy --schema-only
log "applying PostgREST roles…"
psql "$CEREFOX_DATABASE_URL" -v ON_ERROR_STOP=1 -f /opt/cerefox/roles.sql >/dev/null
log "db init done."

# 6. PostgREST (internal :3000), config rendered from env.
cat > /tmp/postgrest.conf <<EOF
db-uri = "$PGRST_DB_URI"
db-schemas = "$PGRST_DB_SCHEMAS"
db-anon-role = "$PGRST_DB_ANON_ROLE"
jwt-secret = "$PGRST_JWT_SECRET"
server-host = "127.0.0.1"
server-port = 3000
EOF
log "starting PostgREST…"
postgrest /tmp/postgrest.conf &

# 7. cerefox-server (the gateway: UI + /api/v1 + /rest/v1 proxy) in the foreground.
log "starting cerefox-server on :8000 …"
exec $CEREFOX web --host 0.0.0.0 --port 8000
