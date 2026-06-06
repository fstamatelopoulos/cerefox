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
# Bind to loopback by default — a single-user local backend shouldn't be exposed on the
# LAN. Set CEREFOX_LOCAL_BIND=0.0.0.0 to publish on all interfaces (e.g. LAN access).
BIND_ADDR="${CEREFOX_LOCAL_BIND:-127.0.0.1}"
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
    if port_busy "$DEFAULT_PORT"; then
      echo "ℹ Port $DEFAULT_PORT is in use — using $PORT for local."
    else
      echo "ℹ A cloud Cerefox install is present (~/.cerefox/.env), and \`cerefox web\` also"
      echo "  defaults to $DEFAULT_PORT — using $PORT for local to avoid a future collision."
      echo "  (Pass PORT=$DEFAULT_PORT to force $DEFAULT_PORT, or any port you prefer.)"
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

# Preserve any config overrides the user added to a prior local .env (we only manage
# OPENAI + port), and forward them into the container. Same whitelist cerefox-local uses;
# never the container-managed SUPABASE/DB/JWT vars.
PASSTHROUGH_VARS="CEREFOX_MIN_SEARCH_SCORE CEREFOX_MAX_RESPONSE_BYTES CEREFOX_MAX_CHUNK_CHARS CEREFOX_MIN_CHUNK_CHARS CEREFOX_VERSION_RETENTION_HOURS CEREFOX_VERSION_CLEANUP_ENABLED CEREFOX_OPENAI_BASE_URL CEREFOX_OPENAI_EMBEDDING_MODEL CEREFOX_OPENAI_EMBEDDING_DIMENSIONS CEREFOX_AUTHOR_NAME CEREFOX_AUTHOR_TYPE CEREFOX_REQUESTOR_NAME"
PRESERVED_OVERRIDES=""
ENV_ARGS=""
if [ -f "$CONFIG_DIR/.env" ]; then
  for v in $PASSTHROUGH_VARS; do
    line=$(grep -E "^${v}=" "$CONFIG_DIR/.env" | head -1)
    if [ -n "$line" ]; then
      PRESERVED_OVERRIDES="${PRESERVED_OVERRIDES}${line}
"
      ENV_ARGS="$ENV_ARGS -e $line"
    fi
  done
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
docker run -d --name "$CONTAINER" -p "$BIND_ADDR:$PORT:8000" \
  --restart unless-stopped \
  -v "$VOLUME:/var/lib/postgresql/data" \
  ${OPENAI_API_KEY:+-e OPENAI_API_KEY=$OPENAI_API_KEY} \
  $ENV_ARGS \
  "$IMAGE" >/dev/null

# 2. Write the host config (OPENAI key + port + any preserved overrides). NO JWT/URL here
#    — those live in the container. Cloud ~/.cerefox/.env is untouched.
umask 077
{
  echo "# Cerefox LOCAL host config. The access token lives in the container, not here;"
  echo "# only the OpenAI key + port + optional CEREFOX_* tuning overrides are stored."
  echo "# Add overrides (see docs/guides/configuration.md), then: cerefox-local init"
  echo "CEREFOX_LOCAL_PORT=$PORT"
  echo "CEREFOX_LOCAL_BIND=$BIND_ADDR"
  [ -n "${OPENAI_API_KEY:-}" ] && echo "OPENAI_API_KEY=$OPENAI_API_KEY"
  [ -n "$PRESERVED_OVERRIDES" ] && printf '%s' "$PRESERVED_OVERRIDES"
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

# 5. Shell tab-completion (best-effort, idempotent; mirrors the cloud installer). Generate
#    the cerefox-local-namespaced script from the container and source it from the shell rc.
#    `completion install` can't be proxied (it would write inside the container), so we do
#    the host-side wiring here. Failures never abort the install.
COMPLETION_MSG=""
comp_shell="$(basename "${SHELL:-}")"
case "$comp_shell" in
  bash|zsh|fish)
    comp_file="$HOME/.cerefox-local-completion.$comp_shell"
    if docker exec -e CEREFOX_PROG_NAME=cerefox-local "$CONTAINER" cerefox completion "$comp_shell" \
         > "$comp_file" 2>/dev/null && [ -s "$comp_file" ]; then
      if [ "$comp_shell" = "fish" ]; then
        fishdir="$HOME/.config/fish/completions"
        if mkdir -p "$fishdir" 2>/dev/null && cp "$comp_file" "$fishdir/cerefox-local.fish" 2>/dev/null; then
          COMPLETION_MSG="  ✓ shell completion (fish) installed — restart fish to activate."
        fi
      else
        rc="$HOME/.${comp_shell}rc"
        marker="# >>> cerefox-local shell completion >>>"
        if [ -f "$rc" ] && grep -qF "$marker" "$rc" 2>/dev/null; then
          COMPLETION_MSG="  ✓ shell completion already wired (in $rc)."
        else
          printf '\n%s\n[ -s "%s" ] && source "%s"\n# <<< cerefox-local shell completion <<<\n' \
            "$marker" "$comp_file" "$comp_file" >> "$rc" 2>/dev/null || true
          if grep -qF "$marker" "$rc" 2>/dev/null; then
            COMPLETION_MSG="  ✓ shell completion installed → activate now: exec $comp_shell"
          fi
        fi
      fi
    fi
    ;;
esac

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
[ -n "$COMPLETION_MSG" ] && echo "$COMPLETION_MSG"
