# Upgrading Cerefox

This guide covers upgrading an existing Cerefox installation. All steps are idempotent and safe to re-run.

## Pick your path

Cerefox has two install paths since v0.4.0 (npm) and v0.5.0 (TS CLI). The right
upgrade procedure depends on how you installed Cerefox:

| You installed via | Upgrade with |
|---|---|
| **npm / Bun** (`@cerefox/memory` global) | `bun update -g @cerefox/memory` (or `npm update -g @cerefox/memory`), then read [`migration-v0.5.md`](migration-v0.5.md) for any breaking-change notes per version. **`cerefox doctor`** verifies the install. |
| **Source checkout** (`git clone` + `uv sync`) | The "Standard Upgrade Checklist" below — Python deps, schema migrations, Edge Functions, frontend build, the works. |
| **Both** (you contribute AND have the npm bin globally) | Both flows. The two paths share the same Supabase + `.env`; just keep them updated in lockstep. |

> If you're upgrading from Python `cerefox` to the npm-installed TS CLI for the first
> time, [`migration-v0.5.md`](migration-v0.5.md) is the canonical guide — it covers
> `cerefox init`'s coexistence flow (`[c]opy` your existing `.env` to `~/.cerefox/.env`),
> the v0.5.2 soft-wrapper removal, and the v0.5.3 paths precedence change.

The rest of this document covers the **source checkout** path (Python + frontend + Edge
Functions). If you're an npm-installed user, you've already got everything you need.

## Standard Upgrade Checklist (source-checkout users)

Run these steps every time you pull a new version:

```bash
# 1. Pull the latest code
git pull origin main

# 2. Install/update Python dependencies
uv sync

# 3. Apply database migrations (skips already-applied ones)
uv run python scripts/db_migrate.py

# 4. Redeploy RPC functions (safe to re-run)
uv run python scripts/db_deploy.py

# 5. Build the web UI
cd frontend && npm install && npm run build && cd ..

# 6. Deploy Edge Functions (if using Supabase-hosted)
#    Run from the project root (where supabase/ directory is)
npx supabase functions deploy cerefox-search
npx supabase functions deploy cerefox-ingest
npx supabase functions deploy cerefox-metadata
npx supabase functions deploy cerefox-get-document
npx supabase functions deploy cerefox-list-versions
npx supabase functions deploy cerefox-get-audit-log
npx supabase functions deploy cerefox-metadata-search
npx supabase functions deploy cerefox-mcp

# 7. Restart the application
uv run uvicorn cerefox.api.app:create_app --factory --reload

# 8. (Optional) Sync project docs to Cerefox knowledge base
uv run python scripts/sync_docs.py
```

Steps 3-4 require `CEREFOX_DATABASE_URL` in your `.env` file (direct Postgres connection). Steps 6 require the Supabase CLI and a linked project.

## Verifying the Upgrade

After upgrading, verify the key components:

```bash
# Check migration status
uv run python scripts/db_migrate.py --status

# Run unit tests (optional but recommended)
uv run pytest -q

# Visit the web UI
open http://localhost:8000/app/
```

## Version-Specific Notes

Most upgrades require no special steps beyond the standard checklist above. Notes below only apply when upgrading across specific version boundaries.

### Upgrading to v0.5.x (from any v0.4.x or earlier)

The v0.4 → v0.5 transition is a milestone — the CLI itself moved from Python
to TypeScript. The full migration guide is [`migration-v0.5.md`](migration-v0.5.md);
the short version for source-checkout users is:

- The Python `cerefox` CLI **still works** through v0.7.x — `uv sync` is enough
  to pull it. It prints a one-line ⚠ deprecation banner on every invocation.
- The new npm CLI lives alongside: `bun install -g @cerefox/memory` (or
  `npm install -g @cerefox/memory`). `cerefox doctor` from any directory will
  verify it.
- **v0.5.2** stripped the Python `cerefox mcp` soft-wrapper. If your MCP
  client config uses `uv run --directory /path/to/cerefox cerefox mcp`,
  nothing changes — that path runs the Python MCP server directly. If you
  want the TS server instead, point your client at `cerefox mcp`
  (npm-installed) or `npx -y --package=@cerefox/memory cerefox mcp`.
