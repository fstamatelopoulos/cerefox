# Cerefox Implementation Plan

> **Approach**: Iterative and agile. Each iteration delivers working functionality.
> Update this file as iterations are completed and new work is planned.

---

## Iteration 1: Foundation — Project Setup & Database ✓

**Goal**: Runnable Python project with database schema deployed to Supabase.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Initialize Python project (pyproject.toml, uv, ruff config) | Done | uv project, ruff at line-length 100 |
| 1.2 | Create project directory structure (src/cerefox/*) | Done | Matches CLAUDE.md tree |
| 1.3 | Write config module (pydantic-settings, .env support) | Done | `src/cerefox/config.py`, CEREFOX_ prefix |
| 1.4 | Write database schema SQL (documents, chunks, projects tables) | Done | `src/cerefox/db/schema.sql` — HNSW, FTS GENERATED col |
| 1.5 | Write search RPC SQL (hybrid, FTS, semantic, reconstruct) | Done | `src/cerefox/db/rpcs.sql` — all SECURITY DEFINER |
| 1.6 | Create DB client wrapper (Supabase Python client) | Done | `src/cerefox/db/client.py` — lazy init, typed methods |
| 1.7 | Write `scripts/db_deploy.py` — apply full schema to a fresh instance | Done | psycopg2, `--dry-run`, `--reset` flags |
| 1.8 | Write `scripts/db_status.py` — verify schema and report table stats | Done | Checks extensions, tables, functions, indexes, row counts |
| 1.9 | Deploy schema to Supabase using db_deploy.py | Done | Schema deployed to live Supabase instance |
| 1.10 | Write tests for config module and DB client (unit, mocked) | Done | 40 tests pass — `tests/test_config.py`, `tests/test_db_client.py` |
| 1.11 | Write `docs/guides/setup-supabase.md` and `docs/guides/configuration.md` | Done | Step-by-step setup guide + full config reference |

**Deliverable**: Schema running on Supabase, Python project builds and imports, deploy script and Supabase setup guide complete.

---

## Iteration 2: Chunking & Embeddings ✓

**Goal**: Markdown chunking engine and pluggable embedding system.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | Implement heading-based markdown chunker | Done | `src/cerefox/chunking/markdown.py` — H1>H2>H3 cascade, regex split |
| 2.2 | Add chunk size management (max/min chars, paragraph fallback) | Done | Heading boundaries never merged; paragraph pieces may merge if tiny |
| 2.3 | Implement Embedder protocol (base.py) | Done | `@runtime_checkable` Protocol |
| 2.4 | Implement all-mpnet-base-v2 embedder | Done | `src/cerefox/embeddings/mpnet.py` — lazy model load |
| 2.5 | Implement Ollama embedder | Done | `src/cerefox/embeddings/ollama_embed.py` — httpx, lazy import |
| 2.6 | Write tests for chunking: empty doc, headings only, oversized sections, no headings | Done | 31 tests in `tests/chunking/test_markdown.py` |
| 2.7 | Write tests for embedders: mock model output, verify dimension, batch handling | Done | 21 tests in `tests/embeddings/test_embedders.py` |

**Deliverable**: Can parse any markdown file into heading-aware chunks with embeddings. Tests pass.

---

## Iteration 3: Ingestion Pipeline & CLI ✓

**Goal**: End-to-end ingestion from markdown file to database, via CLI.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Implement ingestion pipeline (parse → chunk → embed → store) | Done | `src/cerefox/ingestion/pipeline.py` |
| 3.2 | Add content hash deduplication | Done | SHA-256; returns skipped=True if hash already exists |
| 3.3 | Build CLI with Click (ingest command) | Done | `src/cerefox/cli.py` — file + --paste (stdin) modes |
| 3.4 | Add CLI commands: list-docs, delete-doc, list-projects | Done | All tested with Click CliRunner |
| 3.5 | Add file system backup | Done | `src/cerefox/backup/fs_backup.py` — atomic JSON writes |
| 3.6 | Write `scripts/backup_create.py` and `scripts/backup_restore.py` | Done | Idempotent restore; --dry-run flag on both |
| 3.7 | Write tests for pipeline: dedup logic, chunk-to-DB mapping (mocked DB) | Done | `tests/ingestion/test_pipeline.py`, `test_backup.py`, `test_cli.py` |
| 3.8 | Integration test: ingest a real MD file into Supabase | Done | Verified manually against live Supabase |

**Deliverable**: `cerefox ingest my-notes.md --project "creative projects"` works end-to-end. Backup scripts documented.

---

## Iteration 4: Search & Retrieval ✓

**Goal**: Working search RPCs and retrieval logic.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | Deploy search RPCs to Supabase | Done | Deployed via db_deploy.py |
| 4.2 | Implement Python search client (wraps RPC calls) | Done | `src/cerefox/retrieval/search.py` — SearchClient, SearchResult, SearchResponse |
| 4.3 | Add CLI search command | Done | `cerefox search` — hybrid/fts/semantic modes, --alpha, --count, --project |
| 4.4 | Implement response size management (truncation, metadata) | Done | `_build_response()` + `_estimate_bytes()`; configurable via `CEREFOX_MAX_RESPONSE_BYTES` |
| 4.5 | Write tests for search client: response assembly, size truncation, metadata | Done | 22 tests in `tests/retrieval/test_search.py` (164 total passing) |
| 4.6 | Integration test: search with real ingested content | Done | Verified manually against live Supabase |
| 4.7 | Connect via Supabase MCP and verify agent access | Done | Verified via Claude Desktop + Claude Code |
| 4.8 | Implement `cerefox_save_note` RPC (agent write tool) | Done | `src/cerefox/db/rpcs.sql` + `client.save_note()` — quick note capture, no chunking |
| 4.9 | Write `docs/guides/connect-agents.md` (Claude, Cursor, generic MCP client) | Done | Claude Desktop, Cursor IDE, Python SDK, full RPC reference |

**Deliverable**: Agents can search and write to Cerefox via MCP. CLI search works. Unit tests pass. Agent connection guide complete.

---

## Iteration 5: Web Application (Basic) ✓

**Goal**: Local web UI for browsing knowledge and ingesting content.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | FastAPI app skeleton with Jinja2 + HTMX | Done | `src/cerefox/api/app.py` + `routes.py` — create_app() factory, dependency injection |
| 5.2 | Dashboard page (doc count, recent docs, projects) | Done | `web/templates/dashboard.html` — stats cards, recent docs table, projects |
| 5.3 | Knowledge browser page (search, filter by project/tags) | Done | `web/templates/browser.html` — HTMX search, mode selector, project filter |
| 5.4 | Document viewer page (reconstructed doc with chunk boundaries) | Done | `web/templates/document.html` — chunk list with heading breadcrumbs |
| 5.5 | Ingest page (upload MD files, paste content) | Done | `web/templates/ingest.html` — paste + file upload, HTMX feedback |
| 5.6 | Project management page (CRUD projects) | Done | `web/templates/projects.html` — list, create, delete |
| 5.7 | Write `docs/guides/setup-local.md` (local Docker setup guide) | Done | Step-by-step local Docker + Postgres setup |
| 5.8 | Write `docs/guides/ops-scripts.md` (backup, restore, migrate) | Done | All operational scripts documented |

**Deliverable**: Usable web UI for managing the knowledge base locally. Local setup guide complete.

---

## Iteration 6: Enhanced Features ✓

**Goal**: Production-quality features for daily use.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | PDF → Markdown converter | Done | `src/cerefox/chunking/converters.py` — pypdf (optional dep), page sections |
| 6.2 | DOCX → Markdown converter | Done | Same file — python-docx (optional dep), heading style mapping |
| 6.3 | Small-to-big context expansion RPC | Done | `cerefox_context_expand` SQL RPC + `client.context_expand()` |
| 6.4 | Async ingestion with status tracking | Deferred | Requires queue infrastructure; not justified for single-user V1 |
| 6.5 | Ingestion error UI (status panel, retry) | Deferred | Depends on 6.4 |
| 6.6 | Metadata schema management (define custom fields) | Deferred | Complexity not justified for V1; JSONB metadata is sufficient |
| 6.7 | Batch ingestion (directory of files) | Done | `cerefox ingest-dir DIR/ --pattern "*.md" --recursive --dry-run` |
| 6.8 | Git backup integration | Done | `FileSystemBackup.create(git_commit=True)` + `--git-commit` flag |

**Deliverable**: Robust ingestion pipeline with multiple input formats.

---

## Iteration 7: Deployment & Open Source ✓

**Goal**: Packageable, deployable, and shareable.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 7.1 | Dockerfile for the web app | Done | Multi-stage build (builder + runtime), uvicorn entrypoint, healthcheck |
| 7.2 | docker-compose.yml for full local stack | Done | Postgres+pgvector + cerefox web UI + named volumes |
| 7.3 | Cloud Run deployment config | Done | `docs/guides/setup-cloud-run.md` — build, push, deploy, cost estimate |
| 7.4 | README.md — project overview, quickstart, links to guides | Done | Feature table, architecture, MCP config, CLI reference, docs index |
| 7.5 | `docs/guides/quickstart.md` — zero to first document in < 15 min | Done | 8-step guide from clone to first search + agent connection |
| 7.6 | `docs/guides/setup-cloud-run.md` — GCP Cloud Run deployment | Done | Full deploy guide with cost estimate and access control options |
| 7.7 | `docs/guides/contributing.md` — adding embedders, converters, commands | Done | Extension points for all major components |
| 7.8 | License file, .env.example | Done | Apache 2.0 license + .env.example with all settings |
| 7.9 | First release (v0.1.0) | Ready | 218 tests passing, all iterations complete — tag when credentials available |

**Deliverable**: Open source release. All setup guides complete. Any new user can go from zero to running Cerefox in one sitting.

---

## Post-Release Improvements

Work completed after the v0.1.0 baseline.

| # | Task | Status | Notes |
|---|------|--------|-------|
| P.1 | Supabase end-to-end testing — real connection, ingest, search | Done | Session pooler URL (IPv4), service_role key; Intel Mac + Python 3.13 → Ollama |
| P.2 | Intel Mac / Python 3.13 platform fix in pyproject.toml | Done | `torch<2.3.0` constraint for x86_64/darwin; Ollama path documented in README |
| P.3 | `cerefox_search_docs` SQL RPC — document-level hybrid search | Done | `src/cerefox/db/rpcs.sql` — deduplicates by document, reconstructs full content via STRING_AGG |
| P.4 | `DocResult` + `DocSearchResponse` dataclasses + `search_docs()` | Done | `src/cerefox/retrieval/search.py` + `src/cerefox/db/client.py` — parallel to chunk search layer |
| P.5 | Tests for document search (18 new tests) | Done | `tests/retrieval/test_search.py` + `tests/test_db_client.py` — 236 total passing |
| P.6 | Fix test_config.py for `.env` file presence | Done | `Settings(_env_file=None)` in tests that use `clear=True`; pydantic-settings reads `.env` even when env is cleared |
| P.7 | `test-data/` corpus — 6 diverse markdown documents | Done | cerefox-overview, knowledge-management, espresso, ancient-rome, python-concurrency, worldbuilding |
| P.8 | Web UI: "Documents (full)" search mode | Done | `browser.html` 4th mode option; `routes.py` calls `search_docs()`; `search_results.html` branches on `view` |

---

## Iteration 8: Cloud-First Embeddings + Supabase Edge Functions

**Goal**: Replace all local embedding models with cloud API embedders (OpenAI default,
Fireworks-compatible alternative) and deploy Supabase Edge Functions so any AI agent
can do real hybrid search without SQL or a local embedder.

### Why

- Local mpnet requires Python + PyTorch — fails on Intel Mac Python 3.13, heavy to install
- Ollama requires a separate running service
- Agents calling RPCs via Supabase MCP must pass embeddings themselves; zero-vector
  workaround produces broken/null scores and arbitrary results
- Correct solution: move embedding to a server-side layer that agents can call by name
  (Supabase Edge Function), using the same model for both ingest and query

### Architecture after Iteration 8

```
Ingest:   cerefox ingest file.md → Python CLI → OpenAI API → Supabase (text + 768-dim vector)
Search:   Agent → Supabase MCP → cerefox-search Edge Function
                               → OpenAI API (embed query with same model)
                               → cerefox_hybrid_search RPC → results
Quick note: Agent → cerefox-ingest Edge Function → OpenAI API → DB
```

### Key design decisions

- **OpenAI `text-embedding-3-small` with `dimensions=768`** — exactly matches existing
  VECTOR(768) schema; no migration needed; $0.02/1M tokens (~$0.10–0.30/month for personal use)
- **One `CloudEmbedder` class** — configurable base_url + model + api_key; covers OpenAI,
  Fireworks AI (OpenAI-compatible), Together AI, etc. without separate classes
- **Fireworks**: same class, base_url `https://api.fireworks.ai/inference/v1`,
  model `nomic-ai/nomic-embed-text-v1.5` (768-dim, OpenAI-compatible endpoint)
- **No new Python dependencies** — httpx is already a core dep; no torch, no sentence-transformers
- **`cerefox reindex` CLI command** — re-embeds all existing chunks with the new embedder
  in-place (preserves document IDs), so existing 14 docs / 186 chunks migrate cleanly
- **Edge Functions** deployed to Supabase, called via `SUPABASE_ANON_KEY` bearer token;
  `OPENAI_API_KEY` stored as a Supabase secret

### Schema: no changes required

`embedding_primary VECTOR(768)` already works. `text-embedding-3-small` with
`dimensions=768` outputs L2-normalised 768-dim vectors. Cosine similarity (pgvector `<=>`)
works correctly.

### Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 8.1 | Write `CloudEmbedder` (`src/cerefox/embeddings/cloud.py`) | Done | httpx, OpenAI-compatible `/embeddings` endpoint, batching |
| 8.2 | Update `config.py` — remove ollama/mpnet settings, add cloud settings | Done | `embedder: Literal["openai","fireworks"]`, `openai_api_key`, `openai_base_url`, `openai_embedding_model`, `openai_embedding_dimensions` |
| 8.3 | Update `_get_embedder()` factory in `cli.py` and `routes.py` | Done | Both use `CloudEmbedder` with settings-driven base_url/model/key |
| 8.4 | Remove `mpnet.py` and `ollama_embed.py` | Done | No longer needed; httpx is already core dep |
| 8.5 | Update `pyproject.toml` — remove mpnet/torch/ollama optional deps | Done | Simpler dependency tree |
| 8.6 | Add `cerefox reindex` CLI command | Done | Re-embeds all chunks in-place; new `client.update_chunk_embedding()` DB method |
| 8.7 | Write `supabase/functions/cerefox-search/index.ts` | Done | Accepts text query + optional project_name/match_count/mode; embeds with OpenAI; calls RPC |
| 8.8 | Write `supabase/functions/cerefox-ingest/index.ts` | Done | Accepts title + content; chunks (heading-aware); embeds; inserts document + chunks |
| 8.9 | Deploy Edge Functions to Supabase | Done | Via `mcp__supabase__deploy_edge_function` |
| 8.10 | Update tests — replace mpnet/ollama mocks with CloudEmbedder mocks | Done | Mock httpx calls instead of sentence-transformers |
| 8.11 | Update `.env.example` | Done | `CEREFOX_EMBEDDER=openai`, `OPENAI_API_KEY=` |
| 8.12 | Update `docs/guides/connect-agents.md` — Edge Function as primary path | Done | Named tool usage, project-filter pattern, no more SQL |
| 8.13 | Update `docs/guides/quickstart.md` — OpenAI embedder as default | Done | |
| 8.14 | Update `docs/guides/configuration.md` | Done | New env vars, removed old ones |

---

## Iteration 9: Built-in MCP Server

**Goal**: Ship a proper `cerefox mcp` command that desktop AI clients (Claude Desktop,
ChatGPT Desktop, Cursor) can launch directly. Fixes the `mcp-server-fetch` dead end
(GET-only, can't POST authenticated requests).

**Key insight**: The MCP server runs as a local stdio process. Desktop clients launch it
as a subprocess → full hybrid search. Cloud clients cannot reach a local process → they
need a deployed remote server (future work) or GPT Actions (ChatGPT only).

### Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 9.1 | Write `src/cerefox/mcp_server.py` — MCP Python SDK, stdio transport | Done | Exposes `cerefox_search` (doc-level hybrid) and `cerefox_ingest` tools |
| 9.2 | Add `cerefox mcp` CLI command | Done | `cli.py` → `mcp_server.run()` |
| 9.3 | Add `mcp>=1.0.0` to `pyproject.toml` dependencies | Done | mcp 1.26.0 installed |
| 9.4 | Update `docs/guides/connect-agents.md` — `cerefox mcp` as primary path | Done | Local/cloud architecture table, correct system prompt, ChatGPT Desktop + GPT Actions |
| 9.5 | Update `docs/solution-design.md` section 9 | Done | Built-in server primary, architecture diagram, constraints documented |
| 9.6 | Update `docs/plan.md`, `quickstart.md`, `setup-supabase.md` | Done | All references to old fetch/invoke_edge_function approach corrected |

**Deliverable**: `cerefox mcp` launches a working MCP server. Claude Desktop, ChatGPT Desktop,
and Cursor connect to it and get named `cerefox_search` / `cerefox_ingest` tools with full
hybrid search. Validated live with Claude Desktop.

---

## Iteration 10: Remote MCP Edge Function

**Goal**: Give remote-capable MCP clients (Claude Code, Cursor, Claude Desktop via proxy) a
single HTTPS URL for full hybrid search — no Python install, no local repo clone.

### Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 10.1 | Write `supabase/functions/cerefox-mcp/index.ts` — MCP Streamable HTTP adapter | Done | Thin adapter over cerefox-search + cerefox-ingest; stateless; anon key auth |
| 10.2 | Update `docs/guides/connect-agents.md` — Path A-Remote section | Done | Claude Code, Cursor, Claude Desktop (supergateway), local vs remote comparison |
| 10.3 | Update `docs/solution-design.md` — section 9 three access paths | Done | |
| 10.4 | Update `README.md` — remote MCP feature row + agent section | Done | |

**Deliverable**: `cerefox-mcp` deployed to Supabase. Claude Code and Cursor connect with a
single `--transport http` command. Claude Desktop connects via `supergateway` proxy
(`mcp-remote` does not work with Supabase — GoTrue OAuth conflict).

---

## Iteration 11: Metadata Overhaul — Dynamic Tags & Settings Cleanup ✓

**Goal**: Replace the rigid `cerefox_metadata_keys` registry with a dynamic, data-driven
approach. Make metadata editing flexible (arbitrary key-value pairs), provide agents with
a discovery tool, and remove the Settings page cruft.

### Why

- The `cerefox_metadata_keys` table is a manually maintained registry that isn't enforced
  at the database level — documents can have any JSONB metadata regardless.
- The edit form only shows keys from the registry, hiding any metadata that was added
  outside it (e.g., via CLI, MCP, or direct API).
- `metadata_strict` mode adds complexity without clear value for a single-user system.
- Agents need a way to discover existing metadata keys (for consistency), but deriving
  them from actual data is more accurate and maintenance-free than a separate table.

### What changes

**Remove:**
- `cerefox_metadata_keys` table and its 3 RPCs (`list`, `upsert`, `delete`)
- Settings page metadata key CRUD (entire `/settings` page — it only has metadata keys)
- `metadata_strict` config setting and `_validate_metadata()` pipeline logic
- CLI `cerefox metadata-keys` command group (list, add, delete)
- Registry-driven metadata fields in ingest/edit forms

**Add:**
- `cerefox_list_metadata_keys` SQL RPC — derives keys from actual `doc_metadata` JSONB
  across all documents. Returns each distinct key with `doc_count` (how many documents
  use it) and `example_values` (sample values for context). This gives agents and the UI
  a live view of the metadata vocabulary without a separate table.
- `list_metadata_keys` MCP tool — exposes the RPC so agents can discover available
  metadata keys before ingesting or searching. Encourages agents to add metadata by
  showing them what keys already exist and how they're used.
- Dynamic metadata editor in the document edit form — shows all existing key-value pairs
  from the document's `doc_metadata` with editable keys and values, plus an "add row"
  button for new pairs. No registry dependency.
- Dynamic metadata fields in the ingest form — free-form key-value pair inputs (add/remove
  rows). Optionally pre-populated with autocomplete suggestions from the RPC.
- HTMX autocomplete for metadata keys — when typing a key name in ingest/edit forms,
  suggest existing keys from `cerefox_list_metadata_keys` to reduce drift.

### New RPC design

```sql
-- Returns all distinct metadata keys currently in use across documents
CREATE OR REPLACE FUNCTION cerefox_list_metadata_keys()
RETURNS TABLE (
  key           TEXT,
  doc_count     BIGINT,
  example_values TEXT[]    -- up to 5 sample values for context
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    k.key,
    COUNT(DISTINCT d.id)                                    AS doc_count,
    (ARRAY_AGG(DISTINCT d.doc_metadata ->> k.key) FILTER
      (WHERE d.doc_metadata ->> k.key IS NOT NULL))[1:5]   AS example_values
  FROM cerefox_documents d,
       LATERAL jsonb_object_keys(d.doc_metadata) AS k(key)
  WHERE d.doc_metadata IS NOT NULL
    AND d.doc_metadata != '{}'::jsonb
  GROUP BY k.key
  ORDER BY doc_count DESC, k.key;
$$;
```

### MCP tool design

```
Tool: list_metadata_keys
Description: List all metadata keys currently in use across documents.
             Returns each key with a count of documents using it and example values.
             Use this before ingesting to discover the existing metadata vocabulary
             and maintain consistency.
Parameters: (none)
Returns: Text table of keys, counts, and examples.
```

Exposed in both the local MCP server (`mcp_server.py`) and the remote Edge Function
(`cerefox-mcp/index.ts`).

### Tasks

| # | Task | Status | Notes |
|---|------|--------|-------|
| 11.1 | Write `cerefox_list_metadata_keys` SQL RPC (data-driven) | Done | Replace registry RPCs; returns key, doc_count, example_values |
| 11.2 | Drop `cerefox_metadata_keys` table + old RPCs from schema.sql | Done | Remove table, trigger, `list`/`upsert`/`delete` RPCs |
| 11.3 | Write migration script for live DB (drop table, replace RPCs) | Done | `db/migrations/0002_metadata_keys_to_dynamic.sql` — idempotent |
| 11.4 | Update `client.py` — replace 3 registry methods with 1 dynamic method | Done | `list_metadata_keys()` → calls new RPC, returns `[{key, doc_count, example_values}]` |
| 11.5 | Remove `metadata_strict` from `config.py` + `_validate_metadata()` | Done | Also removed from pipeline.py; tests updated |
| 11.6 | Replace CLI `metadata-keys` group with `cerefox list-metadata-keys` | Done | Single data-driven list command showing keys, doc counts, example values |
| 11.7 | Remove Settings page — routes + template | Done | `/settings` route, `settings.html` template, nav link all removed |
| 11.8 | Redesign edit form metadata section — dynamic key-value editor | Done | JS add/remove rows; editable keys + values; pre-fill from doc_metadata |
| 11.9 | Redesign ingest form metadata section — free-form key-value inputs | Done | Same dynamic row pattern; no registry dependency |
| 11.10 | Add autocomplete for metadata key names | Done | `<datalist>` with key suggestions from `cerefox_list_metadata_keys` RPC |
| 11.11 | Add `list_metadata_keys` tool to local MCP server (legacy) | Done | `mcp_server.py` — calls `client.list_metadata_keys()`, returns JSON |
| 11.12 | Write `cerefox-metadata` Edge Function (standalone) | Done | Calls `cerefox_list_metadata_keys` RPC; usable from GPT Actions and HTTP clients |
| 11.13 | Add `list_metadata_keys` tool to `cerefox-mcp` Edge Function | Done | Delegates to `cerefox-metadata` Edge Function (same pattern as search/ingest) |
| 11.14 | Update `_extract_ingest_form()` for dynamic key-value pairs | Done | Paired `meta_key[]`/`meta_value[]` arrays replace `meta__<key>` pattern |
| 11.15 | Update tests — remove registry tests, add dynamic key tests | Done | 408 tests passing; new tests for MCP tool + form metadata |
| 11.16 | Update docs — plan.md, solution-design.md | Done | Mark tasks done; update architecture docs |
| 11.17 | Investigate Supabase OAuth 2.1 for MCP authentication | Researched — Deferred | GoTrue owns `/.well-known` on `*.supabase.co`; Supabase BYO MCP auth "coming soon" (no timeline); no current client requires OAuth. See `docs/research/oauth-mcp-auth.md`. Revisit when Supabase ships BYO MCP auth or a must-have client requires OAuth. |
| 11.18 | Investigate Perplexity integration paths | Researched — Deferred | Web connector tested and failed (GoTrue conflict). Decision: test Desktop + Helper App + local `cerefox mcp` when convenient. Sonar/Agent API are programmatic alternatives. See `docs/research/oauth-mcp-auth.md` Section 8. |
| 11.19 | Investigate Gemini integration | Researched — To test | Gemini CLI supports Streamable HTTP + static Bearer headers natively. Should work like Claude Code/Cursor. See `docs/research/gemini-integration.md`. |

**Deliverable**: Metadata is fully open-ended JSONB. Agents can discover existing keys via
MCP tool. Web UI allows editing any key-value pair. No manual registry to maintain. Settings
page removed (or repurposed if other settings are added later). Agent integration research
(OAuth, Perplexity, Gemini) documented.

---

## Iteration 12: Small-to-Big Retrieval, Document Versioning & Full Retrieval

Three related features that work together: (1) smart chunk-level retrieval for large
documents, (2) implicit versioning to prevent data loss on updates, (3) a full document
retrieval API for when you need the complete text.

See `docs/requirements-and-specs.md` FR-4.10–4.14 and FR-11 for detailed specifications.

### 12A: Small-to-Big Retrieval

For large documents, search returns matched chunks + N neighbor chunks instead of the full
document. Below a configurable threshold, current full-document behaviour is retained.

**Config parameters**:
- `CEREFOX_SMALL_TO_BIG_THRESHOLD` — doc size in chars above which chunk-level retrieval
  kicks in (default: 40000)
- `CEREFOX_CONTEXT_WINDOW` — neighbor chunks on each side of each match (default: 1)

**Assembly rule**: matched chunks + N preceding + N following, sorted by chunk_index,
deduplicated. Example: matched = c1, c3; N=1 → c0, c1, c2, c3, c4 (not c0, c1, c2,
c2, c3, c4).

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.1 | Add `CEREFOX_SMALL_TO_BIG_THRESHOLD` and `CEREFOX_CONTEXT_WINDOW` config params | Pending | Add to `config.py` with defaults 40000 and 1 |
| 12.2 | Implement `cerefox_expand_context` RPC | Pending | Takes chunk IDs + window size, returns ordered sibling chunks with dedup; callable from Python and Edge Functions |
| 12.3 | Update `search.py` — apply small-to-big logic post-search | Pending | If doc size > threshold, call expand_context instead of full-doc reconstruction; assemble deduped result |
| 12.4 | Update `cerefox-search` Edge Function | Pending | Apply threshold logic server-side |
| 12.5 | Update `cerefox-mcp` Edge Function | Pending | Pass through to cerefox-search |
| 12.6 | Write tests — threshold boundary, dedup, ordering, N=0/1/2 | Pending | Unit tests for RPC logic + integration tests for full search path |

### 12B: Implicit Document Versioning

Every `update_if_exists` preserves the previous content as a version. Lazy retention policy:
always keep at least 1 previous version; keep all versions within `CEREFOX_VERSION_RETENTION_HOURS`
(default: 48h); lazily delete expired versions on next update.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.7 | Design `cerefox_document_versions` table | Pending | Stores full content snapshot, metadata snapshot, timestamp, source. No chunks/embeddings. Cascade delete from parent document. |
| 12.8 | Add `CEREFOX_VERSION_RETENTION_HOURS` config param | Pending | Default 48 hours |
| 12.9 | Update ingestion pipeline — create version on update | Pending | Before overwriting, snapshot current content to versions table |
| 12.10 | Implement lazy version cleanup | Pending | On each update: delete versions older than retention window, except always keep the most recent one |
| 12.11 | Deploy schema migration | Pending | New table + RPC for version listing |
| 12.12 | Write tests — version creation, retention, lazy cleanup | Pending | Test: single update keeps 1 version, rapid updates keep all within window, cleanup after window |

### 12C: Full Document Retrieval API

A dedicated API primitive that returns the complete text of a specific document by ID,
optionally for a specific version. Serves as the complement to small-to-big search: search
finds the relevant chunks, this API retrieves the full document when needed.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.13 | Implement `cerefox_get_document` RPC | Pending | Returns full content + metadata by document ID. Optionally accepts version_id for historical versions. |
| 12.14 | Implement `cerefox_list_versions` RPC | Pending | Returns version list for a document: version_id, timestamp, size_chars, source |
| 12.15 | Add REST API endpoint for full document retrieval | Pending | `GET /api/document/{id}?version={version_id}` |
| 12.16 | Add MCP tool for full document retrieval | Pending | Expose via local MCP server and cerefox-mcp Edge Function |
| 12.17 | Add CLI command `cerefox get-doc <id>` | Pending | Print full document text; `--version` flag for historical |
| 12.18 | Write tests for full retrieval + version retrieval | Pending | Happy path, nonexistent ID, nonexistent version |

### 12D: Documentation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.19 | Update requirements-and-specs.md | Done | FR-4.10–4.14 and FR-11 added |
| 12.20 | Update solution-design.md | Pending | Document versioning table design, retrieval flow changes |
| 12.21 | Update plan.md and CLAUDE.md | Pending | Mark completion, update conventions |

**Deliverable**: Large documents return focused context via search. All documents have
implicit version history with lazy retention. Full document text (current or historical)
is retrievable via dedicated API, MCP tool, and CLI.

---

## Iteration 13: Local Supabase Dev Environment

Set up a full local Supabase stack for offline development and Edge Function testing.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.1 | Set up Supabase local dev environment (`supabase start`) | Pending | Full local stack (Postgres+pgvector, Edge Functions runtime, GoTrue); configure `supabase/config.toml`; verify schema deploys and Edge Functions serve locally |
| 13.2 | Test Edge Functions locally (`supabase functions serve`) | Pending | Verify cerefox-search, cerefox-ingest, cerefox-mcp work against local Postgres |

**Deliverable**: Local Supabase dev environment operational for Edge Function development
and testing without requiring the remote Supabase instance.

---

## Current Focus

**Iteration 11 complete.** Metadata overhaul (11.1–11.16) done. OAuth (11.17), Perplexity
(11.18), and Gemini (11.19) researched — research docs in `docs/research/`. Gemini testing
deferred to a future session.

**Iteration 12 next**: True small-to-big retrieval — chunk-level results with N neighbor
chunks for large documents, deduped and assembled in order.
