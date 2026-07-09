# Migration: Edge Function access tokens (0.12)

This release retires the legacy Supabase **anon JWT** as the credential for calling
Cerefox Edge Functions and replaces it with a rotatable, Cerefox-managed **access token**
(`cfx_pat_…`). It is a **breaking change** for two client classes:

- **ChatGPT Custom GPTs** using GPT Actions (they called the Edge Functions with the anon key).
- **Remote HTTP MCP** clients (any client pointed at `cerefox-mcp` with a static Bearer).

**Local agents and cloud Claude are unaffected.** Local agents use the local MCP (Data API,
its own secret key), and claude.ai / Claude mobile use OAuth. Only the anon-key/Edge-Function
path changes.

Why: on Supabase projects using asymmetric (ES256) signing keys, the anon key can only be
**revoked, not rotated**, so a leak could not be cycled without disabling the Edge Function
path. The Cerefox access token is secret, scoped to Edge Function access, and rotatable.

## `.env` / secrets changes

| Variable | Change |
|---|---|
| `CEREFOX_ACCESS_TOKENS` | **New** — Supabase **Function secret**, the server-side accepted set (comma-separated; enables rotation). Set by `cerefox token generate`. |
| `CEREFOX_ACCESS_TOKEN` | **New** — in your local `.env`, the one token this machine presents (used by `cerefox doctor`, the live tests, and the optional remote-MCP client). Written by `cerefox token generate`. |
| `CEREFOX_MCP_STATIC_BEARER` | **Remove** — the legacy anon static-Bearer for `cerefox-mcp` is gone. |
| `CEREFOX_SUPABASE_ANON_KEY` | **No longer used** for Edge Function auth. Safe to delete from `.env`; kept parseable only for back-compat. |
| `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY` | **Unchanged** — the Data API / local MCP path is not affected. |

## Upgrade steps

Run these in order. There is a brief cutover window between deploying the token-gated
functions and updating your clients (the anon key stops working the moment the new functions
go live), so do steps 2 and 3 close together.

1. **Generate the token:**
   ```bash
   cerefox token generate
   ```
   This mints the token, sets the `CEREFOX_ACCESS_TOKENS` Function secret on Supabase, writes
   `CEREFOX_ACCESS_TOKEN` into your `.env`, and prints the token once. Store it securely.

2. **Deploy the token-gated Edge Functions:**
   ```bash
   cerefox server deploy
   ```
   All nine functions now validate the token in-function. (If `CEREFOX_ACCESS_TOKENS` is not
   set, they reject every caller, so keep step 1 before this.)

3. **Update your clients to the token** (promptly after step 2):
   - **Custom GPT (GPT Actions):** re-paste the OpenAPI schema (its `info.version` bumped, so
     ChatGPT will clear the stored key), then in **Configure → Actions → Authentication → API
     Key** enter your Cerefox access token as the **Bearer** value.
   - **Remote HTTP MCP:** replace the anon key in the `Authorization: Bearer` header with the
     token.

4. **Verify:**
   ```bash
   cerefox doctor
   ```
   The edge-functions check should pass (it now uses `CEREFOX_ACCESS_TOKEN`).

5. **Revoke the legacy anon key** in the Supabase dashboard (Project Settings → API Keys →
   Legacy). Nothing at runtime uses it anymore: OAuth uses the project JWKS, the local MCP
   uses the Data API secret key, and the Edge Functions use the Cerefox token.

6. **Remove the retired consent Edge Function** (if you had deployed it):
   ```bash
   npx supabase functions delete cerefox-oauth-consent
   ```
   The OAuth consent page is now served solely by the Cloudflare Worker
   (`cloudflare/cerefox-consent/`).

## Rotating the token later

```bash
cerefox token rotate            # accept the new AND previous token (zero-downtime)
# ...update every client to the new token...
cerefox token rotate --finalize # stop accepting the previous token
```
