# Cerefox OAuth consent page — Cloudflare Worker

This is the **consent page** for connecting cloud/mobile Claude (and other OAuth MCP
clients) to your Cerefox knowledge base. It's the screen where you approve the
connection during the OAuth flow.

**Why a Cloudflare Worker and not a Supabase Edge Function?** Supabase rewrites
`text/html` responses to `text/plain` on the default `*.supabase.co` domain (an
anti-phishing measure), so an Edge Function can't render a real page there without a
paid custom domain. The page is a single static file (all logic runs client-side via
`supabase-js`), so a free Cloudflare Worker serves it perfectly. This is **optional
infrastructure** — you only need it if you want claude.ai web / Claude mobile; the
local MCP, Claude Desktop, Cursor, Claude Code, etc. don't use it.

It holds **no secrets**: the only values baked in are your Supabase project URL and the
**publishable** key (`sb_publishable_…`) — a public-safe key that grants no KB access (the
Edge Function gateway rejects it, and since schema 0.7.0 it cannot call the Data API RPCs
either). It must **not** be the legacy anon JWT, which is a full-KB credential. Sign-in
happens against your own Supabase Auth, in the browser.

## Deploy

Prerequisite: a free [Cloudflare account](https://dash.cloudflare.com/sign-up) (no
domain, no card). The Workers free tier includes a `*.workers.dev` subdomain.

**One command** (reads `CEREFOX_SUPABASE_URL` + `CEREFOX_SUPABASE_PUBLISHABLE_KEY` from `~/.cerefox/.env`):

```bash
cd cloudflare/cerefox-consent
./deploy.sh
```

The first run opens a browser for `wrangler login`. On success it prints your Worker
URL, e.g. `https://cerefox-consent.<your-subdomain>.workers.dev`.

**Manual equivalent** (if you don't use `~/.cerefox/.env`, or want to see what it does):

```bash
npx wrangler login
npx wrangler deploy \
  --var SUPABASE_URL:https://<your-project-ref>.supabase.co \
  --var SUPABASE_PUBLISHABLE_KEY:sb_publishable_...
```

Both values are public. They're injected at deploy time so the committed
`wrangler.toml` stays generic (its `[vars]` are placeholders).

## After deploying

1. Copy the printed `…workers.dev` URL.
2. Supabase Dashboard → **Authentication → URL Configuration → Site URL** = that URL.
   (Keep the OAuth Server **Authorization Path** at `/consent`, so the consent page is
   served at `…workers.dev/consent`.)
3. Finish the rest of the OAuth setup in
   [`docs/guides/setup-supabase.md` Step 7](../../docs/guides/setup-supabase.md).

## Files

- `src/index.ts` — the Worker: serves the shared consent markup
  (`_shared/consent-page/renderConsentPage()`) as real `text/html`.
- `wrangler.toml` — Worker config; `[vars]` are generic placeholders (overridden by
  `deploy.sh` / `--var`).
- `deploy.sh` — reads `~/.cerefox/.env` and deploys.

The markup + client-side OAuth logic live once in `_shared/consent-page/`, imported by this
Worker. (The `cerefox-oauth-consent` Edge Function that previously shared this module was
**removed in iter-28E**; this Worker is now the sole consent page. The `_shared/consent-page/`
module is retained.)

## Updating

Re-run `./deploy.sh` after any change to `_shared/consent-page/` or `src/index.ts`.
