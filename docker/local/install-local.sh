#!/usr/bin/env sh
# Install + run the Cerefox Local Server — the all-in-one Docker image (Postgres+pgvector
# + PostgREST + cerefox-server, supervised by s6) PLUS a host `cerefox-local` command.
#
# This is the LOCAL/self-hosted world. It is SEPARATE from the cloud/Supabase world
# (the npm `cerefox` command): different installer, different command name, no collision.
#
# Docker-only — NO Node/Bun on the host. The container bundles the `cerefox` binary and
# self-generates its own JWT secret on boot; the credential NEVER leaves the container.
# The only host-side secret is OPENAI_API_KEY (for embeddings), kept in $CONFIG_DIR/.env
# so `cerefox-local upgrade` can re-pass it on container recreate.
#
# Usage (pulls the published ghcr image by default):
#   curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install-local.sh | sh
#   PORT=8017 OPENAI_API_KEY=sk-... sh install-local.sh
#
# Override the image (local build / pinned tag):
#   CEREFOX_LOCAL_IMAGE=cerefox-local:dev sh install-local.sh    # after a local docker build
#   CEREFOX_LOCAL_IMAGE=ghcr.io/fstamatelopoulos/cerefox-local:v0.10.0 sh install-local.sh
set -eu

IMAGE="${CEREFOX_LOCAL_IMAGE:-ghcr.io/fstamatelopoulos/cerefox-local:latest}"
DEFAULT_PORT=8000
# Track whether the user set PORT explicitly (we respect it) vs. took the default
# (we may auto-select a free one). Must check before applying the default.
if [ -n "${PORT:-}" ]; then PORT_EXPLICIT=true; else PORT_EXPLICIT=false; fi
PORT="${PORT:-$DEFAULT_PORT}"
CONFIG_DIR="${CEREFOX_LOCAL_CONFIG_DIR:-$HOME/.cerefox/local}"
CONTAINER="${CEREFOX_LOCAL_CONTAINER:-cerefox-local}"
VOLUME="${CEREFOX_LOCAL_VOLUME:-cerefox_local_pgdata}"
BIN_DIR="${CEREFOX_LOCAL_BIN_DIR:-$HOME/.local/bin}"

# Docker is a hard prerequisite. Unlike the cloud installer (which can drop Bun into
# user space), Docker is system infrastructure (daemon + admin install), so we detect +
# guide rather than auto-install.
if ! command -v docker >/dev/null 2>&1; then
  echo "✗ Docker is required but not found. Install it, then re-run this installer:"
  case "$(uname -s)" in
    Darwin) echo "    • Docker Desktop:  https://www.docker.com/products/docker-desktop/"
            echo "    • or Colima (CLI): brew install colima docker && colima start" ;;
    Linux)  echo "    • Your distro's package, or: curl -fsSL https://get.docker.com | sh"
            echo "      (then add yourself to the 'docker' group + start the service)" ;;
    *)      echo "    • https://docs.docker.com/get-docker/" ;;
  esac
  exit 1
fi
# Installed but the daemon may be stopped (Docker Desktop quit / Colima not started).
if ! docker info >/dev/null 2>&1; then
  echo "✗ Docker is installed but the daemon isn't running. Start it, then re-run:"
  case "$(uname -s)" in
    Darwin) echo "    • Start Docker Desktop, or run: colima start" ;;
    *)      echo "    • Start the Docker service (e.g. sudo systemctl start docker)" ;;
  esac
  exit 1
fi

mkdir -p "$CONFIG_DIR"; chmod 700 "$CONFIG_DIR"

# Port selection. The cloud `cerefox web` ALSO defaults to 8000, so a machine running
# both worlds collides. `port_busy` is best-effort (needs lsof; if absent we can't probe
# and let `docker run` fail loudly). An explicit PORT= is respected (error if busy); the
# default auto-steps by +10 past busy ports — and past 8000 itself when a cloud install
# (same default) is present, to avoid a latent `cerefox web` collision.
port_busy() {
  command -v lsof >/dev/null 2>&1 || return 1   # no lsof → can't probe; treat as free
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}
if [ "$PORT_EXPLICIT" = true ]; then
  if port_busy "$PORT"; then
    echo "✗ Port $PORT is already in use (you set PORT=$PORT). Choose a free port and re-run."
    exit 1
  fi
