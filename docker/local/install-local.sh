#!/usr/bin/env sh
# Install + run the Cerefox Local Server (the all-in-one image) — "Model B":
# a per-install JWT secret is generated HERE, injected into the container, and the
# matching service_role JWT is written to a SEPARATE client config so the local
# setup coexists with any cloud setup. Your cloud ~/.cerefox/.env is NEVER touched.
#
# Usage (pulls the published ghcr image by default):
#   sh docker/local/install-local.sh
#   PORT=8000 OPENAI_API_KEY=sk-... sh docker/local/install-local.sh
#
# Default image: ghcr.io/fstamatelopoulos/cerefox-local:latest (published by the
# release workflow on a GitHub Release). Override for local builds / pinned tags:
#   CEREFOX_LOCAL_IMAGE=cerefox-local:dev sh ...    # after `docker build -f docker/local/Dockerfile -t cerefox-local:dev .`
#   CEREFOX_LOCAL_IMAGE=ghcr.io/fstamatelopoulos/cerefox-local:v0.10.0 sh ...
#
# Then use the CLI/MCP against local by pointing at the separate config dir:
#   CEREFOX_CONFIG_DIR=~/.cerefox/local cerefox search "…"
#
# NOTE (P2 scaffolding): standalone + validated. Folding this into the shared
# `install.sh` / `cerefox init` is deferred for review (it's the user-facing path).
set -eu

IMAGE="${CEREFOX_LOCAL_IMAGE:-ghcr.io/fstamatelopoulos/cerefox-local:latest}"
PORT="${PORT:-8000}"
CONFIG_DIR="${CEREFOX_LOCAL_CONFIG_DIR:-$HOME/.cerefox/local}"
CONTAINER="${CEREFOX_LOCAL_CONTAINER:-cerefox-local}"
VOLUME="${CEREFOX_LOCAL_VOLUME:-cerefox_local_pgdata}"

command -v docker  >/dev/null 2>&1 || { echo "✗ docker not found"; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "✗ openssl not found"; exit 1; }

mkdir -p "$CONFIG_DIR"; chmod 700 "$CONFIG_DIR"

# 1. Per-install JWT secret (persisted; stable across re-runs).
SECRET_FILE="$CONFIG_DIR/jwt-secret"
if [ -f "$SECRET_FILE" ]; then
  SECRET=$(cat "$SECRET_FILE")
else
  SECRET=$(openssl rand -hex 32)
  printf '%s' "$SECRET" > "$SECRET_FILE"; chmod 600 "$SECRET_FILE"
fi

# 2. Mint the matching service_role JWT (HS256) with openssl (no bun/node needed).
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
HEADER=$(printf '%s'  '{"alg":"HS256","typ":"JWT"}' | b64url)
PAYLOAD=$(printf '%s' '{"role":"service_role"}'      | b64url)
SIG=$(printf '%s' "$HEADER.$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64url)
JWT="$HEADER.$PAYLOAD.$SIG"

# Embedder key: prefer the env; else pull ONLY the OPENAI_API_KEY line from the cloud
# ~/.cerefox/.env so CLI/web ingest + search work. We never read its Supabase creds.
if [ -z "${OPENAI_API_KEY:-}" ] && [ -f "$HOME/.cerefox/.env" ]; then
  OPENAI_API_KEY=$(grep -E '^OPENAI_API_KEY=' "$HOME/.cerefox/.env" | head -1 | sed -E 's/^OPENAI_API_KEY=//; s/^["'\'']//; s/["'\'']$//') || true
fi

# 3. (Re)start the container with the INJECTED secret (entrypoint uses env over self-gen).
# Refresh the image first: pulls the newest published tag so a re-run picks up updates;
# harmless (|| true) for a locally-built tag that isn't in a registry.
docker pull "$IMAGE" 2>/dev/null || true
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
# shellcheck disable=SC2086
docker run -d --name "$CONTAINER" -p "$PORT:8000" \
  -v "$VOLUME:/var/lib/postgresql/data" \
  -e PGRST_JWT_SECRET="$SECRET" \
  ${OPENAI_API_KEY:+-e OPENAI_API_KEY=$OPENAI_API_KEY} \
  "$IMAGE" >/dev/null

# 4. Write a SEPARATE client config — cloud ~/.cerefox/.env is NEVER touched.
umask 077
cat > "$CONFIG_DIR/.env" <<EOF
# Cerefox LOCAL client config — separate from ~/.cerefox/.env so cloud + local coexist.
# Generated fresh (never copied from the cloud .env). Use it via:
#   CEREFOX_CONFIG_DIR=$CONFIG_DIR cerefox <cmd>
CEREFOX_SUPABASE_URL=http://localhost:$PORT
CEREFOX_SUPABASE_KEY=$JWT
EOF
[ -n "${OPENAI_API_KEY:-}" ] && printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY" >> "$CONFIG_DIR/.env"

echo "✓ Cerefox Local Server starting → http://localhost:$PORT/app/"
echo "  CLI/MCP against local:  CEREFOX_CONFIG_DIR=$CONFIG_DIR cerefox <cmd>"
echo "  Client config: $CONFIG_DIR/.env   (your cloud ~/.cerefox/.env is untouched)"
[ -n "${OPENAI_API_KEY:-}" ] || echo "  (no OPENAI_API_KEY in env or ~/.cerefox/.env → ingest/search disabled until set)"
