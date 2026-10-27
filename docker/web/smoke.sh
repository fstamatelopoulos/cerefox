#!/usr/bin/env sh
# Web image smoke test (#346): the gate, the SPA under the gate, the
# healthcheck, and the refusal to start without a key. Needs no backend: the
# routes it checks never touch the database.
#
# Usage:
#   sh docker/web/smoke.sh                          # build + test
#   CEREFOX_SMOKE_IMAGE=<ref> sh docker/web/smoke.sh  # test an existing image
#
# Self-cleaning: removes its own containers on exit.
set -eu

NAME="cerefox-web-smoke-$$"
PORT="${CEREFOX_SMOKE_PORT:-18461}"
IMAGE="${CEREFOX_SMOKE_IMAGE:-cerefox-web-smoke:local}"
KEY="cfx_lak_smoke$$"
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
BACKEND="-e CEREFOX_SUPABASE_URL=http://127.0.0.1:9 -e CEREFOX_SUPABASE_KEY=unused"

cleanup() { docker rm -f "$NAME" "$NAME-open" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

fail() { echo "WEB-SMOKE FAIL: $1"; docker logs "$NAME" 2>&1 | tail -20 || true; exit 1; }
ok()   { echo "  ✓ $1"; }
code() { curl -s -m 8 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || echo 000; }

if [ -z "${CEREFOX_SMOKE_IMAGE:-}" ]; then
  echo "Building $IMAGE…"
  docker build -q -t "$IMAGE" "$REPO_ROOT" >/dev/null || fail "image build failed"
fi

echo "Keyless start must be refused"
# shellcheck disable=SC2086
if out=$(docker run --rm $BACKEND "$IMAGE" 2>&1); then fail "started without CEREFOX_API_KEY"; fi
echo "$out" | grep -q "refusing to start without CEREFOX_API_KEY" || fail "no explanation on refusal: $out"
ok "refused, with the reason"

echo "With a key: the gate covers every caller"
# shellcheck disable=SC2086
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8000" $BACKEND -e CEREFOX_API_KEY="$KEY" "$IMAGE" >/dev/null \
  || fail "docker run failed"
B="http://127.0.0.1:$PORT"
i=0; until [ "$(code "$B/api/v1/version")" = "401" ]; do
  i=$((i + 1)); [ "$i" -lt 60 ] || fail "never served on $PORT"; sleep 1
done
ok "no key → 401"
[ "$(code -H "Authorization: Bearer $KEY" "$B/api/v1/version")" = "200" ] || fail "key not accepted"
ok "key → 200"
[ "$(code -H "Authorization: Bearer cfx_lak_wrong" "$B/api/v1/version")" = "401" ] || fail "wrong key accepted"
ok "wrong key → 401"
# The SPA must load without a key, or the browser can never show the prompt.
[ "$(code "$B/app/")" = "200" ] || fail "/app/ not served"
asset=$(curl -s -m 8 "$B/app/" | grep -o '/app/assets/[^"]*\.js' | head -1)
[ -n "$asset" ] && [ "$(code "$B$asset")" = "200" ] || fail "SPA asset not served"
ok "web UI and its assets → 200 without a key"
[ "$(docker exec "$NAME" id -un)" = "node" ] || fail "not running as the node user"
ok "runs as node"
i=0; while :; do
  h=$(docker inspect -f '{{.State.Health.Status}}' "$NAME")
  [ "$h" = "healthy" ] && break
  [ "$h" = "unhealthy" ] && fail "healthcheck reports unhealthy"
  i=$((i + 1)); [ "$i" -lt 90 ] || fail "never became healthy"; sleep 1
done
ok "healthcheck → healthy"

echo "CEREFOX_WEB_NO_KEY=1 starts open, and says so"
# shellcheck disable=SC2086
docker run -d --name "$NAME-open" $BACKEND -e CEREFOX_WEB_NO_KEY=1 "$IMAGE" >/dev/null || fail "docker run failed"
i=0; until docker logs "$NAME-open" 2>&1 | grep -q "listening"; do
  i=$((i + 1)); [ "$i" -lt 60 ] || fail "open container never started"; sleep 1
done
docker logs "$NAME-open" 2>&1 | grep -q "WITHOUT an API key" || fail "no warning when open"
ok "starts with a warning"

echo "WEB-SMOKE PASS"