else
  cloud_present=false; [ -f "$HOME/.cerefox/.env" ] && cloud_present=true
  attempts=0
  while port_busy "$PORT" || { [ "$cloud_present" = true ] && [ "$PORT" = "$DEFAULT_PORT" ]; }; do
    PORT=$((PORT + 10)); attempts=$((attempts + 1))
    if [ "$attempts" -gt 50 ]; then
      echo "✗ Couldn't find a free port near $DEFAULT_PORT. Re-run with an explicit PORT=."
      exit 1
    fi
  done
  if [ "$PORT" != "$DEFAULT_PORT" ]; then
    if [ "$cloud_present" = true ]; then
      echo "ℹ Port $DEFAULT_PORT is the cloud Cerefox default (and/or busy) — using $PORT for local."
    else
      echo "ℹ Port $DEFAULT_PORT was busy — using $PORT for local."
    fi
  fi
fi

# Embedder key: prefer the env; else, ONLY if a cloud ~/.cerefox/.env happens to exist,
# borrow its OPENAI_API_KEY line as a convenience (we never read its Supabase creds).
OPENAI_FROM_CLOUD_ENV=false
if [ -z "${OPENAI_API_KEY:-}" ] && [ -f "$HOME/.cerefox/.env" ]; then
  OPENAI_API_KEY=$(grep -E '^OPENAI_API_KEY=' "$HOME/.cerefox/.env" | head -1 | sed -E 's/^OPENAI_API_KEY=//; s/^["'\'']//; s/["'\'']$//') || true
  [ -n "${OPENAI_API_KEY:-}" ] && OPENAI_FROM_CLOUD_ENV=true
fi

# 1. Pull + (re)start the container. It self-generates PGRST_JWT_SECRET on first boot
#    (persisted in the volume) and mints the service_role JWT internally — no host minting.
echo "Pulling $IMAGE …"
docker pull "$IMAGE" 2>/dev/null || true
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
# `--restart unless-stopped`: survive host reboots AND a transient first-boot PostgREST
# crash (a known GHC-startup segfault) — Docker re-runs the container and the 2nd boot is
# clean. It does NOT override a manual `cerefox-local stop`.
# shellcheck disable=SC2086
docker run -d --name "$CONTAINER" -p "$PORT:8000" \
  --restart unless-stopped \
  -v "$VOLUME:/var/lib/postgresql/data" \
  ${OPENAI_API_KEY:+-e OPENAI_API_KEY=$OPENAI_API_KEY} \
  "$IMAGE" >/dev/null

# 2. Write the host config (OPENAI key + the port, for `cerefox-local upgrade`).
#    NO JWT/URL here — those live in the container. Cloud ~/.cerefox/.env is untouched.
umask 077
{
  echo "# Cerefox LOCAL host config. The access token lives in the container, not here;"
  echo "# only the OpenAI key + port are stored. Manage with: cerefox-local init"
  echo "CEREFOX_LOCAL_PORT=$PORT"
  [ -n "${OPENAI_API_KEY:-}" ] && echo "OPENAI_API_KEY=$OPENAI_API_KEY"
} > "$CONFIG_DIR/.env"

# 3. Extract the host `cerefox-local` script from the image (single source of truth) and
#    put it on PATH via a symlink in $BIN_DIR.
docker cp "$CONTAINER:/opt/cerefox/cerefox-local" "$CONFIG_DIR/cerefox-local"
chmod +x "$CONFIG_DIR/cerefox-local"
mkdir -p "$BIN_DIR"
ln -sf "$CONFIG_DIR/cerefox-local" "$BIN_DIR/cerefox-local"

# 4. Wait for the web server to actually answer (a fresh first boot initializes Postgres
#    + deploys the schema, and may take one restart cycle), so the URL we print is live.
printf "Waiting for the server to come up"
i=0
until curl -fsS -o /dev/null "http://localhost:$PORT/api/v1/projects" 2>/dev/null; do
  i=$((i + 1)); [ "$i" -gt 45 ] && { echo " — still starting; check 'cerefox-local logs'."; break; }
  printf "."; sleep 2
done
[ "$i" -le 45 ] && echo " ready."

echo "✓ Cerefox Local Server → http://localhost:$PORT/app/"
echo "  Command:  cerefox-local <verb>   (installed at $BIN_DIR/cerefox-local)"
echo "  e.g.      cerefox-local status | search \"…\" | document ingest notes.md"
echo "  MCP:      cerefox-local configure-agent"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) echo "  ⚠ $BIN_DIR is not on your PATH — add it:";
     echo "      echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc  &&  source ~/.zshrc" ;;
esac
if [ -n "${OPENAI_API_KEY:-}" ]; then
  [ "$OPENAI_FROM_CLOUD_ENV" = true ] && echo "  (used the OPENAI_API_KEY found in your existing ~/.cerefox/.env)"
else
  echo "  ▸ Set your OpenAI key to enable ingest + search:  cerefox-local init"
fi
