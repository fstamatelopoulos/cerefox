#!/usr/bin/env sh
# Cerefox one-line install script.
#
# Usage:
#   curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh
#
# Detects Bun first (faster, single-binary runtime, no extra Node
# install); falls back to npm if Bun isn't available and Node ≥ 20 is.
# If neither runtime is found, prints clear next-step instructions and
# exits 1.
#
# Hosting: this script is attached to each GitHub Release as a stable
# `install.sh` asset so the `latest` URL above always serves the most
# recent. Cut by `scripts/cut_release.ts` (which uploads it after the
# Release is created — see Part 23I.2).

set -eu

PACKAGE="@cerefox/memory"
# Default to the `latest` dist-tag (not a bare name). A bare
# `bun install -g @cerefox/memory` treats an already-installed global as
# satisfied and skips the upgrade, so a re-install kept the old version;
# pinning `@latest` re-resolves the dist-tag (and the install below bypasses
# the stale manifest cache — see the note there). Overridden by the VERSION
# env below.
VERSION_HINT="@latest"

# Allow opting into a specific version via env: VERSION=0.5.0-rc.1 sh install.sh
if [ -n "${VERSION:-}" ]; then
  VERSION_HINT="@${VERSION}"
fi

echo ""
echo "Cerefox — user-owned shared memory for AI agents"
echo "https://github.com/fstamatelopoulos/cerefox"
echo ""

#
# Phase 1: detect a JS runtime + package manager.
#

INSTALLER=""
INSTALLER_DESCRIPTION=""

if command -v bun >/dev/null 2>&1; then
  INSTALLER="bun"
  INSTALLER_DESCRIPTION="Bun"
elif command -v npm >/dev/null 2>&1; then
  # npm needs Node ≥ 20 to publish/install ESM packages with the
  # provenance attestations we ship. Cerefox itself only needs Node 20
  # for the bin to run.
  NODE_MAJOR=$(node -p "parseInt(process.versions.node.split('.')[0],10)" 2>/dev/null || echo "0")
  if [ "${NODE_MAJOR}" -lt 20 ]; then
    echo "✗ Detected npm with Node ${NODE_MAJOR}, but Cerefox requires Node ≥ 20."
    echo "  Upgrade Node (https://nodejs.org) or install Bun (https://bun.sh)."
    exit 1
  fi
  INSTALLER="npm"
  INSTALLER_DESCRIPTION="npm (Node ${NODE_MAJOR})"
fi

#
# Phase 2: bootstrap Bun if nothing is on PATH.
#

if [ -z "${INSTALLER}" ]; then
  echo "ℹ No Bun or Node ≥ 20 detected. Installing Bun (https://bun.sh)…"
  echo ""
  curl -fsSL https://bun.sh/install | bash
  # Bun installs to ~/.bun/bin/bun; add it to PATH for the rest of this
  # script run.
  export PATH="${HOME}/.bun/bin:${PATH}"
  if ! command -v bun >/dev/null 2>&1; then
    echo ""
    echo "✗ Bun install completed but `bun` is not on PATH."
    echo "  Add ${HOME}/.bun/bin to your PATH and re-run this script."
    exit 1
  fi
  INSTALLER="bun"
  INSTALLER_DESCRIPTION="Bun (just installed)"
fi

echo "→ Using ${INSTALLER_DESCRIPTION} to install ${PACKAGE}${VERSION_HINT}…"
echo ""

# Force a fresh registry manifest fetch. `@latest` alone is not enough: bun
# (and npm) cache the package *manifest* locally and may reuse a stale copy
# that predates a just-published version — so a re-install soon after the
# previous one can resolve `@latest` to the OLD version, or fail to find a
# pinned new version. `--no-cache` (bun) / `--prefer-online` (npm) bypass that
# manifest cache so the newly published version is always seen.
case "${INSTALLER}" in
  bun)
    bun install -g --no-cache "${PACKAGE}${VERSION_HINT}"
    ;;
  npm)
    npm install -g --prefer-online "${PACKAGE}${VERSION_HINT}"
    ;;
esac

echo ""

if ! command -v cerefox >/dev/null 2>&1; then
  echo "⚠ Install completed but `cerefox` is not on PATH."
  echo "  Check your installer's global bin dir (e.g. ~/.bun/bin/)."
  exit 1
fi

VERSION_OUT="$(cerefox --version 2>/dev/null || echo "?")"
echo "✓ Cerefox ${VERSION_OUT} installed at $(command -v cerefox)"

# Shell tab-completion (best-effort, idempotent). Regenerates the completion
# script (so new commands appear on upgrade) and adds a sentinel-marked source
# line to your shell rc. --yes because this runs non-interactively (curl | sh).
# Remove the `# >>> cerefox shell completion >>>` block from your rc to undo.
# The activation reminder is deferred to the very end of this script so it
# isn't buried under the "Next steps" block.
if cerefox completion install --yes >/dev/null 2>&1; then
  COMPLETION_STATUS="ok"
  echo "✓ Shell completion installed."
else
  COMPLETION_STATUS="failed"
  echo "ℹ Shell completion not set up automatically."
fi

echo ""
echo "Next steps:"
echo "  1. cerefox init                 # interactive setup (~2 min)"
echo "  2. cerefox doctor               # verify the install"
echo "  3. cerefox guides list          # see bundled docs offline"
echo ""
echo "Wire up an AI agent — configures a local 'cerefox mcp' server for each"
echo "(run the ones that apply):"
echo "  cerefox configure-agent --tool claude-code"
echo "  cerefox configure-agent --tool claude-desktop"
echo "  cerefox configure-agent --tool cursor"
echo "  cerefox configure-agent --tool codex"
echo "  cerefox configure-agent --tool gemini"
echo ""
echo "Upgrading from an earlier version?"
echo "  • Upgrade guide: https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/upgrading.md"
echo "  • If any AI agent uses the local MCP server, restart it so it picks up"
echo "    the version you just installed. A running agent keeps executing the"
echo "    'cerefox mcp' process it spawned at startup until it's restarted."

# Activation reminder LAST, as a prominent banner, so it isn't missed.
echo ""
echo "════════════════════════════════════════════════════════════"
if [ "${COMPLETION_STATUS}" = "ok" ]; then
  echo "  ⚡ Shell completion is installed but NOT active in this"
  echo "     terminal yet. To activate it now, run:"
  echo ""
  echo "         exec \$SHELL          # or just open a new terminal"
else
  echo "  ⚡ To enable shell tab-completion, run:"
  echo ""
  echo "         cerefox completion install"
fi
echo "════════════════════════════════════════════════════════════"
echo ""
