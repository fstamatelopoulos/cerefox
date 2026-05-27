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
VERSION_HINT=""

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

case "${INSTALLER}" in
  bun)
    bun install -g "${PACKAGE}${VERSION_HINT}"
    ;;
  npm)
    npm install -g "${PACKAGE}${VERSION_HINT}"
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
echo ""
echo "Next steps:"
echo "  1. cerefox init                 # interactive setup (~2 min)"
echo "  2. cerefox doctor               # verify the install"
echo "  3. cerefox docs --list          # see bundled docs offline"
echo ""
echo "Wire up an AI agent: cerefox configure-agent --tool claude-code"
echo "Migration from v0.4: https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/migration-v0.5.md"
echo ""
