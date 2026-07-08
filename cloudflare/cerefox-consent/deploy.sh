#!/usr/bin/env bash
#
# Deploy the Cerefox OAuth consent page to a free Cloudflare Worker.
#
# Reads your Supabase project URL + anon key from ~/.cerefox/.env (both are PUBLIC
# values) and injects them at deploy time, so the committed wrangler.toml stays
# generic (no project-specific values in the repo). First run opens a browser for
# `wrangler login`; the free Workers plan gives you a `*.workers.dev` URL — no owned
# domain or credit card needed.
#
# Usage:
#   cd cloudflare/cerefox-consent && ./deploy.sh
#   CEREFOX_ENV=/path/to/.env ./deploy.sh      # non-default env file
#
set -euo pipefail

ENV_FILE="${CEREFOX_ENV:-$HOME/.cerefox/.env}"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ No env file at $ENV_FILE" >&2
  echo "  Set CEREFOX_ENV, or deploy manually:" >&2
  echo "    npx wrangler deploy --var SUPABASE_URL:https://<ref>.supabase.co --var SUPABASE_ANON_KEY:<anon-jwt>" >&2
  exit 1
fi

url=$(grep -m1 '^CEREFOX_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
anon=$(grep -m1 '^CEREFOX_SUPABASE_ANON_KEY=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$url" ] || [ -z "$anon" ]; then
  echo "✗ Could not read CEREFOX_SUPABASE_URL and/or CEREFOX_SUPABASE_ANON_KEY from $ENV_FILE" >&2
  echo "  The anon key is the legacy anon JWT (starts with eyJ). Both are public values." >&2
  exit 1
fi

cd "$(dirname "$0")"
echo "▶ Deploying the Cerefox consent Worker for $url"
npx wrangler deploy --var "SUPABASE_URL:$url" --var "SUPABASE_ANON_KEY:$anon"

cat <<'EOF'

Next:
  1. Copy the printed https://cerefox-consent.<subdomain>.workers.dev URL.
  2. Supabase → Authentication → URL Configuration → Site URL = that URL.
     (Authorization Path stays /consent → consent page at …workers.dev/consent)
  3. Continue the OAuth setup: docs/guides/setup-supabase.md Step 7.
EOF
