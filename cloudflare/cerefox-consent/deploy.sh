#!/usr/bin/env bash
#
# Deploy the Cerefox OAuth consent page to a free Cloudflare Worker.
#
# Reads your Supabase project URL + PUBLISHABLE key from ~/.cerefox/.env and injects
# them at deploy time, so the committed wrangler.toml stays generic (no project values
# in the repo). First run opens a browser for `wrangler login`; the free Workers plan
# gives you a `*.workers.dev` URL — no owned domain or credit card needed.
#
# SECURITY: this deploys the sb_publishable_… key (public-safe), NOT the legacy anon
# JWT. The anon JWT is a full-KB credential and must never be world-readable.
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
  echo "    npx wrangler deploy --var SUPABASE_URL:https://<ref>.supabase.co --var SUPABASE_PUBLISHABLE_KEY:sb_publishable_..." >&2
  exit 1
fi

url=$(grep -m1 '^CEREFOX_SUPABASE_URL=' "$ENV_FILE" | cut -d= -f2-)
pub=$(grep -m1 '^CEREFOX_SUPABASE_PUBLISHABLE_KEY=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$url" ] || [ -z "$pub" ]; then
  echo "✗ Could not read CEREFOX_SUPABASE_URL and/or CEREFOX_SUPABASE_PUBLISHABLE_KEY from $ENV_FILE" >&2
  echo "  Add CEREFOX_SUPABASE_PUBLISHABLE_KEY (your sb_publishable_… key from Supabase →" >&2
  echo "  Project Settings → API Keys → Publishable) to $ENV_FILE. Do NOT use the anon JWT here." >&2
  exit 1
fi

cd "$(dirname "$0")"
echo "▶ Deploying the Cerefox consent Worker for $url (publishable key)"
npx wrangler deploy --var "SUPABASE_URL:$url" --var "SUPABASE_PUBLISHABLE_KEY:$pub"

cat <<'EOF'

Next:
  1. Copy the printed https://cerefox-consent.<subdomain>.workers.dev URL.
  2. Supabase → Authentication → URL Configuration → Site URL = that URL.
     (Authorization Path stays /consent → consent page at …workers.dev/consent)
  3. Continue the OAuth setup: docs/guides/setup-supabase.md Step 7.
EOF
