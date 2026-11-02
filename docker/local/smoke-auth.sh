#!/usr/bin/env sh
# Container auth smoke test (v1.12.1) — the check whose ABSENCE shipped the
# v1.12.0 bug that broke every Cerefox Local install.
#
# What that bug was: Docker's port publishing NATs the source address, so a
# request from the host to a published port reaches the server inside the
# container appearing to come from the bridge gateway, not 127.0.0.1. The
# loopback exemption therefore never matched and EVERY caller got a 401,
# including the web UI. It was invisible to every unit test and to a native
# `cerefox web` run, because the mechanism was right and only the PACKAGING
# was wrong.
#
# So this test can only be done one way: build the real image, publish a real
# port, and make real requests from the host.
#
# Usage:
#   sh docker/local/smoke-auth.sh                 # build + test
#   CEREFOX_SMOKE_IMAGE=<ref> sh …/smoke-auth.sh  # test an existing image
#
# Self-cleaning: removes its own container + volume on exit, and never touches
# a container or volume named `cerefox-local`.
set -eu

NAME="cerefox-smoke-auth-$$"
VOL="${NAME}-data"
PORT="${CEREFOX_SMOKE_PORT:-18441}"
IMAGE="${CEREFOX_SMOKE_IMAGE:-cerefox-smoke-auth:local}"
REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$VOL" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

fail() { echo "SMOKE-AUTH FAIL: $1"; exit 1; }
ok()   { echo "  ✓ $1"; }

code() { curl -s -m 8 -o /dev/null -w '%{http_code}' "$@" 2>/dev/null || echo 000; }

wait_ready() {
  i=0
  while [ "$i" -lt 90 ]; do
    c=$(code "http://127.0.0.1:$PORT/api/v1/version")
    # 200 (gate off) and 401 (gate on) both mean "serving"; only 000 means down.
    [ "$c" = "200" ] || [ "$c" = "401" ] && return 0
    i=$((i + 2)); sleep 2
  done
  echo "--- container logs ---"; docker logs "$NAME" 2>&1 | tail -30
  fail "container never became ready on port $PORT"
}

if [ -z "${CEREFOX_SMOKE_IMAGE:-}" ]; then
  echo "Building $IMAGE (this takes a few minutes)…"
  docker build -q -f "$REPO_ROOT/docker/local/Dockerfile" -t "$IMAGE" "$REPO_ROOT" >/dev/null \
    || fail "image build failed"
fi

# ── Case 1: default publish (loopback). The gate must be OFF. ────────────────
# This is the case v1.12.0 got wrong, and it is the one every existing user is
# in. A 401 here is the exact regression.
echo "Case 1: published on 127.0.0.1 — gate must be OFF"
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8000" -v "$VOL:/var/lib/postgresql/data" \
  "$IMAGE" >/dev/null || fail "docker run failed"
wait_ready
c=$(code "http://127.0.0.1:$PORT/api/v1/version")
[ "$c" = "200" ] || fail "host request got $c, expected 200 (this IS the v1.12.0 bug)"
ok "host → 200 without a credential"
c=$(code "http://127.0.0.1:$PORT/app/")
[ "$c" = "200" ] || fail "web UI page got $c, expected 200"
ok "web UI page → 200"
# The key still exists, ready for the day it is needed.
docker exec "$NAME" test -f /var/lib/postgresql/data/.cerefox_api_key \
  || fail "no key was minted/persisted"
ok "key minted + persisted (not enforced, by design)"
# The Data API with the gate off: the host CLI's JWT works as before, and an
# API key is NOT swapped for the internal JWT (#351), so PostgREST refuses it.
R="http://127.0.0.1:$PORT/rest/v1/cerefox_projects?select=id&limit=1"
JWT=$(docker exec "$NAME" sh -c 'grep "^CEREFOX_SUPABASE_KEY=" /run/cerefox-runtime.env | cut -d= -f2-')
c=$(code -H "apikey: $JWT" -H "Authorization: Bearer $JWT" "$R")
[ "$c" = "200" ] || fail "Data API with the internal JWT got $c with the gate off, expected 200"
KEY0=$(docker exec "$NAME" cat /var/lib/postgresql/data/.cerefox_api_key)
c=$(code -H "apikey: $KEY0" -H "Authorization: Bearer $KEY0" "$R")
[ "$c" = "401" ] || fail "gate off: an API key on the Data API got $c, expected PostgREST's 401 (no swap)"
ok "gate off: Data API unchanged (JWT → 200, API key not swapped → 401)"