- **v0.5.3** changed the TS CLI's `.env` precedence: `~/.cerefox/.env` now
  wins over `<repo>/.env` when both exist. Your existing `<repo>/.env` keeps
  working until you run `cerefox init` and pick the `[c]opy` migration
  option. Python `paths.py` is unchanged.

No schema migration, no Edge Function redeploy, no chunk reindex required
for the v0.4 → v0.5.3 arc.

### Upgrading to v0.1.20 (from v0.1.19) -- Multi-Project Preservation Fix

**Edge Function redeploy is required.** v0.1.20 fixes
[issue #38](https://github.com/fstamatelopoulos/cerefox/issues/38): `cerefox_ingest`
no longer destructively replaces multi-project memberships when an agent updates
content with a single `project_name`. It also adds a new `project_names: string[]`
parameter for explicit full-set semantics and a new MCP tool
`cerefox_set_document_projects` for first-class agent control over project
membership independent of content updates.

The fix touches two Edge Functions in `supabase/functions/`. Pulling the new
code does **not** apply the TS changes to your live Supabase. After `git pull`,
step 6 of the standard checklist (Edge Function redeploy) is **mandatory for
this release**:

```bash
npx supabase functions deploy cerefox-ingest
npx supabase functions deploy cerefox-mcp
```

**If you skip this step**: the Python pipeline fix still applies on next local
MCP server restart, so the destructive bug is fixed for the local Python MCP
path. But the **remote MCP** (Claude.ai, ChatGPT Custom GPT via OpenAPI, any
HTTP MCP client pointed at `cerefox-mcp` Edge Function) and the **direct
`cerefox-ingest` Edge Function** path will still silently ignore `project_name`
on update — non-destructive, but agents can't add a membership via that path.
And the new `cerefox_set_document_projects` MCP tool won't appear in the remote
MCP tool list until `cerefox-mcp` is redeployed.

**No schema migration, no RPC redeploy, no chunk reindex** needed. The fix is
purely application-layer; the underlying junction table (`cerefox_document_projects`)
and its many-to-many semantics were always correct. Only the write surface had bugs.

**New behaviour to be aware of (no breaking changes)**:
- `cerefox_ingest` with `project_name="X"` on update → ensures membership in X,
  preserves all others (was: destructive replace in local MCP / silent ignore in TS).
- `cerefox_ingest` with `project_names=["X","Y","Z"]` (new) on update → sets
  full project set to exactly {X, Y, Z}; opt-in to destructive replace.
- `cerefox_ingest` with neither → no membership changes.
- `cerefox_set_document_projects(document_id, project_names=["X","Y"])` (new tool)
  → explicit metadata-only write of the full project set. Logged as
  `update-metadata` in the audit log.

Architectural rationale: see the cerefox#38 PR commit message and
[`docs/solution-design.md`](../solution-design.md).

### Upgrading to v0.1.19 (from v0.1.18) -- FTS Query Parser

**RPC redeploy is required.** v0.1.19 changes the FTS query parser used by
`cerefox_hybrid_search` and `cerefox_fts_search` from `websearch_to_tsquery`
to `plainto_tsquery`. The change lives in `src/cerefox/db/rpcs.sql` — pulling
the new code does **not** apply it. After `git pull`, step 4 of the standard
checklist (redeploy RPCs) is mandatory, not optional:

```bash
uv run python scripts/db_deploy.py
```

`db_deploy.py` is idempotent (`CREATE OR REPLACE FUNCTION`) and safe to
re-run. **If you skip this step, searches for any title containing `-`
(e.g. "Job Hunting - Opportunity Index", `setup-supabase`) will continue
to return zero results until the RPCs are redeployed.** This is the
single most common upgrade mistake for v0.1.19.

**No schema migration**, **no Edge Function redeploy**, **no chunk reindex**
needed for this change — the corpus side (`to_tsvector` in chunk `fts`
column) is unchanged; only the query parser changed. The link-resolver web
UI feature (the other half of v0.1.19) requires step 5 of the standard
checklist (rebuild the frontend); no backend changes are needed for that
half.

**Behaviour change to be aware of**: the new parser treats every query
token as a literal word and ANDs them together. It does **not** interpret
phrase quotes (`"…"`), `OR`, or `-` as operators. If you or any scripts
relied on Google-style search operators in `cerefox_search` queries, those
queries now treat the operator characters as literal tokens. The architectural
rationale lives in [`docs/solution-design.md` §5.2](../solution-design.md#52-title-boosting-search-quality).

### Upgrading to v0.1.14+ (from v0.1.13) -- Title Boosting

**One new migration**: `0011_title_boosting.sql`

- Drops the `GENERATED ALWAYS AS` expression on `cerefox_chunks.fts` (it can't cross-reference `cerefox_documents.title`)
- Adds `cerefox_update_chunk_fts(p_document_id, p_new_title)` RPC for title-change FTS refresh

Both are applied automatically by `db_migrate.py` (step 3). After the migration, also run `db_deploy.py` (step 4) to update the RPC definitions.

**Redeploy Edge Functions**: `cerefox-ingest` and `cerefox-mcp` now prepend the document title to chunk embedding inputs. Redeploy both:

```bash
npx supabase functions deploy cerefox-ingest
npx supabase functions deploy cerefox-mcp
```

**Optional reindex** (recommended for better search quality):

Existing chunks were embedded without the document title prefix and their FTS vectors don't include the document title at weight A. New documents ingested after this upgrade are automatically correct.

To upgrade existing chunks:

```bash
# Preview what would be reindexed (no changes made)
uv run python scripts/reindex_all.py --dry-run

# Reindex all chunks (re-embeds with title prefix, updates FTS)
# Uses 50 chunks per API call by default; lower --batch if you hit rate limits
uv run python scripts/reindex_all.py

# Or run directly via the CLI (same effect)
uv run cerefox server reindex --all
```

The reindex is **resumable**: if interrupted, re-running it skips chunks already embedded with the current model. Archived chunks (historical versions) are not reindexed -- they are not searched.

Cost estimate: ~$0.01-0.05 for a typical personal knowledge base (a few thousand chunks at `text-embedding-3-small` rates).

### Upgrading to v0.1.11+ (from v0.1.10)

**Two new migrations**:
- `0006_usage_log.sql` -- adds `cerefox_config` and `cerefox_usage_log` tables with 5 new RPCs
- `0007_usage_log_requestor.sql` -- renames `reader` column to `requestor` in `cerefox_usage_log`
  and updates all 3 usage RPCs. Non-destructive (existing data preserved).

Both are applied automatically by `db_migrate.py` (step 3 above). After migrations, also
redeploy RPCs via `db_deploy.py` (step 4) to update the canonical function definitions.

**New REST API endpoints**: `/api/v1/usage-log`, `/api/v1/usage-log/export.csv`,
`/api/v1/usage-log/summary`, `/api/v1/config/{key}`.

**Analytics page**: new page at `/app/analytics` with 7 interactive visualizations
(Nivo charts), date/project/path filters, usage tracking toggle, and CSV export.

**Usage tracking is opt-in**: disabled by default. Enable via CLI:
```bash
cerefox config set usage_tracking_enabled true
```
Or via the toggle on the Analytics page. When enabled, **all operations** (both reads
and writes) are logged with operation type, access path, requestor identity, query text,
and result count.

**Requestor attribution**: each usage log entry records who made the call:
- MCP tools: `"mcp-agent"` for reads, the `author` parameter value for writes (ingest)
- Web UI: `"user"`
- CLI: `"user"`
- Primitive Edge Functions: not attributed (access_path identifies the caller type)

**Edge Functions updated**: all primitive Edge Functions and `cerefox-mcp` now include
fire-and-forget usage logging calls for both reads and writes. Redeploy all Edge
Functions (step 6 above).

### Upgrading to v0.1.10+ (from any earlier version)

**New Edge Function**: `cerefox-metadata-search` must be deployed (included in step 6 above).

**Breaking change -- MCP tool `project_id` input removed**: The `cerefox_search`,
`cerefox_ingest`, and `cerefox_metadata_search` tools in `cerefox-mcp` now accept
`project_name` (human-readable string) instead of `project_id` (UUID). If you have
any AI agents that pass `project_id` in their MCP tool calls, update them to pass
`project_name` with the project's display name instead.

This change **only affects the MCP path** (`cerefox-mcp` Edge Function and local MCP
server). The primitive Edge Functions (`cerefox-search`, `cerefox-ingest`, etc.) still
accept `project_id UUID` and are unchanged.

**New data in search results**: All search and retrieval results now include a
`project_names` field (array of strings) alongside the existing `project_ids` field.
Existing callers that ignore unknown fields are unaffected.

**New MCP tools**: `cerefox_list_projects` (no parameters; returns all projects with
names and IDs) and `cerefox_metadata_search` are now available on all MCP paths.
MCP clients pick up new tools automatically on the next connection.

### Upgrading to v0.1.7+ (from any earlier version)

**Web UI replaced**: The Jinja2 + HTMX frontend was replaced with a React SPA. The web UI is now at `/app/` instead of `/`. The old root URL (`/`) shows a redirect page.

**New frontend build step**: Step 5 (`npm install && npm run build`) is required starting from v0.1.7. Earlier versions had no frontend build step.

**New dependency**: Node.js 18+ is required for building the frontend.

### Upgrading to v0.1.4+ (from v0.1.0-v0.1.3)

**Versioning schema**: Migration `0003_add_document_versions.sql` adds the `cerefox_document_versions` table and `version_id` column on `cerefox_chunks`. This is applied automatically by `db_migrate.py`.

### Upgrading to v0.1.1+ (from v0.1.0)

**Cloud-only embeddings**: Local embedders (mpnet, Ollama) were removed. If you were using a local embedder, switch to OpenAI or Fireworks AI and run `uv run cerefox server reindex` to re-embed all chunks.

## AI Agent Integration After Upgrade

After deploying new Edge Functions (step 6), AI agent integrations may need reconfiguration.

### MCP clients (Claude Code, Cursor, Claude Desktop)

If you are using the **remote MCP server** (Streamable HTTP via `cerefox-mcp` Edge Function), MCP clients will pick up new tools and updated tool signatures in **new sessions** started after the deploy. No reconfiguration needed -- just start a new conversation.

**Important**: MCP tool schemas are cached for the lifetime of a session. An existing session that already loaded the old tool definitions will not see changes even if you "restart" the AI client within the same session context. The schema is fetched once at session initialization and held in memory. Starting a completely new session (new conversation/window) is the only way to pick up schema changes.

This matters when you add a new parameter to an existing tool (e.g., adding `project_name` to `cerefox_search`): agents in open sessions will not know the parameter exists until they start a fresh session.

If you are still using the **local MCP server** (`cerefox mcp` via stdio), consider switching to the remote MCP server. The remote path is now the recommended default -- it supports all tools, runs server-side embedding, and works across machines. See `docs/guides/connect-agents.md` for setup instructions.

### ChatGPT Custom GPT (GPT Actions)

If you use GPT Actions pointing at the Cerefox Edge Functions, **check the OpenAPI schema version** in `docs/guides/connect-agents.md` after every upgrade. If the version has changed (e.g., from 1.4.0 to 1.5.0), you need to update the schema in the ChatGPT Custom GPT editor:

1. Open the Custom GPT editor and go to **Actions**
2. Replace the OpenAPI schema with the latest version from `docs/guides/connect-agents.md`
3. Save the schema
4. **Re-enter the API key**: go to **Authentication** settings and re-enter your Supabase **legacy anon JWT** (Project Settings → API Keys → Legacy → anon) as the Bearer token. The new `sb_publishable_…` key does not work for GPT Actions — see [`setup-supabase.md` → Supabase API keys (2026)](setup-supabase.md#supabase-api-keys-2026).

**Known issue**: the ChatGPT editor clears the Bearer token (legacy anon JWT) every time the OpenAPI schema is saved. This happens even if you only change whitespace. There is no workaround -- you must re-enter the key after every schema save.
