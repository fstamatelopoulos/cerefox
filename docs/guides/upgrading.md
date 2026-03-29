# Upgrading Cerefox

This guide covers upgrading an existing Cerefox installation to the latest version. All steps are idempotent and safe to re-run.

## Standard Upgrade Checklist

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

### Upgrading to v0.1.10+ (from any earlier version)

**New Edge Function**: `cerefox-metadata-search` must be deployed (step 6 above). The
standard checklist does not yet include it -- add this line:

```bash
npx supabase functions deploy cerefox-metadata-search
```

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

**Cloud-only embeddings**: Local embedders (mpnet, Ollama) were removed. If you were using a local embedder, switch to OpenAI or Fireworks AI and run `uv run cerefox reindex` to re-embed all chunks.

## AI Agent Integration After Upgrade

After deploying new Edge Functions (step 6), AI agent integrations may need reconfiguration.

### MCP clients (Claude Code, Cursor, Claude Desktop)

If you are using the **remote MCP server** (Streamable HTTP via `cerefox-mcp` Edge Function), MCP clients will pick up new tools automatically on the next connection. No reconfiguration needed.

If you are still using the **local MCP server** (`cerefox mcp` via stdio), consider switching to the remote MCP server. The remote path is now the recommended default -- it supports all tools, runs server-side embedding, and works across machines. See `docs/guides/connect-agents.md` for setup instructions.

### ChatGPT Custom GPT (GPT Actions)

If you use GPT Actions pointing at the Cerefox Edge Functions, **check the OpenAPI schema version** in `docs/guides/connect-agents.md` after every upgrade. If the version has changed (e.g., from 1.4.0 to 1.5.0), you need to update the schema in the ChatGPT Custom GPT editor:

1. Open the Custom GPT editor and go to **Actions**
2. Replace the OpenAPI schema with the latest version from `docs/guides/connect-agents.md`
3. Save the schema
4. **Re-enter the API key**: go to **Authentication** settings and re-enter your Supabase anon key as the Bearer token

**Known issue**: the ChatGPT editor clears the Bearer token (anon key) every time the OpenAPI schema is saved. This happens even if you only change whitespace. There is no workaround -- you must re-enter the key after every schema save.
