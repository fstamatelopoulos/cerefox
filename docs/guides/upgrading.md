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

### Upgrading to v0.1.7+ (from any earlier version)

**Web UI replaced**: The Jinja2 + HTMX frontend was replaced with a React SPA. The web UI is now at `/app/` instead of `/`. The old root URL (`/`) shows a redirect page.

**New frontend build step**: Step 5 (`npm install && npm run build`) is required starting from v0.1.7. Earlier versions had no frontend build step.

**New dependency**: Node.js 18+ is required for building the frontend.

### Upgrading to v0.1.4+ (from v0.1.0-v0.1.3)

**Versioning schema**: Migration `0003_add_document_versions.sql` adds the `cerefox_document_versions` table and `version_id` column on `cerefox_chunks`. This is applied automatically by `db_migrate.py`.

### Upgrading to v0.1.1+ (from v0.1.0)

**Cloud-only embeddings**: Local embedders (mpnet, Ollama) were removed. If you were using a local embedder, switch to OpenAI or Fireworks AI and run `uv run cerefox reindex` to re-embed all chunks.
