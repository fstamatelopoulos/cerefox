# Migrating to Cerefox 1.0.0

Cerefox 1.0.0 is the first stable release. Two changes need attention when you
upgrade an existing Supabase deployment; a third is automatic. **Nothing here
affects the local/self-hosted (World B) backend.**

## 1. Edge Function auth: anon key → Cerefox access token (action required)

The legacy Supabase **anon JWT** is no longer accepted for calling Cerefox Edge
Functions. Every function now validates a rotatable, Cerefox-managed **access token**
(`cfx_pat_…`) in-function. This is a **breaking change** for two client classes:

- **ChatGPT Custom GPTs** using GPT Actions.
- **Remote HTTP MCP** clients (any client pointed at `cerefox-mcp` with a static Bearer).

**Local agents and cloud Claude are unaffected** (local MCP uses the Data API; cloud
Claude uses OAuth).

### `.env` / secrets changes

| Variable | Change |
|---|---|
| `CEREFOX_ACCESS_TOKENS` | **New** — Supabase **Function secret**, the server-side accepted set (comma-separated; enables rotation). Set by `cerefox token generate`. |
| `CEREFOX_ACCESS_TOKEN` | **New** — in your local `.env`, the token this machine presents (used by `cerefox doctor`, the live tests, and the optional remote-MCP client). Written by `cerefox token generate`. |
| `CEREFOX_MCP_STATIC_BEARER` | **Remove** — the legacy anon static-Bearer for `cerefox-mcp` is gone. |
| `CEREFOX_SUPABASE_ANON_KEY` | **No longer used** for Edge Function auth. Safe to delete from `.env`. |
| `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY` | **Unchanged** — the Data API / local MCP path is not affected. |

### Steps (in order — there is a brief cutover window)

1. **Generate the token:** `cerefox token generate` — mints it, sets the
   `CEREFOX_ACCESS_TOKENS` Function secret on Supabase, writes `CEREFOX_ACCESS_TOKEN`
   into your `.env`, and prints it once.
2. **Deploy the token-gated functions** (this also applies change #2 below):
   `cerefox server deploy`. (If `CEREFOX_ACCESS_TOKENS` is unset, the functions reject
   every caller, so keep step 1 first.)
3. **Update your clients** (promptly after step 2):
   - **Custom GPT (GPT Actions):** re-paste the OpenAPI schema (its `info.version` bumped,
     so ChatGPT clears the stored key), then set **Authentication → API Key** to your
     Cerefox access token (Bearer).
   - **Remote HTTP MCP:** replace the anon key in the `Authorization: Bearer` header.
4. **Verify:** `cerefox doctor` (the edge-functions check should pass).
5. **Revoke the legacy anon key** in the Supabase dashboard (Project Settings → API Keys →
   Legacy). Nothing at runtime uses it anymore.
6. **Remove the retired consent Edge Function** (if you deployed it):
   `npx supabase functions delete cerefox-oauth-consent`. The OAuth consent page is now
   served solely by the Cloudflare Worker (`cloudflare/cerefox-consent/`).

Rotating the token later: `cerefox token rotate` (accepts new + old for zero-downtime),
then `cerefox token rotate --finalize` once every client is on the new token.

## 2. New schema (→ 0.8.1): document reconstruction fix (redeploy required, no data action)

1.0.0 fixes a document-reconstruction bug that could corrupt documents containing large
tables or blank-line-free paragraphs. It adds a `content_format` column on
`cerefox_chunks`. **You just redeploy** — `cerefox server deploy` (step 2 above) applies
the schema change.

The migration is **lazy and safe**:

- Existing documents keep the legacy format and reconstruct **exactly as before** — nothing
  re-processes, nothing re-embeds.
- A document moves to the new format automatically the next time it is edited/saved. To
  convert everything now instead, run `cerefox server reindex`.
- `cerefox doctor` shows how many documents still use the legacy format.

Details: `cerefox guides show content-format` (or [`content-format.md`](content-format.md)).

## 3. Python is fully removed at 1.0.0 (breaking)

**The Python implementation is deleted in 1.0.0** — including the frozen MCP-server fallback
(`uv run cerefox mcp`), the husked Python CLI / web / ingestion packages, and
`pyproject.toml`. There is no Python code left to run.

If you still invoke `uv run cerefox mcp`, switch to the maintained local server:

```bash
npx --package=@cerefox/memory cerefox mcp
```

(or stay on 0.11.x until you have migrated). The TypeScript CLI, local MCP, remote MCP, and
web app are the only maintained paths. The SQL schema assets under `src/cerefox/db/` are
unaffected — they are not Python and remain the source of truth for the schema + RPCs.

## Upgrade order summary

```bash
cerefox self-update            # or: npm install -g @cerefox/memory@latest
cerefox token generate         # change #1: mint + set the access token
cerefox server deploy          # changes #1 + #2: token-gated EFs + schema 0.8.1 (0.8.2 as of v1.0.1)
cerefox doctor                 # verify (edge-functions green; content-format ℹ)
# then: update GPT Actions / remote MCP clients to the token; revoke the anon key
```
