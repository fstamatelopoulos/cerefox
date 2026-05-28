#!/usr/bin/env bash
# Capture response snapshots from the running Python web server for the 5
# critical endpoints used by the iter-24 / v0.6.0 parity tests (Part 24I).
#
# Prerequisite: `uv run cerefox web` is already running on 127.0.0.1:8000
# with the maintainer's real Supabase data.
#
# Output: packages/memory/test/fixtures/python-parity/*.json
#   - <endpoint>.json         — raw response, pretty-printed via jq
#   - capture-metadata.json   — capture-time context (server version,
#                                document_id used, search query, etc.)
#
# Normalisation strategy: deferred to Part 24I. The parity test there is
# responsible for normalising both the fixture and the live TS response
# before comparison (UUIDs / timestamps / git_commit_short drift between
# captures and would flake byte-snapshots otherwise).

set -euo pipefail

BASE="${CEREFOX_WEB_BASE:-http://127.0.0.1:8000}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/packages/memory/test/fixtures/python-parity"
mkdir -p "$OUT_DIR"

echo "Capturing parity fixtures from $BASE -> $OUT_DIR"

# 1. /version
curl -fsS "$BASE/api/v1/version" | jq '.' > "$OUT_DIR/version.json"

# 2. /dashboard
curl -fsS "$BASE/api/v1/dashboard" | jq '.' > "$OUT_DIR/dashboard.json"

# 3. /search — broad query likely to return multiple docs
SEARCH_Q="cerefox"
curl -fsS --get "$BASE/api/v1/search" \
  --data-urlencode "q=$SEARCH_Q" \
  --data-urlencode "mode=docs" \
  --data-urlencode "count=5" \
  | jq '.' > "$OUT_DIR/search.json"

# 4. /audit-log
curl -fsS --get "$BASE/api/v1/audit-log" \
  --data-urlencode "limit=10" \
  | jq '.' > "$OUT_DIR/audit-log.json"

# 5. /documents/{id} — use the most-recent doc from /dashboard
DOC_ID="$(jq -r '.recent_docs[0].id' "$OUT_DIR/dashboard.json")"
if [[ -z "$DOC_ID" || "$DOC_ID" == "null" ]]; then
  echo "ERROR: could not extract document_id from /dashboard recent_docs[0].id" >&2
  exit 1
fi
curl -fsS "$BASE/api/v1/documents/$DOC_ID" | jq '.' > "$OUT_DIR/documents-by-id.json"

# Capture-time metadata so the parity test in Part 24I knows what inputs
# produced these fixtures.
SERVER_VERSION="$(jq -r '.version' "$OUT_DIR/version.json")"
CAPTURED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
jq -n \
  --arg captured_at "$CAPTURED_AT" \
  --arg server_version "$SERVER_VERSION" \
  --arg base "$BASE" \
  --arg search_q "$SEARCH_Q" \
  --arg doc_id "$DOC_ID" \
  '{
    captured_at: $captured_at,
    server_version: $server_version,
    base_url: $base,
    inputs: {
      "/api/v1/version": {},
      "/api/v1/dashboard": {},
      "/api/v1/search": { q: $search_q, mode: "docs", count: 5 },
      "/api/v1/audit-log": { limit: 10 },
      "/api/v1/documents/{id}": { document_id: $doc_id }
    },
    notes: "Server was the FastAPI Python web (`uv run cerefox web`). Fixtures are the response shape v0.6.0 Hono TS server must match in Part 24I parity tests."
  }' > "$OUT_DIR/capture-metadata.json"

echo "Wrote:"
ls -la "$OUT_DIR" | awk 'NR>1 {print "  " $NF " (" $5 " bytes)"}'
