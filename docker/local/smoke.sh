#!/usr/bin/env sh
# Local smoke test for the D1 stack — exercises representative supabase-js
# `.from` + `.rpc` operations through cerefox-server's /rest/v1 proxy against the
# local PostgREST. This is the seed of the version-coupling CI suite
# (design §6-coupling): a supabase-js bump that breaks against the pinned local
# PostgREST should fail here.
#
# SAFE: local-only. Sets CEREFOX_SUPABASE_URL/key explicitly to the local server,
# so it never reads ~/.cerefox/.env and never touches the cloud.
#
# Prereq: `docker-compose -f docker/local/compose.yml up -d` + schema/roles applied
#         (see README steps 1–3).
# Usage:  sh docker/local/smoke.sh            # non-embedding paths (no OpenAI key)
#         OPENAI_API_KEY=sk-... sh docker/local/smoke.sh   # + ingest/hybrid search
set -eu

SECRET="cerefox-local-dev-secret-change-me-please-0123456789" # = PGRST_JWT_SECRET in compose.yml
PGRST="http://localhost:33000"
PORT=8013
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$REPO_ROOT"
BIN="packages/memory/src/bin/cerefox.ts"

JWT=$(SECRET="$SECRET" bun -e 'const c=require("node:crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");const h=b({alg:"HS256",typ:"JWT"});const p=b({role:"service_role"});const s=c.createHmac("sha256",process.env.SECRET).update(h+"."+p).digest("base64url");process.stdout.write(h+"."+p+"."+s)')

# Start cerefox-server as the local gateway (proxy → PostgREST), pointed at itself.
env CEREFOX_POSTGREST_UPSTREAM="$PGRST" CEREFOX_SUPABASE_URL="http://localhost:$PORT" CEREFOX_SUPABASE_KEY="$JWT" \
  bun "$BIN" web --port "$PORT" >/tmp/cfx-smoke-server.log 2>&1 &
trap 'lsof -ti tcp:'"$PORT"' 2>/dev/null | xargs -r kill 2>/dev/null || true' EXIT
sleep 6

run() { env CEREFOX_SUPABASE_URL="http://localhost:$PORT" CEREFOX_SUPABASE_KEY="$JWT" OPENAI_API_KEY="${OPENAI_API_KEY:-}" bun "$BIN" "$@"; }
fail() { echo "SMOKE FAIL: $1"; exit 1; }

P="smoke-$$"
echo "1. project create ($P) — .rpc/.from write"; run project create "$P" >/dev/null || fail "project create"
echo "2. project list — read-after-write";        run project list | grep -q "$P" || fail "project list missing $P"
echo "3. document list — .from read";             run document list >/dev/null || fail "document list"

if [ -n "${OPENAI_API_KEY:-}" ]; then
  echo "4. ingest (768-dim embeddings) + hybrid search (pgvector)"
  printf '# Smoke %s\n\nlocal postgrest pgvector smoke test.\n' "$P" > /tmp/cfx-smoke.md
  run document ingest /tmp/cfx-smoke.md --title "Smoke $P" --project-name "$P" >/dev/null || fail "ingest"
  run search "local postgrest pgvector smoke" | grep -qi "Smoke" || fail "hybrid search"
  echo "5. fts search (no embedding)";            run search "postgrest" --mode fts >/dev/null || fail "fts search"
else
  echo "4. (skipped ingest/hybrid — set OPENAI_API_KEY to include them)"
  echo "5. fts search (no embedding)";            run search "postgrest" --mode fts >/dev/null || fail "fts search"
fi

echo "cleanup: project delete $P"; run project delete "$P" --yes >/dev/null 2>&1 || true
echo "SMOKE OK"