# ── Case 2: require-mode. The gate must be ON for everyone. ──────────────────
# What `cerefox-local` passes automatically when CEREFOX_LOCAL_BIND is widened.
echo "Case 2: CEREFOX_API_REQUIRE_KEY=1 — gate must be ON"
KEY=$(docker exec "$NAME" cat /var/lib/postgresql/data/.cerefox_api_key)
docker rm -f "$NAME" >/dev/null 2>&1
docker run -d --name "$NAME" -p "127.0.0.1:$PORT:8000" -v "$VOL:/var/lib/postgresql/data" \
  -e CEREFOX_API_REQUIRE_KEY=1 "$IMAGE" >/dev/null || fail "docker run failed"
wait_ready
c=$(code "http://127.0.0.1:$PORT/api/v1/version")
[ "$c" = "401" ] || fail "unauthenticated request got $c, expected 401"
ok "no credential → 401"
c=$(code -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/api/v1/version")
[ "$c" = "200" ] || fail "request WITH the key got $c, expected 200"
ok "correct key → 200"
c=$(code -H "Authorization: Bearer cfx_lak_wrong" "http://127.0.0.1:$PORT/api/v1/version")
[ "$c" = "401" ] || fail "wrong key got $c, expected 401"
ok "wrong key → 401"
# A route that reads the database. /api/v1/version never touches it, which is
# how v1.12.1 through v1.19.5 shipped a gated container whose own data calls
# (server → its /rest/v1 proxy, signed with the service JWT) were refused by
# this same gate: every data route was a 500 while everything above passed.
c=$(code -H "Authorization: Bearer $KEY" "http://127.0.0.1:$PORT/api/v1/projects")
[ "$c" = "200" ] || fail "data route WITH the key got $c, expected 200 (the server's own calls are being gated)"
ok "data route with the key → 200"
docker exec "$NAME" sh -c 'set -a; . /run/cerefox-runtime.env; set +a; cerefox project list >/dev/null' \
  || fail "in-container CLI could not reach the data API (cerefox-local commands would fail)"
ok "in-container CLI reaches the data API"
# A client on another machine (the CLI, the local MCP server) reaches the Data
# API with the API key alone (#351): the proxy exchanges it for the container's
# JWT. Before 1.22.0 it forwarded the key and PostgREST refused it.
R="http://127.0.0.1:$PORT/rest/v1/cerefox_projects?select=id&limit=1"
c=$(code -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$R")
[ "$c" = "200" ] || fail "Data API with the API key got $c, expected 200 (remote CLI/MCP would fail)"
ok "Data API with the API key → 200 (remote CLI and MCP)"
for h in "" "Authorization: Bearer cfx_lak_wrong" "apikey: $KEY"; do
  c=$(code ${h:+-H "$h"} "$R")
  [ "$c" = "401" ] || fail "Data API with '${h%%:*}' only got $c, expected 401"
done
ok "Data API keyless, wrong key or apikey header alone → 401"
JWT=$(docker exec "$NAME" sh -c 'grep "^CEREFOX_SUPABASE_KEY=" /run/cerefox-runtime.env | cut -d= -f2-')
if curl -s -m 8 -D - -H "Authorization: Bearer $KEY" "$R" | grep -qF "$JWT"; then
  fail "the internal JWT appeared in a Data API response"
fi
ok "the internal JWT is not in the response"
# The web UI must still LOAD without a key: on a gated server it asks for the
# key (#346), and it cannot ask if the page itself is refused.
c=$(code "http://127.0.0.1:$PORT/app/")
[ "$c" = "200" ] || fail "web UI page got $c under the gate, expected 200 (the key prompt could never show)"
asset=$(curl -s -m 8 "http://127.0.0.1:$PORT/app/" | grep -o '/app/assets/[^"]*\.js' | head -1)
[ -n "$asset" ] && [ "$(code "http://127.0.0.1:$PORT$asset")" = "200" ] \
  || fail "web UI asset not served under the gate"
ok "web UI and its assets → 200 without a key (the key prompt can load)"
# The key survived the recreate, because it lives on the volume. A key that
# changed on every recreate would silently break every configured client.
KEY2=$(docker exec "$NAME" cat /var/lib/postgresql/data/.cerefox_api_key)
[ "$KEY" = "$KEY2" ] || fail "key changed across recreate — clients would break"
ok "key stable across container recreate"

echo "SMOKE-AUTH PASS"
