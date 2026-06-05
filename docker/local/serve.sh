#!/usr/bin/env sh
# Start cerefox-server as the LOCAL gateway against the docker/local spike stack.
# It mints the service_role JWT itself (signed with the compose's PGRST_JWT_SECRET)
# so there's no hand-minting / multi-shell footgun. Open http://localhost:<port>/app/.
#
# SAFE: forces explicit LOCAL env — never reads ~/.cerefox/.env, never touches cloud.
# Prereq: `docker-compose -f docker/local/compose.yml up -d` + schema/roles applied
#         (README steps 1–3).
# Usage:  sh docker/local/serve.sh                 # UI on :8012
#         PORT=8020 sh docker/local/serve.sh        # custom port
#         OPENAI_API_KEY=sk-... sh docker/local/serve.sh   # enable ingest/embeddings
set -eu

SECRET="cerefox-local-dev-secret-change-me-please-0123456789" # = PGRST_JWT_SECRET in compose.yml
PGRST="${CEREFOX_POSTGREST_UPSTREAM:-http://localhost:33000}"
PORT="${PORT:-8012}"
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO_ROOT"

JWT=$(SECRET="$SECRET" bun -e 'const c=require("node:crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"});const p=b({role:"service_role"});const s=c.createHmac("sha256",process.env.SECRET).update(h+"."+p).digest("base64url");process.stdout.write(h+"."+p+"."+s)')
case "$JWT" in
  *.*.*) : ;;
  *) echo "✗ JWT mint failed (got: '$JWT'). Is bun on PATH?"; exit 1 ;;
esac

# Embedder key: prefer the environment; otherwise pull ONLY the OPENAI_API_KEY line
# from ~/.cerefox/.env (never the Supabase creds — those are forced to local below).
if [ -z "${OPENAI_API_KEY:-}" ] && [ -f "$HOME/.cerefox/.env" ]; then
  OPENAI_API_KEY=$(grep -E '^OPENAI_API_KEY=' "$HOME/.cerefox/.env" | head -1 | sed -E 's/^OPENAI_API_KEY=//; s/^["'\'']//; s/["'\'']$//') || true
  [ -n "$OPENAI_API_KEY" ] && echo "  (picked up OPENAI_API_KEY from ~/.cerefox/.env for embeddings)"
fi

echo "→ cerefox-server (local gateway) on http://localhost:$PORT/app/"
echo "  upstream PostgREST: $PGRST   |   Ctrl-C to stop"
echo "  LOCAL Supabase creds forced — your cloud Cerefox is untouched."
[ -n "${OPENAI_API_KEY:-}" ] || echo "  (no OPENAI_API_KEY in env or ~/.cerefox/.env → ingest disabled; reads/FTS still work)"

exec env \
  CEREFOX_POSTGREST_UPSTREAM="$PGRST" \
  CEREFOX_SUPABASE_URL="http://localhost:$PORT" \
  CEREFOX_SUPABASE_KEY="$JWT" \
  OPENAI_API_KEY="${OPENAI_API_KEY:-}" \
  bun packages/memory/src/bin/cerefox.ts web --port "$PORT"
