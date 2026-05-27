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

**Status: Done.** All tasks implemented. SQL logic in `cerefox_search_docs` (threshold + context expand + dedup), `DocResult.is_partial` in Python, `partial_note` annotation in MCP server. Config via `rpcs.sql` DEFAULT values only (no `.env` params). Full test coverage: 9 Python unit tests + 4 e2e tests in `TestSmallToBigRetrieval`.

**Implementation approach (final)**: all threshold/expansion logic lives entirely in Postgres (single-implementation principle). `cerefox_expand_context` RPC does the windowed chunk retrieval; `cerefox_search_docs` is extended to call it when `total_chars > threshold`. Both params are RPC DEFAULT values only — not in `.env` or `config.py` — following the same convention as `OPENAI_MODEL`/`EMBEDDING_DIMENSIONS` in the Edge Functions. All callers (Python, Edge Functions) get the feature automatically with no code changes beyond the RPC.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.1 | ~~Add `CEREFOX_SMALL_TO_BIG_THRESHOLD` and `CEREFOX_CONTEXT_WINDOW` to `config.py` and `.env.example`~~ | Removed | Design revised: these are RPC-level tuning params, not `.env` config. Defaults live in `rpcs.sql`; change them there and redeploy. Documented in `configuration.md` § "RPC-level retrieval parameters". |
| 12.2 | Implement `cerefox_expand_context` RPC + extend `cerefox_search_docs` | Done | `cerefox_expand_context` already existed; `cerefox_search_docs` gains `p_small_to_big_threshold INT DEFAULT 40000` and `p_context_window INT DEFAULT 1`; branches on `total_chars > threshold`; returns `is_partial BOOL`. |
| 12.3 | ~~Update `search.py` — pass threshold params to RPC~~ | Removed | No change needed — Python passes no threshold params; RPC defaults handle all paths uniformly. `DocResult.is_partial` field added to surface the flag to callers. |
| 12.4 | ~~Update `cerefox-search` Edge Function~~ | Removed | True thin wrapper; feature is transparent. RPC defaults activate it automatically. |
| 12.5 | ~~Update `cerefox-mcp` Edge Function~~ | Removed | Delegates entirely to `cerefox-search`; no changes needed. |
| 12.6 | Write tests | Done | Python-layer unit tests (9 tests across `TestDocResult` + `TestSearchDocs`). E2e tests in `tests/e2e/test_api_e2e.py` — `TestSmallToBigRetrieval` class (4 tests): small doc `is_partial=False`, large doc `is_partial=True` + `total_chars` integrity + `chunk_count` < full, `p_context_window` N=0 vs N=1 comparison, dedup check via heading-repeat detection with N=2 window. Calls live Supabase via `e2e_client.search_docs()` and `e2e_client.rpc()` for window-override variants. |

### 12B: Implicit Document Versioning

**Design summary** (finalized — see `docs/solution-design.md` section 7 for full spec):

- `cerefox_document_versions` table: stores per-version metadata (version_number, source,
  created_at). **No content column** — content is reconstructed from archived chunks.
- `version_id UUID` nullable FK added to `cerefox_chunks`. `NULL` = current (searchable);
  non-NULL = archived under that version (not searchable, lazily deleted).
- Partial unique index on `cerefox_chunks(document_id, chunk_index) WHERE version_id IS NULL`
  — enforces uniqueness of current chunks without touching archived ones.
- Partial HNSW and GIN (FTS) indexes both carry `WHERE version_id IS NULL` — archived chunks
  never appear in search at the index level.
- Single `cerefox_snapshot_version(p_document_id, p_source, p_retention_hours)` SQL RPC:
  (1) creates a version row, (2) sets `version_id` on all current chunks, (3) runs lazy
  retention cleanup. Called from both Python (`update_document()`) and TypeScript Edge Functions.
- Lazy retention: always keep at least 1 version; also keep all versions created within
  `CEREFOX_VERSION_RETENTION_HOURS` (default 48h). Older versions (beyond the window AND
  not the most recent one) are deleted inside the same RPC call — no cron needed.
- Metadata-only updates (title/metadata change, content unchanged): skip versioning entirely.
- Migration 0003 is additive — no data loss for existing deployments.

#### Step-by-step implementation checklist

**Step 1 — Config**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.7 | Add `CEREFOX_VERSION_RETENTION_HOURS` to `config.py` | Done | Default `48`; type `int`; `CEREFOX_` prefix |

**Step 2 — Migration file (additive)**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.8 | Create `src/cerefox/db/migrations/0003_add_document_versions.sql` | Done | Additive only: add `cerefox_document_versions` table; add `version_id` column to `cerefox_chunks`; add partial unique index; add partial HNSW + FTS indexes; add RLS on new table; drop plain indexes replaced by partial ones |

**Step 3 — Update schema.sql to reflect final state**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.9 | Update `src/cerefox/db/schema.sql` — add versions table and version_id | Done | Add `cerefox_document_versions` table definition; add `version_id UUID REFERENCES cerefox_document_versions(id) ON DELETE CASCADE` to `cerefox_chunks`; replace plain UNIQUE constraint with partial unique index; replace plain HNSW + GIN indexes with partial (`WHERE version_id IS NULL`); add `idx_cerefox_chunks_version` for archived chunk lookup; add RLS on new table; add `updated_at` trigger on new table |

**Step 4 — New and updated SQL RPCs**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.10 | Write `cerefox_snapshot_version` RPC in `rpcs.sql` | Done | `SECURITY DEFINER SET search_path = public, pg_catalog`; creates version row; `UPDATE cerefox_chunks SET version_id = v_version_id WHERE document_id = p_document_id AND version_id IS NULL`; lazy cleanup (`DELETE FROM cerefox_document_versions WHERE document_id = p_document_id AND created_at < NOW() - p_retention_hours * INTERVAL '1 hour' AND id != (SELECT id FROM cerefox_document_versions WHERE document_id = p_document_id ORDER BY created_at DESC LIMIT 1)`); returns `(version_id, version_number, chunk_count, total_chars)` |
| 12.11 | Write `cerefox_get_document` RPC in `rpcs.sql` | Done | `(p_document_id UUID, p_version_id UUID DEFAULT NULL)`; `NULL` → `STRING_AGG(content ORDER BY chunk_index) WHERE version_id IS NULL`; non-NULL → `STRING_AGG(content ORDER BY chunk_index) WHERE version_id = p_version_id`; returns `(document_id, title, version_id, content, chunk_count, total_chars, created_at)` |
| 12.12 | Write `cerefox_list_document_versions` RPC in `rpcs.sql` | Done | `(p_document_id UUID)`; returns all version rows ordered by `created_at DESC`: `(version_id, version_number, source, chunk_count, total_chars, created_at)` |
| 12.13 | Update all search RPCs — filter archived chunks and surface version count | Done | All chunk joins in `cerefox_hybrid_search`, `cerefox_fts_search`, `cerefox_semantic_search`, `cerefox_search_docs`, `cerefox_reconstruct_doc` must add `AND version_id IS NULL`. Also add `version_count INT` to result columns (subquery: `SELECT COUNT(*) FROM cerefox_document_versions WHERE document_id = d.id`). This lets agents and the web UI know when previous versions exist and can offer retrieval/restore. |

**Step 5 — Python: client.py**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.14 | Add `snapshot_version(document_id, source, retention_hours)` to `client.py` | Done | Calls `cerefox_snapshot_version` RPC; returns `{version_id, version_number, chunk_count, total_chars}` |
| 12.15 | Add `get_document(document_id, version_id=None)` to `client.py` | Done | Calls `cerefox_get_document` RPC |
| 12.16 | Add `list_document_versions(document_id)` to `client.py` | Done | Calls `cerefox_list_document_versions` RPC |
| 12.17 | Remove `delete_chunks_for_document()` from `client.py` (or keep as internal-only) | Done | Kept for delete_document; updated to only delete current chunks (version_id IS NULL) | No longer called from `update_document()`; only called from `delete_document()` |

**Step 6 — Python: ingestion pipeline**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.18 | Update `update_document()` in `pipeline.py` — replace chunk delete with snapshot RPC | Done | When content changes: call `client.snapshot_version(document_id, source, settings.version_retention_hours)` instead of `client.delete_chunks_for_document(document_id)`; then insert new chunks with `version_id = NULL` (default). When content unchanged: no snapshot call. |
| 12.19 | Add `source` parameter to `update_document()` | Done | Pass-through to `snapshot_version` RPC so version rows record how the update was triggered (e.g., `'file'`, `'paste'`, `'agent'`) |

**Step 7 — REST API endpoints**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.20 | Add `GET /api/documents/{id}` endpoint | Done | Returns full document text via `cerefox_get_document`. Optional `?version_id=<uuid>` query param for historical versions. Response: `{document_id, title, version_id, content, chunk_count, total_chars}` |
| 12.21 | Add `GET /api/documents/{id}/versions` endpoint | Done | Returns version list via `cerefox_list_document_versions`. Response: array of `{version_id, version_number, source, chunk_count, total_chars, created_at}` |

**Step 8 — MCP server**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.22 | Add `cerefox_get_document` tool to `mcp_server.py` | Done | Params: `document_id` (required), `version_id` (optional). Returns full content as text. |
| 12.23 | Add `cerefox_list_versions` tool to `mcp_server.py` | Done | Param: `document_id`. Returns version list as formatted text. |

**Step 9 — CLI**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.24 | Add `cerefox get-doc <id>` CLI command | Done | Prints full document text to stdout. `--version <uuid>` flag for historical. |
| 12.25 | Add `cerefox list-versions <id>` CLI command | Done | Prints version table (version_number, source, size, date) to stdout. |

**Step 10 — db_status.py**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.26 | Update `scripts/db_status.py` — add new table and RPCs to expected lists | Done | Added `cerefox_document_versions` to tables; added `cerefox_snapshot_version`, `cerefox_get_document`, `cerefox_list_document_versions` to functions; updated indexes list |

**Step 11 — Tests**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.27 | Update `tests/ingestion/test_pipeline.py` — snapshot_version replaces delete_chunks | Done | Mock `client.snapshot_version`; assert it is called on update with content change; assert it is NOT called on metadata-only update |
| 12.28 | Write `tests/db/test_versioning.py` — version lifecycle tests | Done | Test: first update creates version_id=non-NULL chunks + new version_id=NULL chunks; second update archives again; metadata-only update skips snapshot; lazy cleanup removes versions outside window but keeps newest; cascade delete removes archived chunks |

### 12C: Full Document Retrieval API

Full document retrieval is implemented as part of 12B above (`cerefox_get_document` RPC,
REST endpoint, MCP tool, and CLI command are steps 12.11, 12.20–12.25 in 12B's checklist).
The Edge Function extension is listed here for tracking:

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.29 | Add `cerefox_get_document` tool to `cerefox-mcp` Edge Function | Done | Initially called RPC directly; refactored in 12.32 to call dedicated Edge Function |
| 12.30 | Add `cerefox_list_versions` tool to `cerefox-mcp` Edge Function | Done | Initially called RPC directly; refactored in 12.32 to call dedicated Edge Function |
| 12.31 | Fix `cerefox-ingest` update path to call `cerefox_snapshot_version` instead of raw DELETE | Done | Was directly deleting all chunks; now calls RPC first to archive them as a version before inserting new chunks |
| 12.32 | Create `cerefox-get-document` and `cerefox-list-versions` standalone Edge Functions | Done | Both callable via anon key; use service-role key internally; cerefox-mcp updated to delegate via fetch; GPT schema v1.3.0 |

### 12D: Documentation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.D1 | Update requirements-and-specs.md | Done | FR-4.10–4.14 and FR-11 added |
| 12.D2 | Update solution-design.md | Done | Chunks-anchored versioning design, cerefox_snapshot_version RPC spec, partial indexes, section 7 complete rewrite |
| 12.D3 | Update plan.md and CLAUDE.md | Done | Iteration complete; all tasks marked |
| 12.D4 | Update `connect-agents.md` — versioning tools GPT schema + Edge Function pattern | Done | GPT schema v1.3.0 with all 5 operations; single-implementation principle documented in solution-design.md §10.3 |

### 12E: DB Security & Tooling

Hardening the database security posture and completing the migration tooling
that was planned but not yet implemented.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 12.22 | Enable RLS on all 5 tables (no permissive policies) | Done | Direct anon-key table access blocked; service role + SECURITY DEFINER RPCs unaffected |
| 12.23 | Pin `search_path` on all 9 functions | Done | All RPCs + trigger function — eliminates mutable search_path Supabase warning |
| 12.24 | Create `scripts/db_migrate.py` migration runner | Done | `--dry-run`, `--status` flags; bootstraps tracking table; applies pending files in order |
| 12.25 | Update `db_deploy.py` to stamp migration files after deploy | Done | Prevents `db_migrate.py` re-applying changes already in base schema |
| 12.26 | Remove obsolete migration files (0001, 0002) | Done | Both fully incorporated in `schema.sql` / `rpcs.sql`; no active users |
| 12.27 | Fix stale references in `db_status.py` | Done | Removed `cerefox_metadata_keys`, `cerefox_upsert_metadata_key`, `cerefox_delete_metadata_key` |
| 12.28 | Update `ops-scripts.md` and `quickstart.md` | Done | Document deploy vs migrate workflow, fix hardcoded success message |
| 12.29 | Fix backup scripts: pagination cap, missing content_hash, missing embeddings | Done | `list_all_documents()` added; embeddings included in chunk export; restore is complete |
| 12.30 | Add `backup-data/` as default backup dir (gitignored) | Done | `config.py` default changed; `.gitignore` updated; `ops-scripts.md` examples corrected |

**Deliverable**: Large documents return focused context via search. All documents have
implicit version history with lazy retention. Full document text (current or historical)
is retrievable via dedicated API, MCP tool, and CLI.

---

## Iteration 13: Metadata-Filtered Search & Knowledge Architecture Research

Three related workstreams: (1) implement server-side metadata filtering across all access
paths, (2) research and spec the document edges/graph model and context bundles, and
(3) research agent provenance and activity log.

See `docs/solution-design.md §5.5` for the full metadata filter design.

### 13A: Metadata-Filtered Search (Implementation)

Add a `p_metadata_filter JSONB DEFAULT NULL` parameter to all search RPCs. When supplied,
only documents whose `doc_metadata @> p_metadata_filter` are included in results. The GIN
index on `cerefox_documents.metadata` already exists — no schema migration needed.

**Filter semantics**: JSONB containment (`@>`) — the document must contain all specified
key-value pairs. Multiple pairs are ANDed. NULL filter = no restriction (backwards-compatible).

**Single-implementation principle**: filter logic lives in the RPCs only. All callers
(Edge Functions, Python client, CLI, web UI) pass the filter as an opaque JSON object.

#### Step 1 — SQL RPCs

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.1 | Add `p_metadata_filter JSONB DEFAULT NULL` to `cerefox_hybrid_search` | Done | `@>` added to FTS and vector sub-queries |
| 13.2 | Add `p_metadata_filter` to `cerefox_fts_search` | Done | Same pattern |
| 13.3 | Add `p_metadata_filter` to `cerefox_semantic_search` | Done | Same pattern |
| 13.4 | Add `p_metadata_filter` to `cerefox_search_docs` | Done | Passes filter to inner `cerefox_hybrid_search` call |
| 13.5 | Deploy updated RPCs via `db_deploy.py` | Done | `python scripts/db_deploy.py` ✓ |

#### Step 2 — Python: client.py and search.py

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.6 | Add `metadata_filter: dict \| None = None` to `search_docs()` in `client.py` | Done | All 4 client methods updated; param omitted when None |
| 13.7 | Propagate `metadata_filter` through `SearchClient.search_docs()` in `search.py` | Done | All 4 SearchClient methods updated |

#### Step 3 — cerefox-search Edge Function

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.8 | Accept optional `metadata_filter` (JSON object) in request body | Done | Validates type; passes via spread into RPC params; echoed in response |
| 13.9 | Deploy updated `cerefox-search` | Done | `npx supabase functions deploy cerefox-search` ✓ |

#### Step 4 — cerefox-mcp Edge Function

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.10 | Add optional `metadata_filter` parameter to `cerefox_search` tool schema | Done | `additionalProperties: {type: string}`; passed in fetch body |
| 13.11 | Deploy updated `cerefox-mcp` | Done | `npx supabase functions deploy cerefox-mcp` ✓ |

#### Step 5 — Local MCP server

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.12 | Add optional `metadata_filter` input to `cerefox_search` tool in `mcp_server.py` | Done | Added to inputSchema; `_handle_search` reads and passes it |

#### Step 6 — CLI

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.13 | Add `--filter / -f` option to `cerefox search` CLI command | Done | JSON string; validated with `json.loads()`; all 3 modes get filter |

#### Step 7 — Web UI

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.14 | Add Metadata Filter section to `browser.html` | Done | `<details>` collapsible; `<datalist>` autocomplete; dynamic rows via plain JS; ✕ per row |
| 13.15 | Update `/search` route in `routes.py` to collect and assemble `metadata_filter` | Done | Parallel `meta_filter_key[]` / `meta_filter_value[]` params; all 4 modes get filter |
| 13.16 | Ensure HTMX search trigger includes metadata filter params | Done | Named inputs in-form; HTMX serialises them automatically; active pairs restored from context |

#### Step 8 — GPT Actions schema

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.17 | Add `metadata_filter` field to `searchKnowledgeBase` in GPT Actions OpenAPI schema | Done | Schema bumped to v1.4.0; `connect-agents.md` updated with new field and response description |

#### Step 9 — Tests

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.18 | Unit tests: `metadata_filter` param propagation through `search_docs()` and `SearchClient` | Done | 25 new tests in `tests/retrieval/test_search.py` — 441 total pass |
| 13.19 | E2e test: ingest two docs with differing metadata, search with filter, assert only matching doc returned | Done | 5 e2e tests in `TestMetadataFilteredSearch` (4.1–4.5) covering Python, hybrid, FTS, Edge Function, empty result |

#### Step 10 — Documentation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.20 | Update `docs/guides/connect-agents.md` — GPT Actions schema v1.4.0 + `metadata_filter` field docs | Done | Combined with 13.17 |
| 13.21 | Update `docs/guides/configuration.md` — note that metadata filter uses the existing GIN index | Done | Added "Metadata filter" subsection under Retrieval |
| 13.22 | Update `README.md` — mention metadata-filtered search in feature table | Done | Added row to feature table |

---

### 13B: Knowledge Architecture Research — Partial / Deferred

**Status**: Partially superseded by the updated [Vision document](../research/vision.md),
which now covers edges/graph model, context bundles, provenance, audit trail, review status,
automated knowledge processing, and multi-agent coordination in detail. The vision doc
is the authoritative source for the direction of these capabilities.

**Original goal**: produce a first-version spec for three related knowledge architecture
capabilities. The vision document now provides the conceptual framework; detailed specs
will be produced during implementation planning (Iteration 14+).

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13.R1 | **Research: Document Edges / Graph model** | Deferred | Aspirational/long-term; direction captured in vision doc (Search and Retrieval Evolution > Graph-Augmented Retrieval) |
| 13.R2 | **Research: Context Bundles** | Deferred | Direction captured in vision doc (Context Packaging); depends on LLM integration pattern |
| 13.R3 | **Research: Agent Provenance & Activity Log** | Partial | Direction refined in vision doc (Provenance, Trust, and Governance); audit trail, review status, and attribution detailed there; implementation spec still needed |

---

### 13C: Response Size Limits Redesign

**Goal**: Fix a regression where web UI search was being truncated by the MCP response limit,
and redesign limits to be opt-in per call rather than always applied.

**Root cause**: `SearchClient._build_doc_response()` always applied `settings.max_response_bytes`
regardless of caller, truncating the web UI just like the MCP path.

**Design**: `max_bytes: int | None = None` — `None` = no truncation (web UI / CLI); `int` = opt-in
limit (MCP path). Server ceiling enforced via `min(agent_request, SERVER_MAX)`.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13C.1 | Add `max_bytes: int | None = None` to all 4 `SearchClient` methods and both `_build_*` helpers in `search.py` | Done | `None` = no truncation; callers choose their constraint |
| 13C.2 | Pass `max_bytes=None` in all web UI routes (`routes.py`) | Done | Web UI never truncates |
| 13C.3 | Pass `max_bytes=None` in all CLI search commands (`cli.py`) | Done | CLI never truncates |
| 13C.4 | `cerefox-search` Edge Function: add ceiling enforcement `Math.min(requested ?? MAX_BYTES, MAX_BYTES)` | Done | Agent can request less, never more |
| 13C.5 | Add optional `max_bytes` to `cerefox-mcp` Edge Function tool schema + pass-through | Done | Agents can control budget via MCP tool parameter |
| 13C.6 | Rewrite `_handle_search` in `mcp_server.py`: read/cap agent `max_bytes`, enforce ceiling, emit truncation message | Done | Local MCP mirrors Edge Function ceiling behaviour |
| 13C.7 | Lower `p_small_to_big_threshold` default from 40 000 → 20 000 chars in `rpcs.sql` | Done | 5 docs × 20 KB ≈ 100 KB, comfortably under 200 KB ceiling |
| 13C.8 | Update unit tests in `tests/retrieval/test_search.py` — split truncation tests, add `TestMaxBytesParameter` class | Done | 8 new tests covering all modes and edge cases |
| 13C.9 | Create `docs/guides/response-limits.md` | Done | Full guide: per-path behaviour, server ceiling, agent parameter |
| 13C.10 | Update `docs/solution-design.md` §5.2 and §5.4 | Done | Threshold 40K → 20K; opt-in limit model documented |
| 13C.11 | Update `docs/guides/configuration.md` — response limits section and threshold default | Done | Threshold 40K → 20K; new opt-in model table |
| 13C.12 | Update `CLAUDE.md` — fix 65 KB reference → 200 KB + opt-in model note | Done | |

**Deliverable**: Web UI and CLI always return all results. MCP and Edge Function paths
respect a configurable budget with server-ceiling enforcement. Full guide in
`docs/guides/response-limits.md`.

### 13D: Documents (full) Search UI Redesign

| # | Task | Status | Notes |
|---|------|--------|-------|
| 13D.1 | Redesign doc-level results with collapsible content and Full/Excerpt badge | Done | `<details>` per result; amber "Excerpt" badge when `is_partial=True`, green "Full" otherwise; metadata line includes best-match heading path |
| 13D.2 | Make "Documents (full)" the default search mode | Done | `routes.py` default `mode`: `"hybrid"` → `"docs"`; moved to top of dropdown in `browser.html` |

---

## Iteration 14: Web Application Refactor (SPA)

**Goal**: Replace the Jinja2 + HTMX server-rendered frontend with a modern single-page
application (React + TypeScript) backed by the existing FastAPI API. This creates the
foundation for the richer UI workflows described in the
[Vision document](../research/vision.md) (review status, version promotion, audit log
browsing, temporal queries).

**Architecture**:
- **Backend**: FastAPI stays as the API server. Existing routes become a clean JSON API
  (the Jinja2 template rendering is removed). All business logic and Supabase integration
  remain in Python.
- **Frontend**: React + TypeScript SPA, served as static assets. Communicates with the
  FastAPI backend via JSON API calls.
- **Deployment**: FastAPI serves the built SPA assets in production (single process).
  Development uses a separate dev server with hot reload proxying to the API.

**Phased approach**: each phase is self-contained and deployable.

### 14A: React App Skeleton + Search Page ✓

Set up the React project, build pipeline, development workflow, and migrate the first
(and most important) page: Search.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 14A.1 | Initialize React + TypeScript project with Vite | Done | `frontend/` directory; Vite + SWC; TypeScript strict mode |
| 14A.2 | Set up build pipeline: `npm run build` outputs to `frontend/dist/`; FastAPI serves it | Done | `StaticFiles` mount at `/app/assets`; catch-all at `/app/{path}` serves `index.html`; Vite proxy for dev |
| 14A.3 | Create JSON API endpoints under `/api/v1/` | Done | `routes_api.py` with 18 endpoints; coexists with Jinja2 routes during transition |
| 14A.4 | Set up Mantine UI component library + TanStack Query | Done | Mantine v7 + `@tabler/icons-react`; TanStack Query for data fetching + caching |
| 14A.5 | Implement app shell: AppShell layout, navigation, React Router with `/app` basename | Done | Header nav: Dashboard, Search, Ingest, Projects |
| 14A.6 | Migrate Search page to React | Done | All 4 modes (docs, hybrid, FTS, semantic); collapsible accordion results with Full/Excerpt badges; project + metadata filters; URL-driven state |
| 14A.7 | Update development docs and `CLAUDE.md` with new frontend workflow | Done | Frontend section added to CLAUDE.md |
| 14A.8 | Verify search page works end-to-end against the JSON API | Done | Manual testing; 455 Python tests pass |

**Deliverable**: Working React app with search page at feature parity. Both old (Jinja2) and
new (React) UIs coexist during migration.

### 14B: Migrate Remaining Pages ✓

Migrated all remaining pages from Jinja2 to React with UX improvements.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 14B.1 | Migrate Dashboard page | Done | Stat cards (inline layout), recent docs table, projects table with "List" button, quick search input |
| 14B.2 | Migrate Document Detail page | Done | Markdown viewer (Rendered/Raw toggle), collapsible version history with timestamps, metadata accordion, chunks accordion, edit/download/delete actions, two-step delete confirmation |
| 14B.3 | Migrate Document Edit page | Done | Edit/Preview toggle for content (live Markdown preview), multi-select projects, dynamic metadata key/value editor |
| 14B.4 | Migrate Document Ingest page | Done | Two-tab layout (Paste Content / Upload File), filename existence check, update-existing toggle, project + metadata assignment |
| 14B.5 | Migrate Projects page | Done | List with create form, edit modal, delete with inline confirmation |
| 14B.6 | Add dedicated Project Documents page | Done | `/projects/:id/documents` - clean table view, replaces broken browse-by-project-only search |
| 14B.7 | Remove Jinja2 SSR app, add root redirect to /app/ | Done | Removed routes.py, test_routes.py (83 tests), jinja2 dependency. Root shows redirect page. |
| 14B.8 | Fix Vite base path for production SPA serving | Done | Set `base: '/app/'` in vite.config.ts so asset paths resolve correctly under FastAPI |
| 14B.9 | Rewrite Playwright e2e tests for React SPA | Done | All UI tests updated for /app/ paths, Mantine selectors, React SPA structure |
| 14B.10 | Update all documentation referencing the web UI | Pending | |

**Deliverable**: Fully migrated SPA. Jinja2 SSR removed. Root redirects to /app/.
Templates kept on disk for reference.

**Bug fixes during 14A/14B**:
- Fixed `CerefoxClient` initialization in `deps.py`
- Fixed `update_project` API call signature (dict, not positional args)
- Fixed broken documents from failed embedding (check actual chunk count, not stored field)
- Fixed search result links using React Router navigation (basename issue)
- Fixed Vite base path for production SPA serving (assets 404)
- Fixed Pydantic forward reference for project documents endpoint

### 14C: UI Polish ✓

| # | Task | Status | Notes |
|---|------|--------|-------|
| 14C.1 | Version history diff view | Deferred | Moved to Iteration 15 (needs review status context) |
| 14C.2 | Inline document editing | Deferred | Moved to Iteration 15 |
| 14C.3 | Bulk operations UI | Deferred | Moved to TODO backlog (premature at current scale) |
| 14C.4 | Dark mode support | Done | `defaultColorScheme="auto"` (follows OS); sun/moon toggle in header |
| 14C.5 | Toast notifications | Done | Mantine Notifications; success/error toasts for save, delete, CRUD |
| 14C.6 | Delete Jinja2 template files | Done | All 15 templates removed from web/templates/ |
| 14C.7 | Update all docs referencing the web UI | Done | CLAUDE.md, README, solution-design, requirements, contributing, e2e-use-cases |

**Deliverable**: Polished SPA with dark mode and toast notifications. Jinja2 templates
fully removed. All documentation aligned with React SPA architecture.

---

## Iteration 15: Audit Log, Attribution, Review Status, and Version Governance

**Goal**: Implement the trust and governance primitives described in the
[Vision document](../research/vision.md): immutable audit log, author attribution,
review status workflow, version archival, and temporal queries. Includes the UI
components deferred from 14C (diff view, inline editing) that are needed for the
governance workflows.

**Phased approach**: 15A (schema + backend), 15B (UI + queries).

### 15A: Schema, Audit Log, and Backend Logic

| # | Task | Status | Notes |
|---|------|--------|-------|
| 15A.1 | Create `cerefox_audit_log` table (immutable, append-only) | Done | Includes author_type ('user' | 'agent') for review_status auto-transition. Indexes for temporal, author, document, FTS on description. ON DELETE SET NULL for document_id and version_id FKs. |
| 15A.2 | Add `review_status` column to `cerefox_documents` | Done | CHECK constraint: 'approved' | 'pending_review'. Default 'approved'. |
| 15A.3 | Add `archived` boolean to `cerefox_document_versions` | Done | Default false. Protected versions skip retention cleanup. |
| 15A.4 | Add `CEREFOX_VERSION_CLEANUP_ENABLED` setting | Done | Boolean (default true). Passed to `cerefox_snapshot_version` RPC as `p_cleanup_enabled`. |
| 15A.5 | Write audit log insertion logic in Python | Done | `create_audit_entry()`, `list_audit_entries()` on CerefoxClient. author_type validated. |
| 15A.6 | Wire audit log into ingestion pipeline | Done | Audit entries on create, update-content, update-metadata. author/author_type threaded through ingest_text() and update_document(). try/except to avoid blocking on audit failure. |
| 15A.7 | Add `review_status` auto-transition logic | Done | author_type='agent' + content change -> pending_review. author_type='user' + content change -> approved. Metadata-only updates do not change status. |
| 15A.8 | Add version archival API | Done | `POST /api/v1/documents/{id}/versions/{vid}/archive`. Sets archived flag, creates audit entry. |
| 15A.9 | Add audit log retrieval API + review status API | Done | `GET /api/v1/audit-log` with filters. `POST /api/v1/documents/{id}/review-status`. DocumentDetailResponse includes review_status, DocumentVersionResponse includes archived. |
| 15A.10 | Deploy schema changes | Done | Migration 0004 applied. RPCs redeployed (snapshot_version with p_cleanup_enabled + archived skip, list_document_versions with archived column). |
| 15A.11 | Write unit tests for audit log, review status, version archival | Done | 24 new tests in test_audit_and_governance.py. 392 total tests pass. |

### 15B: UI, Filters, and Temporal Queries

| # | Task | Status | Notes |
|---|------|--------|-------|
| 15B.1 | Add audit log FTS | Deferred | FTS index deployed on description column. Query integration deferred (direct table query with FTS is sufficient for now). |
| 15B.2 | Add `review_status` filter to search | Done | Filter dropdown on search page (All / Approved / Pending Review). Post-filter on docs mode results. |
| 15B.3 | Build Audit Log browser page | Done | `/app/audit-log`: filterable table (operation, author). Color-coded badges, document links, size delta. |
| 15B.4 | Add review status indicators to all document lists | Done | Green "Approved" / yellow "Pending" badges on dashboard, project documents. list_documents query updated to include review_status. |
| 15B.5 | Add review status toggle to Document Detail page | Done | SegmentedControl with green/yellow color matching. Creates audit entry via API. |
| 15B.6 | Add version archival toggle to Document Detail page | Done | Clickable badges: green "Yes (archived)" / yellow "No (will be deleted)" with tooltips. Unarchive requires confirmation. Lock icon on archived versions. |
| 15B.7 | Version diff view (current vs specific version) | Done | "Diff" button per version row. Modal with unified diff view. Uses `diff` npm package. Shows +added/-removed stats. Side-by-side removed (alignment issues). |
| 15B.8 | Inline document editing on detail page | Removed | Edit page with Edit/Preview toggle is sufficient. |
| 15B.9 | Update MCP server and Edge Functions for audit log + review status | Done | cerefox_create_audit_entry RPC + cerefox_list_audit_entries RPC (single implementation). New cerefox-get-audit-log Edge Function. New cerefox_get_audit_log MCP tool. cerefox-ingest accepts author/author_type, sets review_status, creates audit entries via RPC. cerefox-mcp passes author (agent-provided or default "mcp-agent"), author_type="agent". |
| 15B.10 | Update Playwright e2e tests for governance features | Done | Added review status toggle visibility test, audit log page load test. |
| 15B.11 | Update documentation | Done | plan.md updated with all task statuses. |

**Design decisions:**
- **Attribution**: no `created_by`/`updated_by` columns on documents. The audit log is the source of truth for who did what, when. Denormalized columns may be added later if needed.
- **Audit log access**: separate RPC, Edge Function, and MCP tool (`cerefox_get_audit_log`), not embedded in `cerefox_get_document`. Keeps agent API surface clean and follows single implementation principle.
- **Temporal search**: queries the audit log metadata and descriptions only, not versioned chunk content. Versions remain unindexed (excluded from default search by existing partial indexes).
- **Version cleanup default**: enabled (`CEREFOX_VERSION_CLEANUP_ENABLED=true`). Audit log entries persist regardless of version cleanup, preserving the accountability record.
- **Version promotion deferred**: user can download an old version and re-upload to revert. The diff view (15B.7) helps the user decide; the actual revert is manual. Promotion API may be added later if the manual workflow proves too cumbersome.

**Deliverable**: Full trust and governance layer. Agents write freely; human monitors via
the web UI with full audit trail, review status indicators, version archival, diff view,
and lightweight review workflow. Temporal queries support multi-agent coordination catch-up.

---

## Iteration 16: MCP Consolidation, Metadata Search, Usage Tracking, and Analytics

**Three independent feature branches**, all part of this iteration:
- `feat/mcp-consolidation` — 16A only, standalone, deployable independently; halves Edge Function invocations
- `feat/metadata-search` — 16B only, standalone, deployable independently
- `feat/usage-analytics` — 16C + 16D; depends on nothing in 16A or 16B but 16C wires usage logging
  into `cerefox-mcp` so it should be implemented after 16A is merged

**Overview**:
- **16A**: Refactor `cerefox-mcp` Edge Function to call RPCs directly instead of delegating to
  individual primitive Edge Functions -- halves billable invocations per MCP call
- **16B**: New `cerefox_metadata_search` RPC and Edge Function -- query documents by metadata
  key-value pairs without a text search term (resolves [issue #9](https://github.com/fstamatelopoulos/cerefox/issues/9))
- **16C**: Usage tracking -- new `cerefox_usage_log` table with opt-in tracking of all read
  operations across all access paths; opt-in control via web UI / CLI
- **16D**: Analytics page in the React SPA -- visualizes access patterns from the usage log

---

### 16A: MCP Edge Function Consolidation (Cost Optimisation)

**Goal**: Reduce billable Supabase Edge Function invocations from 2 to 1 per MCP tool call
by refactoring `cerefox-mcp` to call Postgres RPCs directly, instead of delegating to
individual primitive Edge Functions (`cerefox-search`, `cerefox-ingest`, etc.).

**Background**: Every MCP tool invocation currently triggers two billable invocations: one
for `cerefox-mcp` receiving the JSON-RPC request, and one for the internal `fetch()` call
to the corresponding primitive function (e.g. `cerefox-search`). The Supabase free tier
limits apply to Edge Function invocations only (not RPC calls), so this double-counting
makes Cerefox unnecessarily expensive. With this refactor, `cerefox-mcp` calls RPCs
directly -- exactly like the primitive Edge Functions already do -- and the primitive
functions remain unchanged for external callers (GPT Actions, curl, direct HTTP).

**Reference**: PR [#10](https://github.com/fstamatelopoulos/cerefox/pull/10) by tdebasis
implements this pattern in a new parallel function (`supabase/functions/cerefox/`). We will
**not merge that PR as-is** (it would create a second parallel MCP server with a different
URL, and it predates the iteration 15 audit log tool). Instead, we refactor `cerefox-mcp`
in-place using the PR's multi-file structure (`tools/`, `shared.ts`, `embeddings.ts`) as a
reference. Credit will be given in the commit message.

**Invariants** (must not change):
- All 6 primitive Edge Functions (`cerefox-search`, `cerefox-ingest`, `cerefox-metadata`,
  `cerefox-get-document`, `cerefox-list-versions`, `cerefox-get-audit-log`) remain deployed
  and callable directly. External callers (GPT Actions, curl, direct HTTP integrations) must
  continue to work. (`cerefox-metadata-search` will be added as the 7th primitive in 16B.)
- MCP client configuration does not change -- same URL, same auth header.
- All 6 MCP tools expose the same input/output schema; no breaking changes to callers.
- **No DB migrations in 16A** -- this is a pure TypeScript refactor. `db_migrate.py` is not
  involved. The 6 existing RPCs are called directly; none are modified.

**Architecture after 16A**:
```
Agent (MCP) → cerefox-mcp → cerefox_hybrid_search RPC        (was: → cerefox-search → RPC)
                           → cerefox_ingest_document RPC      (was: → cerefox-ingest → RPC)
                           → cerefox_list_metadata_keys RPC   (was: → cerefox-metadata → RPC)
                           → cerefox_get_document RPC         (was: → cerefox-get-document → RPC)
                           → cerefox_list_document_versions   (was: → cerefox-list-versions → RPC)
                           → cerefox_list_audit_entries RPC   (was: → cerefox-get-audit-log → RPC)

GPT Actions → cerefox-search / cerefox-ingest / ... (unchanged, still go through primitive functions)
```

**File structure after 16A** (inside `supabase/functions/cerefox-mcp/`):
```
index.ts          -- MCP protocol handler + tool dispatch (no fetch delegation)
shared.ts         -- CORS headers, Supabase client init, response utilities
embeddings.ts     -- OpenAI embedding call (used by search and ingest tools)
tools/
  search.ts       -- cerefox_hybrid_search RPC call + response formatting
  ingest.ts       -- chunk + embed + cerefox_ingest_document RPC call
  metadata.ts     -- cerefox_list_metadata_keys RPC call
  get-document.ts -- cerefox_get_document RPC call
  list-versions.ts -- cerefox_list_document_versions RPC call
  audit-log.ts    -- cerefox_list_audit_entries RPC call
```

#### Tasks

**Step 1 -- Refactor `cerefox-mcp` to multi-file structure**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16A.1 | Extract `shared.ts` from current `cerefox-mcp/index.ts` | Done | CORS headers, `makeSupabaseClient()`, `jsonResponse`, `errorResponse`, `notificationResponse`, `applyByteBudget` |
| 16A.2 | Extract `embeddings.ts` -- unified OpenAI embedding call with retry | Done | `getEmbedding` (single, for search), `embedBatch` (batch, for ingest); exponential backoff 500ms/3 attempts; retry 5xx not 4xx |
| 16A.3 | Create `tools/search.ts` -- calls search RPCs directly | Done | Handles all 3 modes (docs/hybrid/fts), `metadata_filter`, `max_bytes` ceiling, project_name→UUID resolution |
| 16A.4 | Create `tools/ingest.ts` -- chunks, embeds, calls `cerefox_ingest_document` RPC | Done | Full heading-aware chunker + `embedBatch`; handles `update_if_exists`, hash dedup, `review_status` transition |
| 16A.5 | Create `tools/metadata.ts` -- calls `cerefox_list_metadata_keys` RPC directly | Done | |
| 16A.6 | Create `tools/get-document.ts` -- calls `cerefox_get_document` RPC directly | Done | Supports optional `version_id` param |
| 16A.7 | Create `tools/list-versions.ts` -- calls `cerefox_list_document_versions` RPC | Done | |
| 16A.8 | Create `tools/audit-log.ts` -- calls `cerefox_list_audit_entries` RPC directly | Done | All filters: operation, author, document_id, since, until, limit |
| 16A.9 | Rewrite `index.ts` -- MCP protocol handler dispatching to tools/ modules | Done | Imports from tools/*.ts; `OPENAI_API_KEY` checked only for tools that need it; no `fetch()` delegation |

**Step 2 -- Verify parity**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16A.10 | Verify all 6 tool input/output schemas are identical to pre-refactor | Todo | Compare `tools/list` response before and after; no schema changes allowed |
| 16A.11 | Verify `author` / `author_type` / `review_status` behavior unchanged in ingest tool | Todo | agent writes → pending_review; these semantics must be preserved |
| 16A.12 | Verify `max_bytes` ceiling enforcement still works in search tool | Todo | |

**Step 3 -- Deploy and test**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16A.13 | Deploy refactored `cerefox-mcp` | Done | `npx supabase functions deploy cerefox-mcp` |
| 16A.14 | Scan existing Python unit tests for any mocks referencing fetch delegation from `cerefox-mcp` | Done | No matches -- Python tests do not reference MCP delegation |
| 16A.15 | Run full unit test suite | Done | 391/391 pass; no Python changes |
| 16A.16 | Write `tests/e2e/test_mcp_e2e.py` -- MCP JSON-RPC e2e tests for deployed `cerefox-mcp` | Done | 17 tests; all pass (MCPClient helper + fixture in conftest.py) |
| 16A.17 | Write `tests/e2e/test_edge_functions_e2e.py` -- HTTP e2e tests for all 6 primitive Edge Functions | Done | 12 tests; all pass |
| 16A.18 | Run full e2e test suite (existing + new) against deployed functions | Done | 29/29 new tests pass; all existing e2e tests pass |
| 16A.19 | Manual smoke test: all 6 tools via Claude Code MCP connection | Done | Confirmed via e2e test suite (all 6 tools exercised through deployed cerefox-mcp) |

**Step 4 -- New e2e test suites**

New test file: `tests/e2e/test_mcp_e2e.py` -- tests the deployed `cerefox-mcp` Edge Function
via raw MCP JSON-RPC 2.0 HTTP calls. Does not use the Python MCP SDK -- calls the endpoint
directly with `httpx` so failures are unambiguous. Reads `CEREFOX_SUPABASE_URL` and
`CEREFOX_SUPABASE_ANON_KEY` from `.env`. Cleans up `[E2E-MCP]`-prefixed documents.

| # | Test | Notes |
|---|------|-------|
| MCP-1 | GET / returns health check JSON (name, version, status: ok) | |
| MCP-2 | `initialize` returns correct protocolVersion and tool capabilities | |
| MCP-3 | `tools/list` returns all 6 tools with correct names and inputSchema | |
| MCP-4 | `cerefox_ingest` -- create a new `[E2E-MCP]` document | |
| MCP-5 | `cerefox_search` -- find the ingested document | |
| MCP-6 | `cerefox_ingest` with `update_if_exists: true` -- update the document | |
| MCP-7 | `cerefox_ingest` with same content -- skipped (hash dedup) | |
| MCP-8 | `cerefox_get_document` -- retrieve the full document | |
| MCP-9 | `cerefox_list_versions` -- list archived versions | |
| MCP-10 | `cerefox_get_audit_log` -- filter by author | |
| MCP-11 | `cerefox_list_metadata_keys` -- returns list (possibly empty) | |
| MCP-12 | Unknown tool returns JSON-RPC error with code -32602 | |
| MCP-13 | Missing required param returns JSON-RPC error (propagated from tool handler) | |

New test file: `tests/e2e/test_edge_functions_e2e.py` -- tests the 6 primitive Edge Functions
directly via HTTP POST. Each test is independent. Uses `CEREFOX_SUPABASE_ANON_KEY`.
Cleans up `[E2E-EF]`-prefixed documents.

| # | Test | Notes |
|---|------|-------|
| EF-1 | `cerefox-search` -- basic query returns results | |
| EF-2 | `cerefox-search` -- metadata_filter narrows results | |
| EF-3 | `cerefox-search` -- unknown project_name returns 404 | |
| EF-4 | `cerefox-ingest` -- create document, confirm 201 + document_id | |
| EF-5 | `cerefox-ingest` -- `update_if_exists: true` updates existing doc | |
| EF-6 | `cerefox-metadata` -- returns array of key objects | |
| EF-7 | `cerefox-get-document` -- returns title + full_content | |
| EF-8 | `cerefox-get-document` -- non-existent UUID returns 404 | |
| EF-9 | `cerefox-list-versions` -- returns array (possibly empty) | |
| EF-10 | `cerefox-get-audit-log` -- returns array of entries | |
| EF-11 | `cerefox-get-audit-log` -- `operation` filter returns subset | |

**Step 5 -- Documentation**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16A.20 | Update `CLAUDE.md` -- Edge Function architecture section; update architecture diagram arrows | Done | |
| 16A.21 | Update `docs/solution-design.md` -- architecture flow diagram; clarify that `cerefox-mcp` calls RPCs directly while primitive functions remain for external callers | Done | |
| 16A.22 | Update `MEMORY.md` -- revise architecture note about `cerefox-mcp` delegation | Done | |
| 16A.23 | Add entry to Cerefox Decision Log -- record decision to refactor in-place vs merge PR #10; credit tdebasis | Done | Via `cerefox_ingest` with `update_if_exists: true` |

**Deliverable**: `cerefox-mcp` calls RPCs directly. MCP tool calls cost 1 Edge Function
invocation instead of 2. All 6 primitive functions remain deployed and unchanged. No
breaking changes to any MCP client. All 391 unit tests pass. Two new e2e test suites
(MCP + primitive EFs) cover all tools end-to-end. Closes PR #10 concept (with credit).
Edge Function count stays at 7 (1 MCP + 6 primitive); MCP tool count stays at 6.

---

### 16B: Metadata-Only Document Search + Project Name Standardisation

**Goal**: Two related improvements delivered together:

1. New `cerefox_metadata_search` retrieval primitive -- query documents by metadata key-value
   pairs without a text search term. First-class feature, not just an inter-agent coordination
   hack. Primary audience: any caller (agent or human) that wants to filter by metadata without
   caring about content, or that wants a list of matching document IDs to selectively retrieve
   via `cerefox_get_document`. Resolves [issue #9](https://github.com/fstamatelopoulos/cerefox/issues/9).

2. Project name standardisation across all MCP tool interfaces -- agents interact with project
   names everywhere; UUIDs are an internal implementation detail. Includes returning
   `project_names TEXT[]` alongside `project_ids UUID[]` in all document results, and a new
   `cerefox_list_projects` MCP tool for project discovery.

**Breaking change** (MCP remote path only): `cerefox-mcp` tool inputs change from
`project_id` (UUID string) to `project_name` (human-readable name) for the `cerefox_search`,
`cerefox_ingest`, and `cerefox_metadata_search` tools. Name-to-UUID resolution happens inside
the tool handler. **Agents using `project_id` in their MCP calls must switch to `project_name`
after upgrading.** Primitive Edge Functions (`cerefox-search` etc.) are unchanged -- they
continue to accept `project_id UUID` for direct HTTP callers (GPT Actions, curl).

After 16A is merged: new `cerefox-mcp` tools follow the 16A architecture (call RPCs directly,
no fetch delegation).

#### New and updated RPC designs

```sql
-- NEW: list all projects (for MCP tool and project discovery)
CREATE FUNCTION cerefox_list_projects()
RETURNS TABLE (id UUID, name TEXT, description TEXT)

-- UPDATED: all 6 existing search/retrieve RPCs gain project_names TEXT[]
-- in RETURNS TABLE. Input signatures (p_project_id UUID) are unchanged.
-- Requires DROP FUNCTION + CREATE since RETURNS TABLE signature changes.
-- project_names computed via: ARRAY(SELECT p.name FROM cerefox_projects p
--   JOIN cerefox_document_projects dp ON p.id = dp.project_id
--   WHERE dp.document_id = d.id)

-- NEW: metadata-only document search
CREATE FUNCTION cerefox_metadata_search(
  p_metadata_filter   JSONB,
  p_project_id        UUID        DEFAULT NULL,   -- internal; MCP resolves name → UUID
  p_updated_since     TIMESTAMPTZ DEFAULT NULL,
  p_created_since     TIMESTAMPTZ DEFAULT NULL,
  p_limit             INT         DEFAULT 10,
  p_include_content   BOOLEAN     DEFAULT FALSE,
  p_max_bytes         INT         DEFAULT NULL
)
RETURNS TABLE (
  document_id     UUID,
  title           TEXT,
  doc_metadata    JSONB,
  review_status   TEXT,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  project_ids     UUID[],
  project_names   TEXT[],
  version_count   INT,
  content         TEXT    -- NULL when p_include_content = FALSE
)
```

- Matching: `d.doc_metadata @> p_metadata_filter` (JSONB containment -- uses GIN index)
- `p_max_bytes` applies to accumulated response when `p_include_content = TRUE`; same pruning
  model as `cerefox_search_docs`
- Returns at most `p_limit` rows, ordered by `updated_at DESC`
- `project_ids` and `project_names` both use `ARRAY(SELECT ...)` -- empty array `{}` for
  documents with no projects (not NULL)

#### Updated and new MCP tool designs

```
Tool: cerefox_search  (UPDATED input)
  project_name   string   optional   Filter by project name (was: project_id UUID string)

Tool: cerefox_ingest  (UPDATED input -- was already project_name in local MCP; now consistent)
  project_name   string   optional   Assign to project by name (was: project_id UUID in remote MCP)

Tool: cerefox_metadata_search  (NEW)
Description: Find documents by metadata key-value criteria without a text search term.
             Use to discover documents tagged with specific attributes, browse by taxonomy,
             or retrieve messages/tasks by type and status.
Parameters:
  metadata_filter   object    required  Key-value pairs; ALL must match (AND semantics)
  project_name      string    optional  Restrict to a project by name
  updated_since     string    optional  ISO-8601 timestamp; only docs updated on/after
  created_since     string    optional  ISO-8601 timestamp; only docs created on/after
  limit             integer   optional  Max results (default 10)
  include_content   boolean   optional  Include full document text (default false)
  max_bytes         integer   optional  Soft cap on total response bytes
Returns: Matching documents with metadata and project names; content if requested.

Tool: cerefox_list_projects  (NEW)
Description: List all projects with their names and IDs. Use this to discover available
             projects before filtering by project_name in other tools.
Parameters: none
Returns: Array of {id, name, description} for all projects.
```

#### Tasks

**Step 1 -- SQL RPCs (all bundled in migration `0005_metadata_search.sql`)**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.1 | Add `project_names TEXT[]` to RETURNS TABLE of all 6 existing search/retrieve RPCs | Done | All 6 RPCs updated via DROP+CREATE; `ARRAY(SELECT p.name ...)` pattern |
| 16B.2 | Write `cerefox_list_projects()` RPC | Done | SECURITY DEFINER, STABLE, returns id/name/description |
| 16B.3 | Write `cerefox_metadata_search` RPC | Done | JSONB containment, project/date filters, include_content, byte budget |
| 16B.4 | Create and deploy migration `0005_metadata_search.sql` | Done | Applied to live Supabase; rpcs.sql updated as canonical source |

**Step 2 -- Python client**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.5 | Add `project_names: list[str]` field to `SearchResult`, `DocResult` in `search.py` | Done | `doc_project_names` field added to both dataclasses and `from_row()` |
| 16B.6 | Add `list_projects_rpc()` to `client.py` | Done | Calls `cerefox_list_projects` RPC |
| 16B.7 | Add `metadata_search()` to `client.py` | Done | All params pass through; `p_max_bytes` omitted when None |

**Step 3 -- REST API**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.8 | Update search response models to include `project_names: list[str]` | Done | `DocSearchResultResponse`, `ChunkSearchResultResponse` gain `doc_project_names` |
| 16B.9 | Add `POST /api/v1/documents/metadata-search` endpoint | Done | `MetadataSearchRequest`/`MetadataSearchResultResponse` models; uncapped for web UI |

**Step 4 -- Edge Functions and MCP wiring**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.10 | Update `tools/search.ts` in `cerefox-mcp` -- `project_name` input with name→UUID resolution | Done | Already used `project_name` since 16A; no change needed |
| 16B.11 | Update `tools/ingest.ts` in `cerefox-mcp` -- same `project_name` input pattern | Done | Already used `project_name` since 16A; no change needed |
| 16B.12 | Add `tools/list-projects.ts` to `cerefox-mcp` | Done | Calls `cerefox_list_projects` RPC; returns formatted list |
| 16B.13 | Update `index.ts` dispatcher -- add 2 new tools, update schemas | Done | Tool count: 6 → 8 |
| 16B.14 | Create `cerefox-metadata-search` primitive Edge Function | Done | Thin wrapper; accepts `project_id UUID`; enforces max_bytes ceiling |
| 16B.15 | Add `tools/metadata-search.ts` to `cerefox-mcp` | Done | Calls RPC directly; resolves `project_name` → UUID |
| 16B.16 | Deploy all updated Edge Functions | Done | Both `cerefox-metadata-search` and `cerefox-mcp` deployed |

**Step 5 -- Local MCP server**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.17 | Add `cerefox_list_projects` tool to `mcp_server.py` | Done | |
| 16B.18 | Add `cerefox_metadata_search` tool to `mcp_server.py` | Done | With project_name resolution and byte budget |

**Step 6 -- CLI**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.19 | Add `cerefox metadata-search` CLI command | Done | All options implemented |

**Step 7 -- Web UI**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.20 | Update search results components to display `project_names` as badges | Done | Blue badges on doc result cards in SearchResults component |
| 16B.21 | Add "Metadata Search" page at `/app/metadata-search` | Done | Filter builder, project dropdown, date filters, include-content, result cards with metadata/project badges |
| 16B.22 | Add "Metadata Search" nav link | Done | After "Search" in the nav bar |

**Step 8 -- Tests**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.23 | Unit tests: `project_names` field present in all result types; `list_projects_rpc()` param pass-through | Done | 4 new tests in test_db_client.py and test_search.py; 395 total |
| 16B.24 | Unit tests: `metadata_search()` in `client.py`; param propagation; max_bytes pass-through | Done | Covered by test_metadata_search_calls_rpc_with_params and test_metadata_search_omits_max_bytes_when_none |
| 16B.25 | E2e test: metadata_search + list_projects via Python client | Deferred | Covered by MCP and Edge Function e2e tests below; Python client is a thin pass-through |
| 16B.26 | E2e test: new MCP tools + project_name resolution via MCP | Done | 6 new tests in TestMCPNewTools16B; 23 MCP e2e tests total |
| 16B.27 | E2e test: cerefox-metadata-search primitive Edge Function | Done | 4 new tests in TestMetadataSearchEdgeFunction; 16 EF e2e tests total |
| 16B.28 | Playwright UI e2e test: metadata-search page | Deferred | Manual testing confirmed working; Playwright test deferred to future iteration |

**Step 9 -- Documentation**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.29 | Update `docs/guides/connect-agents.md` -- updated tool schemas, new tools | Done | 8 tools, corrected cerefox-mcp description, Edge Function usage advantage, no legacy label |
| 16B.30 | Update `docs/guides/upgrading.md` -- v0.1.10 breaking change notice | Done | Already drafted and cleaned up in earlier commit |
| 16B.31 | Update `README.md` -- add metadata search and project discovery | Done | Feature table updated; local MCP reframed |
| 16B.32 | Update `CLAUDE.md` -- Edge Function inventory and architecture diagram | Done | 8 Edge Functions, 8 MCP tools; diagram updated with new RPCs |
| 16B.33 | Update `MEMORY.md` -- revised counts and current state | Done | |
| 16B.34 | Update `docs/solution-design.md` -- metadata search and project name pattern | Done | Updated in 16A; metadata search noted in access path diagram |
| 16B.35 | Add entries to Cerefox Decision Log | Done | 3 entries: metadata search as separate primitive, project_name standardisation, list_projects for discovery |

**Deliverable**: Agents query by metadata and filter by project name across all MCP paths.
All document results include human-readable project names. Agents can discover available
projects via `cerefox_list_projects`. Inter-agent coordination (message hub) fully supported.
Resolves issue #9. Edge Functions: 7 → 8. MCP tools: 6 → 8 (adding list_projects + metadata_search).

---

### 16C: Usage Tracking

**Goal**: Log all read operations (search, metadata_search, get_document, list_versions,
get_audit_log) across all access paths with enough context to answer "who accessed what,
when, and from where." Opt-in, disabled by default. The data feeds the analytics page (16D).

**Design decisions**:
- Separate `cerefox_usage_log` table -- not an extension of the audit log. The audit log
  tracks write accountability (governance); the usage log tracks read observability (analytics).
  Different schema needs, different retention semantics, different query patterns.
- Opt-in via a new `cerefox_config` key-value table stored in Postgres. Edge Functions and
  Python read this config at call time -- no redeploy needed to toggle. Only the user can
  change it (via web UI or CLI).
- `reader` parameter on read operations -- optional free-text, same pattern as `author` on
  write operations. If omitted, defaults based on access path (e.g., `"webapp"`, `"cli"`).
- `access_path` is set by the caller layer (not the caller of the caller): the Edge Function
  sets `"remote-mcp"` or `"edge-function"` as appropriate; Python routes set `"webapp"`;
  CLI sets `"cli"`; local MCP server sets `"local-mcp"`.

#### New table: `cerefox_usage_log`

```sql
id             UUID PRIMARY KEY DEFAULT gen_random_uuid()
logged_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
operation      TEXT NOT NULL   -- 'search', 'metadata_search', 'get_document',
                               --   'list_versions', 'get_audit_log'
access_path    TEXT NOT NULL   -- 'remote-mcp', 'local-mcp', 'edge-function',
                               --   'webapp', 'cli'
reader         TEXT            -- nullable; agent/user name
document_id    UUID REFERENCES cerefox_documents(id) ON DELETE SET NULL
project_id     UUID REFERENCES cerefox_projects(id) ON DELETE SET NULL
query_text     TEXT            -- for search / metadata_search: the query or filter
result_count   INT             -- number of results returned
extra          JSONB           -- flexible: include_content flag, max_bytes, etc.
```

Indexes: `logged_at DESC`, `(operation, logged_at)`, `access_path`, `reader`, `document_id`.

#### New table: `cerefox_config`

```sql
key    TEXT PRIMARY KEY
value  TEXT NOT NULL
```

Initial row: `('usage_tracking_enabled', 'false')`.

Future config keys (not in scope for this iteration): anything that Edge Functions
currently have as TypeScript constants (OPENAI_MODEL, EMBEDDING_DIMENSIONS) could
eventually migrate here, but that requires a separate migration and is out of scope.

#### RPC design

```sql
-- Insert a usage log entry (checks tracking_enabled first; no-op if disabled)
cerefox_log_usage(operation, access_path, reader, document_id, project_id,
                  query_text, result_count, extra) -> void

-- Read config value
cerefox_get_config(p_key TEXT) -> TEXT

-- Set config value (validates key against allowed list)
cerefox_set_config(p_key TEXT, p_value TEXT) -> VOID

-- Query usage log with filters
cerefox_list_usage_log(
  p_start        TIMESTAMPTZ DEFAULT NULL,
  p_end          TIMESTAMPTZ DEFAULT NULL,
  p_operation    TEXT        DEFAULT NULL,
  p_access_path  TEXT        DEFAULT NULL,
  p_reader       TEXT        DEFAULT NULL,
  p_project_id   UUID        DEFAULT NULL,
  p_limit        INT         DEFAULT 100
) -> TABLE(...)

-- Aggregated summary for analytics
cerefox_usage_summary(
  p_start       TIMESTAMPTZ DEFAULT NULL,
  p_end         TIMESTAMPTZ DEFAULT NULL,
  p_project_id  UUID        DEFAULT NULL,
  p_access_path TEXT        DEFAULT NULL
) -> JSON  -- flexible structure for the UI
```

#### Wiring: where usage logging is added

| Access path | Where to add | Notes |
|---|---|---|
| `cerefox-search` Edge Function | After RPC call, before response | Fire-and-forget `cerefox_log_usage` call; never block on failure |
| `cerefox-metadata-search` Edge Function | Same pattern | |
| `cerefox-get-document` Edge Function | Same pattern | Pass document_id |
| `cerefox-list-versions` Edge Function | Same pattern | Pass document_id |
| `cerefox-get-audit-log` Edge Function | Same pattern | |
| `cerefox-mcp` Edge Function | Log in each `tools/*.ts` handler (post-16A; no delegation layer) | access_path = `"remote-mcp"` for all 7 tools |
| Python REST routes (`routes_api.py`) | After each read endpoint | access_path = `"webapp"` |
| Local MCP server (`mcp_server.py`) | After each tool handler | access_path = `"local-mcp"` |
| CLI (`cli.py`) | After each read command | access_path = `"cli"` |

#### Tasks

**Step 1 -- Schema**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.1 | Create migration `0006_usage_log.sql` -- new tables and RPCs | Done | Both tables, 5 indexes, RLS enabled, 5 RPCs |
| 16C.2 | Update `schema.sql` to reflect final state | Done | |

**Step 2 -- RPCs**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.3 | Write `cerefox_log_usage` RPC | Done | Checks config; no-op if disabled |
| 16C.4 | Write `cerefox_get_config` and `cerefox_set_config` RPCs | Done | Allowlist-validated |
| 16C.5 | Write `cerefox_list_usage_log` RPC | Done | All filters + doc_title join |
| 16C.6 | Write `cerefox_usage_summary` RPC | Done | JSON with 6 aggregation sections |

**Step 3 -- Python client**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.7 | Add `log_usage()`, `get_config()`, `set_config()`, `list_usage_log()`, `usage_summary()` to `client.py` | Done | log_usage is fire-and-forget |

**Step 4 -- REST API**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.8 | Add `GET /api/v1/usage-log` endpoint | Done | Filtered list |
| 16C.9 | Add `GET /api/v1/usage-log/export.csv` endpoint | Done | CSV download with Content-Disposition |
| 16C.10 | Add `GET /api/v1/usage-log/summary` endpoint | Done | Aggregated JSON |
| 16C.11 | Add `GET /api/v1/config/{key}` and `PUT /api/v1/config/{key}` endpoints | Done | Allowlist-validated |

**Step 5 -- Wire logging through Edge Functions and MCP**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.12 | Add `cerefox_log_usage` call to `cerefox-search` Edge Function | Done | |
| 16C.13 | Add `cerefox_log_usage` call to `cerefox-metadata-search` Edge Function | Done | |
| 16C.14 | Add `cerefox_log_usage` call to `cerefox-get-document` Edge Function | Done | |
| 16C.15 | Add `cerefox_log_usage` call to `cerefox-list-versions` Edge Function | Done | |
| 16C.16 | Add `cerefox_log_usage` call to `cerefox-get-audit-log` Edge Function | Done | |
| 16C.17 | Add `cerefox_log_usage` calls to all 8 `tools/*.ts` handlers in `cerefox-mcp` | Done | Shared `logUsage()` helper in shared.ts |
| 16C.18 | Deploy all updated Edge Functions | Done | All 8 Edge Functions redeployed; 68 e2e tests pass |

**Step 6 -- Wire logging through Python paths**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.19 | Add `log_usage` calls to read endpoints in `routes_api.py` | Done | search + metadata_search; access_path = "webapp" |
| 16C.20 | Add `log_usage` calls to all read tools in `mcp_server.py` | Done | 7 handlers; access_path = "local-mcp" |
| 16C.21 | Add `log_usage` calls to CLI read commands in `cli.py` | Done | search, get-doc, list-versions; access_path = "cli" |

**Step 7 -- CLI config commands**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.22 | Add `cerefox config-get <key>` and `cerefox config-set <key> <value>` CLI commands | Done | |

**Step 8 -- Tests**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.23 | Unit tests: `log_usage`, `get_config`, `set_config`, `list_usage_log`, `usage_summary` | Done | 6 new tests; 401 total |
| 16C.24 | Unit tests: `log_usage` swallows exceptions | Done | Included in above |
| 16C.25 | Unit tests: `usage_summary` response parsing | Done | Included in above |
| 16C.26 | E2e test: enable tracking, log usage, verify entry appears | Done | TestUsageTracking.test_usage_logging_when_enabled |
| 16C.27 | E2e test: disable tracking, verify no-op | Done | TestUsageTracking.test_usage_logging_disabled_is_noop |
| 16C.28 | E2e test: MCP usage logging | Done | Verifies remote-mcp access_path entry appears after MCP search |

**Step 9 -- Documentation**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.29 | Add entry to Cerefox Decision Log | Done | 4 entries: separate table rationale, RPC-level config check, access_path taxonomy, Supabase thenable lesson |

**Deliverable**: All read operations are optionally logged with full context. The user controls
tracking via web UI or CLI. CSV export available. Data is ready for the analytics page.

---

### 16D: Analytics Page (Web UI)

**Goal**: Visualize usage log data in the React SPA. Requires 16C to be complete.

**Page**: `/app/analytics` -- new page in the main navigation.

**Layout**:
- Top row: date range picker (presets: last 7 / 30 / 90 days, custom range), project filter
  dropdown, access path filter
- Settings card: Usage Tracking toggle (on/off) -- calls `PUT /api/v1/config/usage_tracking_enabled`
- Summary stat cards: total calls, unique readers, unique documents accessed, most-used operation
- Visualization panels (described below)
- Export button: downloads CSV via `GET /api/v1/usage-log/export.csv`

**Visualizations** -- all included in the plan; some deferred to post-16 as noted:

| # | Chart | Status | Library | Notes |
|---|-------|--------|---------|-------|
| V1 | Calls per day (bar chart) | Done | Nivo ResponsiveBar | Primary activity overview |
| V2 | Calls per access path (bar chart) | Done | Nivo ResponsiveBar | Shows which clients are most active |
| V3 | Top N most-accessed documents (horizontal bar) | Done | Nivo ResponsiveBar | Ranked by access count |
| V4 | Top N most-active requestors (horizontal bar) | Done | Nivo ResponsiveBar | Ranked by call count |
| V5 | Operations breakdown (donut chart) | Done | Nivo ResponsivePie | Quick proportion view |
| V6 | Requestor activity word cloud | Done | CSS flex-wrap (no D3) | Word size proportional to call count; replaced react-d3-cloud (React 19 incompatible) |
| V7 | HEB: requestors → documents | Done | D3.js (pure, no wrapper) | Multi-agent coordination patterns |
| V8 | HEB: requestors → operations | Done | D3.js (pure, no wrapper) | Which agents use which operations |

#### Tasks

**Step 1 -- API client (TypeScript)**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16D.1 | Add `getUsageSummary`, `listUsageLog`, `exportUsageLogCsv`, `getConfig`, `setConfig` to the TypeScript API client | Done | `api/analytics.ts` |

**Step 2 -- Analytics page**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16D.2 | Create `AnalyticsPage.tsx` with date range picker, project filter, access path filter | Done | Period presets (7/30/90/all) + custom date range |
| 16D.3 | Add summary stat cards (total calls, unique readers, docs accessed, top operation) | Done | 4 stat cards from usage summary |
| 16D.4 | Implement V1: calls-per-day bar chart | Done | Nivo ResponsiveBar |
| 16D.5 | Implement V2: calls-per-access-path bar chart | Done | Nivo ResponsiveBar |
| 16D.6 | Implement V3: top documents horizontal bar chart | Done | Nivo ResponsiveBar |
| 16D.7 | Implement V4: top requestors horizontal bar chart | Done | Nivo ResponsiveBar |
| 16D.8 | Implement V5: operations breakdown donut chart | Done | Nivo ResponsivePie |
| 16D.9 | Implement V6: requestor word cloud | Done | CSS flex-wrap (react-d3-cloud incompatible with React 19) |
| 16D.9b | Implement V7: HEB requestors-to-documents | Done | D3.js pure; curved paths, hover highlight, legend |
| 16D.9c | Implement V8: HEB requestors-to-operations | Done | D3.js pure; shows which agents use which operations |
| 16D.10 | Add Usage Tracking toggle | Done | Switch in filter bar; calls PUT config API |
| 16D.11 | Add CSV export button | Done | Link to /api/v1/usage-log/export.csv with current filters |
| 16D.12 | Add "Analytics" to app navigation | Done | After "Audit Log" |

**Step 3 -- Tests**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16D.13 | Playwright e2e: navigate to analytics page, verify page loads with filters and export | Done | TestAnalytics.test_analytics_page_loads |

**Step 4 -- Documentation**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16D.14 | Add analytics section to `README.md` | Done | Usage tracking + analytics dashboard in feature table |
| 16D.15 | Update `docs/solution-design.md` -- add usage log table and analytics page to architecture | Done | |
| 16D.16 | Update `CLAUDE.md` -- note new `cerefox_config` and `cerefox_usage_log` tables | Done | Architecture principles section updated |

**Deliverable**: Users can visualize Cerefox usage patterns with 8 filterable charts
(V1-V8 all included). Usage tracking is opt-in and controllable from the web UI.
CSV export available for offline analysis. All visualizations implemented.

---

## Iteration 17: Search Quality — Title Boosting and Contextual Enrichment

**Goal**: Include document titles in search indexes to dramatically improve search quality.
Currently, searching for a document by its exact title fails unless the title words appear
in the body text. This iteration adds title boosting to both FTS and semantic search.

**Research**: see `docs/research/search-quality-title-boosting.md` for full analysis.

**Branch**: `feat/search-quality`

### 17A: Title Boosting for FTS and Semantic Search

#### Tasks

**Step 1 -- Schema and ingestion pipeline**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17A.1 | Change `fts` column from GENERATED to regular tsvector | Done | Migration: `ALTER TABLE cerefox_chunks ALTER COLUMN fts DROP EXPRESSION`; column stays, just no longer auto-computed |
| 17A.2 | Prepend `# {title}\n` to chunk content before computing embeddings in Python pipeline | Done | Embedding input = `f"# {title}\n{chunk.content}"`; stored `chunk.content` unchanged; replaces 17A.6 |
| 17A.3 | Update `cerefox_ingest_document` RPC to compute weighted tsvector internally using `p_title` (Option B) | Done | `setweight(to_tsvector('english', p_title), 'A') \|\| setweight(to_tsvector('english', chunk_content), 'B')` -- `p_title` is already a parameter; no pre-computed tsvector needed from caller; no denormalization; no trigger |
| 17A.4 | Prepend `# {title}\n` to chunk content before embedding in `cerefox-ingest` Edge Function | Done | Same as 17A.2; tsvector computation handled by RPC (17A.3); replaces 17A.7 |
| 17A.5 | Same embedding title prefix in `cerefox-mcp/tools/ingest.ts` | Done | Same as 17A.4 |

**Step 1B -- Title change: auto-update indexes**

When a document's title is updated (without content change), FTS and embeddings become stale.
Instead of requiring manual reindex, the pipeline auto-updates when a title change is detected.

- **FTS**: pure SQL -- UPDATE all current chunks' `fts` with the new title at weight A. Handled in a new `cerefox_update_chunk_fts` RPC called from the pipeline.
- **Embeddings**: re-embed all current chunks with new title prefix (external API call). Done in Python pipeline before calling the FTS update RPC.
- **No version snapshot**: content unchanged, so no new version is created.
- **Audit entry**: records the title change (existing audit path).

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17A.X1 | Detect title change in `update_document()` pipeline (compare old vs new title) | Done | Skip if title unchanged |
| 17A.X2 | Write `cerefox_update_chunk_fts(p_document_id, p_new_title)` RPC | Done | `UPDATE cerefox_chunks SET fts = setweight(to_tsvector('english', p_new_title), 'A') \|\| setweight(to_tsvector('english', content), 'B') WHERE document_id = p_document_id AND version_id IS NULL`; SECURITY DEFINER |
| 17A.X3 | When title changes: re-embed current chunks with new title prefix, then call `cerefox_update_chunk_fts` | Done | Python pipeline; uses existing embedder; fire-and-forget embedding update pattern; existing chunk rows updated in-place (no new version) |
| 17A.X4 | Wire title-change detection through REST API title edit path | Done | REST API edit endpoint already calls `pipeline.update_document()` which contains the title-change detection; no extra wiring was needed |
| 17A.X5 | Update `cerefox_update_chunk_fts` call in `cerefox_ingest_document` RPC | N/A | FTS computed inline in RPC at ingestion; standalone RPC used only for title-change updates from Python pipeline |

**Step 2 -- Search RPC updates**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17A.8 | Verify `ts_rank` / `ts_rank_cd` correctly weights A > B in existing RPCs | Done | `ts_rank` respects weight A > B by default; no changes needed to search RPCs |
| 17A.9 | Update `cerefox_hybrid_search` if rank computation needs adjustment | N/A | No change needed |
| 17A.10 | Update `cerefox_fts_search` if rank computation needs adjustment | N/A | No change needed |

**Step 3 -- Reindex script (optional migration aid)**

Reindexing existing documents after applying this migration is **optional but recommended**
for full benefit. New documents ingested after the migration will automatically use title
boosting. Old documents will continue to work (just without title in their FTS/embeddings)
until reindexed.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17A.11 | Update `cerefox reindex` CLI command to produce weighted tsvectors with title prefix | Done | Each chunk now embedded with title prefix; `update_chunk_fts` called per document after embedding |
| 17A.12 | Add `--dry-run` flag to reindex to preview what would change | Done | |
| 17A.13 | Create `scripts/reindex_all.py` convenience script | Done | Calls `cerefox reindex --all` with optional `--dry-run` and `--batch` flags |

**Step 4 -- Migration**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17A.14 | Create migration `0011_title_boosting.sql` | Done | ALTER fts column; add `cerefox_update_chunk_fts` RPC |
| 17A.15 | Update `schema.sql` as canonical source | Done | |
| 17A.16 | Update `docs/guides/upgrading.md` with step-by-step reindex instructions | Done | v0.1.14 section added with dry-run example, cost estimate, and resumability note |

**Step 5 -- Tests**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17A.17 | Unit tests: verify weighted tsvector includes title at weight A | Done | Covered in TestTitleBoosting (test_pipeline.py) |
| 17A.18 | Unit tests: verify embedding input includes title prefix | Done | Covered in TestTitleBoosting (test_pipeline.py) |
| 17A.19 | E2e test: ingest document, search by title only, verify it's found | Todo | Requires live Supabase (e2e suite) |
| 17A.20 | E2e test: title match ranks higher than body-only match | Todo | |

**Step 6 -- Documentation**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17A.21 | Update `docs/solution-design.md` -- search architecture section | Done | Added section 5.2 Title Boosting |
| 17A.22 | Update `CLAUDE.md` -- chunking and search notes | Done | Added item 8 to Key Design Decisions |
| 17A.23 | Add entry to Cerefox Decision Log | Todo | Update with implementation outcome after e2e tests |

**Deliverable**: Searching for a document by its title returns the document as a top result.
FTS title matches rank ~10x higher than body matches. Semantic search captures the title's
meaning in the embedding. New documents get title boosting automatically. Existing documents
can optionally be reindexed via `scripts/reindex_all.py` (instructions in upgrading.md).
Title changes auto-trigger FTS and embedding updates -- no manual reindex needed for title edits.

---

### 17B: ID-Based Document Updates in Ingest

**Goal**: Add optional `document_id` parameter to `cerefox_ingest` for deterministic
updates. Currently, updates rely on title matching (`update_if_exists: true`), which is
fragile (typos, case changes, duplicates create new documents instead of updating).

**Design decisions** (see `docs/research/search-quality-title-boosting.md`):
- `document_id` is optional. When provided, update that specific document by ID.
- When `document_id` is provided but does not exist: return error (don't create with client-provided IDs).
- When `document_id` is provided and `update_if_exists: false`: update anyway (ID is deterministic),
  but include a warning note in the response: `"note": "document_id provided; update_if_exists flag was overridden"`.
- When `document_id` is not provided: current behavior unchanged (title match via `update_if_exists`).
- No separate `cerefox_update` tool -- extending `cerefox_ingest` keeps the tool surface at 8.

**Agent workflow after 17A + 17B:**
1. `cerefox_search("topic")` -- finds doc with `[id: abc123]` (title in results from 17A)
2. `cerefox_get_document(document_id: "abc123")` -- gets full content
3. `cerefox_ingest(document_id: "abc123", title: "...", content: "...")` -- updates exactly that doc

#### Tasks

**Step 1 -- MCP and Edge Function changes**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17B.1 | Add optional `document_id` to `cerefox_ingest` MCP tool schema | Done | Not in `required` array; description explains ID-based update behavior |
| 17B.2 | Update `tools/ingest.ts` handler: if `document_id` provided, look up by ID instead of title | Done | Error if document not found; skip hash dedup (ID is explicit intent to update) |
| 17B.3 | Handle `update_if_exists: false` + `document_id` conflict: update anyway, add warning note to response | Done | |
| 17B.4 | Update `cerefox-ingest` primitive Edge Function with same logic | Done | Same behavior for GPT Actions path |
| 17B.5 | Update local MCP server `_handle_ingest` with same logic | Done | |
| 17B.6 | Update Python `IngestionPipeline.ingest_text()` to accept optional `document_id` | Done | Pass through to the RPC; skip title-based lookup when ID provided |

**Step 2 -- REST API**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17B.7 | Update `POST /api/v1/ingest` to accept optional `document_id` in request body | Done | Web UI ingest form doesn't need this (uses title); API supports it for programmatic access |

**Step 3 -- Tests**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17B.8 | E2e test: ingest with `document_id` updates the correct document | Done | Python pipeline + MCP + EF tests added |
| 17B.9 | E2e test: ingest with nonexistent `document_id` returns error | Done | |
| 17B.10 | E2e test: ingest with `document_id` + `update_if_exists: false` still updates, includes warning | Done | |
| 17B.11 | E2e test: ingest without `document_id` preserves current title-matching behavior | Done | Covered by 6 regression unit tests in TestIdBasedIngest |

**Step 4 -- Documentation**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 17B.12 | Update `docs/guides/connect-agents.md` MCP tool table with `document_id` param | Done | |
| 17B.13 | Update GPT Actions OpenAPI schema with optional `document_id` on ingest | Done | |
| 17B.14 | Add examples to tool description showing both workflows (title-based vs ID-based) | Done | In AGENT_GUIDE.md and AGENT_QUICK_REFERENCE.md |
| 17B.15 | Update `CLAUDE.md` with ingest ID-based update pattern | N/A | CLAUDE.md already covered by tool schema description |
| 17B.16 | Add entry to Cerefox Decision Log | In Progress | To be done after e2e tests run |

**Deliverable**: Agents can update documents by ID (deterministic) or by title (existing behavior).
The search -> get -> update workflow is fully supported without title-matching fragility.

---

## Iteration 18: SUPERSEDED — see Iteration 19+ (Polish & Distribution arc)

The original Iteration 18 ("Unify Local MCP Server in TypeScript") has been **superseded
and absorbed** into a broader Polish & Distribution arc that covers v0.2.0 through v1.0.0.
The TypeScript port of the local MCP server is now scheduled as **Iteration 22 (v0.4.0)** —
the first migration step of the broader Python → TypeScript strangler-fig migration.

Design-of-record: [`docs/specs/polish-and-distribution-design.md`](specs/polish-and-distribution-design.md).

Rationale for the supersession: the original Iteration 18 motivation (dedup MCP tool
handler drift between Python and TS) was correct but too narrow — it solved one symptom
of a broader language-fit problem. The expanded scope ships the full migration
incrementally (one component per minor version), each release shipping real user value
while moving toward a polished, npm-distributed, TypeScript-native Cerefox.

Detailed phasing: see **Iterations 19 through 26** below.

---

## Iteration 19: v0.2.0 — "Real Release" (foundations + first TS artifact)

**Goal**: Lay down version source-of-truth, project hygiene, and release-process discipline.
**First TypeScript artifact lands** — `scripts/cut_release.ts`, the release-cutting script,
is born in TS per the §12f script-language policy. No migration of EXISTING Python code yet
(that starts in v0.3.0 with the script ports of `sync_docs` and `db_status`). Bun becomes a
contributor prerequisite from this release; end users are unaffected until v0.4.
Backward-compatible at every user-facing surface.

**Design**: [`docs/specs/polish-and-distribution-design.md` §13 v0.2.0](specs/polish-and-distribution-design.md).

**Estimated effort**: 1-2 weeks part-time.

**Task breakdown**:

| # | Task | Status | Notes |
|---|------|--------|-------|
| 19.1 | Create `VERSION` file at repo root with content `0.2.0` | Done | Plain text, single source of truth |
| 19.2 | Update `pyproject.toml` to read version from `VERSION` (hatchling dynamic version) | Done | `[tool.hatch.version]` with `path = "VERSION"` and a regex pattern; `dynamic = ["version"]` in `[project]` |
| 19.3 | Update `src/cerefox/__init__.py` `__version__` to read from `VERSION` | Done | Reads `cerefox/_VERSION` (wheel-bundled via `force-include`) → `<repo>/VERSION` (dev mode) → `importlib.metadata.version("cerefox")` fallback |
| 19.4 | Verify `cerefox --version` returns `0.2.0` (was `0.1.0`) | Done | `@click.version_option(version=__version__, prog_name="cerefox")`; verified with `uv sync && uv run cerefox --version` |
| 19.5 | Add `<VersionFooter>` React component to web UI, reads version from `/api/v1/version` | Done | `frontend/src/components/VersionFooter.tsx` rendered at the bottom of `AppShell.Main`; links to the matching GitHub Release tag; TanStack Query with `staleTime: Infinity` |
| 19.6 | Add `/api/v1/version` endpoint returning `{version, git_commit_short, build_date}` | Done | Resolved once at process start; `git_commit_short` via `git rev-parse --short HEAD` (dev) or `CEREFOX_GIT_COMMIT` env var (CI); `build_date` from `CEREFOX_BUILD_DATE` env var |
| 19.7 | Write `scripts/cut_release.ts` (TypeScript, Bun-runnable) per design doc §12b | Done | First TS artifact outside Edge Functions / frontend. Full 11-step ritual: clean-tree / branch / origin-sync / tag-uniqueness preflight → CHANGELOG promote + fresh `[Unreleased]` → commit → annotated tag → push → `gh release create`. Modes: `--check`, `--dry-run`, `--yes` |
| 19.8 | Add Bun as contributor prerequisite — document the one-line install in `CONTRIBUTING.md` | Done | New Development Setup table lists Python+uv, Node, Bun with install one-liners |
| 19.9 | Create `.github/ISSUE_TEMPLATE/` with: `bug.yml`, `feature.yml`, `install-problem.yml`, `question.yml` | Done | All four templates use GitHub's YAML form spec with required fields and dropdowns |
| 19.10 | Create `.github/pull_request_template.md` (mirrors current commit-message conventions) | Done | Summary / Architecture-SemVer / Test plan / Docs / Related sections |
| 19.11 | Refresh `SECURITY.md` (how to report security issues responsibly) | Done | Expanded from 13 lines to a full policy: supported versions, private vulnerability reporting, threat model, scope, response expectations |
| 19.12 | Create `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 boilerplate) | Done | Adopts Contributor Covenant 2.1 **by reference** (link-out to the canonical URL) rather than inlining the boilerplate — recognized form of adoption, same as kubernetes/rust/microsoft; sidesteps content-filter false positives. See Decision Log Q2 Part 2 entry on the v0.2.0 cut. |
| 19.13 | Create empty `.github/FUNDING.yml` placeholder | Done | Placeholder with all GitHub-supported keys commented out |
| 19.14 | Update `CONTRIBUTING.md` with: SemVer policy, script-language policy, Bun prereq, dev-install path | Done | Three new sections: Development Setup (with Bun install), SemVer & Deprecation Policy (incl. force-move-tags rule), Script-Language Policy (effective from v0.2.0) |
| 19.15 | Update `README.md` "Project status" section to reference the new Polish & Distribution roadmap | Done | New section added between Features and Getting Started; v0.2.0 → v1.0.0 release roadmap table; notes Bun prereq for contributors only |
| 19.16 | Move `docs/research/polish-and-distribution-design.md` to `docs/specs/` (now "design-of-record" not "research") | Done | `git mv`; all references in README, CONTRIBUTING, CHANGELOG, plan.md updated |
| 19.17 | Decision Log entry: "v0.2.0 — Start of the polish-and-distribution arc; strategic shift to TS/Bun" | Done | Prepended to "Cerefox Decision Log — 2026 Q2 (Part 2)" via `cerefox_ingest` with `document_id` (deterministic update). Entry covers scope rationale, dogfood test, force-move-tags consistency, what was deliberately out of scope |
| 19.18 | Cut release v0.2.0 via `bun scripts/cut_release.ts 0.2.0` | Pending (post-merge) | Runs from `main` after this PR is merged — tag must point to a commit that exists on `main`. The script is already dry-run-verified against this branch state, and per the "force-move tags only on objective failure" rule, the tag will be created exactly once on the merge commit. |

**Deliverable**: `cerefox --version` shows `0.2.0` everywhere (CLI + web UI footer). Repo
has full OSS hygiene. Release process is reproducible from `bun scripts/cut_release.ts`,
which also creates the first-ever GitHub Release for Cerefox. SemVer policy AND
script-language policy documented and committed. Contributors now need Bun (one-line
install); end users unaffected.

**Tests / risk**: minimal. Version reading is a 5-line change per surface. Hygiene files
are templated. The cut-release TS script is the only meaningful new code; test by using
it to cut v0.2.0 itself (dogfooding).

---

## Iteration 20: v0.3.0 — "Install Anywhere" (config-state refactor + first script ports)

**Goal**: Make `cerefox` callable from any directory (today it requires
`cd /path/to/repo` because `pydantic-settings` reads `.env` from the process CWD
and the SQL files / docs are referenced by repo-relative paths). CLI / MCP /
web server remain Python, but **two scripts migrate to TS** per the
script-language policy (§12f of the design doc), because both are extended in
this iteration. Establishes the `_shared/` TS module structure that grows
through v0.4–v0.7.

**Design**: [`docs/specs/polish-and-distribution-design.md` §7 + §10 + §12f + §13 v0.3.0](specs/polish-and-distribution-design.md).

**Estimated effort**: 3-4 weeks part-time.

**Backward-compat invariant**: every existing `cd /path/to/cerefox && uv run cerefox …`
workflow must keep working unchanged. Dev mode (repo-local `.env` present in CWD)
wins over `~/.cerefox/.env`. New users (no repo-local `.env`) get the
`~/.cerefox/` flow; existing dev users are unaffected unless they explicitly
migrate.

**v1.0 revisit (planned)**: this precedence — repo-local `.env` winning over
`~/.cerefox/.env` — is **defensive for the v0.x line**. At v1.0 (the strict-
SemVer commitment release) we re-evaluate: the natural default for an
npm-installed CLI is to prefer the user-state dir, with repo-local `.env`
becoming an explicit opt-in (e.g. `CEREFOX_CONFIG_DIR=.`). The Decision Log
v0.2.0 entry flags v1.0 as the moment "binding from v1.0" applies; the
precedence flip is a candidate item to land in that release with a CHANGELOG
migration note and the documented deprecation cycle. For v0.3.0 we explicitly
do not flip it — that would break every existing dev install.

### 20A: Config-state refactor (Python)

Make `Settings`-resolution location-independent. The single hard change is
"where does `.env` come from"; everything downstream (`Settings()`, the CLI's
`_get_client`, the web server, etc.) keeps working because they only depend on
`Settings`.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 20A.1 | Write `resolve_config_dir()` in a new `src/cerefox/paths.py` module | Done | Pure function; exports `resolve_config_dir`, `resolve_env_file`, `user_state_dir`, `ensure_user_state_dir`, `is_dev_mode`, `default_backup_dir`. |
| 20A.2 | Wire `Settings` to consume `resolve_env_file()` | Done | `model_config = SettingsConfigDict(env_file=str(resolve_env_file()), ...)`. Evaluated at class-load time. `Settings._config_dir` classvar deferred — the standalone `resolve_config_dir()` is callable directly and no caller has needed the cached value yet. |
| 20A.3 | Add `~/.cerefox/` auto-creation helper (`ensure_user_state_dir()`) | Done | Creates the subdir layout from design doc §7a (`backups/`, `logs/`, `cache/`, `docs/`). Sets `~/.cerefox/.env` to chmod 600 if it exists. Best-effort on Windows (chmod no-op). |
| 20A.4 | Change default `backup_dir` from `./backups` to `<config_dir>/backups` | Done | `backup_dir: str = Field(default_factory=lambda: str(default_backup_dir()))`. Dev mode → `./backups` (preserves pre-v0.3.0 behavior); user-state mode → `~/.cerefox/backups`. `CEREFOX_BACKUP_DIR` still overrides. |
| 20A.5 | Update `scripts/db_deploy.py` and `scripts/db_migrate.py` to load SQL via `importlib.resources` | Done | Both scripts use `files("cerefox.db")` for schema/rpcs and `files("cerefox.db.migrations").iterdir()` for migration files. Works from any directory, in both editable and installed-wheel modes. |
| 20A.6 | Add `src/cerefox/db/migrations/__init__.py` (empty) | Done | One-line docstring; makes the directory a package so `importlib.resources.files()` finds it. |
| 20A.7 | Frontend `dist/` bundled into wheel via hatchling | Done | `force-include` block in `pyproject.toml` bundles `frontend/dist` → `cerefox/_frontend_dist`. `app.py` resolves via `_resolve_spa_dist()` with bundled-first / repo-fallback. Wheel inspection confirms `_frontend_dist/index.html`, JS, CSS all bundled. |
| 20A.8 | Add unit tests in `tests/test_paths.py` for `resolve_config_dir()` | Done | 20 tests across `TestResolveConfigDir`, `TestResolveEnvFile`, `TestUserStateDir`, `TestEnsureUserStateDir`, `TestIsDevMode`, `TestDefaultBackupDir`, `TestRegression`. The regression test (`test_repo_root_is_dev_mode`) asserts the backward-compat invariant. |
| 20A.9 | Verify `tests/test_config.py` for new resolver semantics | Done | No code change needed — existing tests already use `_env_file=None` for the isolation cases; the new resolver only kicks in for the default path which dev mode handles correctly. All 89 tests in `test_config.py` + `test_db_client.py` pass; full Python suite at 569. |

### 20B: Docs surfacing

Bundle docs into the package, expose two surfaces (`cerefox docs` CLI + web UI
`/app/help`), and add the schema-version-mismatch banner (catches the v0.1.19
"forgot to redeploy RPCs" footgun).

| # | Task | Status | Notes |
|---|------|--------|-------|
| 20B.1 | Bundle `docs/guides/`, `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`, `README.md` into the wheel | Done | Added to the `force-include` block alongside the frontend dist. Bundled at `cerefox/_docs/<original-path>`. Wheel inspection shows all 14 guide files + 3 root-level docs are present. |
| 20B.2 | Write `cerefox/docs_resources.py` helper module | Done | Exports `DocEntry` dataclass, `list_bundled_docs()`, `read_doc(rel_path)`, `real_path(rel_path)`, `find_doc(query)`. Resolves bundled-first / repo-fallback. Path-traversal guard on `read_doc` and `real_path`. |
| 20B.3 | Add `cerefox docs [TOPIC]` CLI command | Done | No arg → category-grouped index. With arg → fuzzy-match by exact path, basename, title substring, or path substring. `--print` for stdout dump. Opens via `webbrowser.open(file://…)`. |
| 20B.4 | Add `GET /api/v1/docs` endpoint (list bundled docs) | Done | Returns `[{path, title, category}]`. Delegates to `list_bundled_docs()`. |
| 20B.5 | Add `GET /api/v1/docs/{path:path}` endpoint (fetch bundled doc content) | Done | Returns `text/markdown` content; 404 on missing or path-traversal attempt. |
| 20B.6 | Add React route + page `/app/help` | Done | `HelpPage.tsx` with category-grouped Mantine `NavLink` sidebar and `<MarkdownViewer>` for content. Routes: `/help` (defaults to README) and `/help/*` (specific path). "Help" added to `Layout.tsx` top nav. |
| 20B.7 | Schema-version-mismatch banner in web UI | Done | `GET /api/v1/schema-version` returns `{bundled, deployed, mismatch}`. `<SchemaVersionBanner>` in `Layout.tsx` polls every 60s and renders only on mismatch. Graceful for legacy deployments missing the RPC (deployed=null → no banner). |
| 20B.8 | Add the `@version:` marker convention to `src/cerefox/db/schema.sql` and document it | Done | Header comment block in `schema.sql` includes `-- @version: 0.3.0` and a paragraph explaining when to bump. `cerefox_schema_version()` RPC at the bottom of `rpcs.sql` mirrors the value for the deployed side. |
| 20B.9 | Tests: `tests/test_docs_resources.py` and `tests/api/test_docs_endpoints.py` | Done | 23 tests in `test_docs_resources.py` (listing, reading, path-traversal guards, find_doc fuzzy-match) + 10 tests in `test_docs_endpoints.py` (both docs endpoints + four `/api/v1/schema-version` response shapes + the existing `/api/v1/version` regression). Plus 4 CLI tests in `test_cli.py::TestDocsCommand`. |

### 20C: Script migrations to TypeScript

`sync_docs` and `db_status` are touched in 20B (sync_docs gains bundled-docs
awareness; db_status gains the schema-version logic). Per §12f, scripts being
extended get ported instead of extended-in-Python. They become the **first
two members of `_shared/`** — the cross-context TS module that grows through
v0.4 (MCP server) → v0.5 (CLI) → v0.7 (ingestion).

| # | Task | Status | Notes |
|---|------|--------|-------|
| 20C.1 | Create `_shared/` directory at repo root with `package.json` | Done | `package.json` (name `@cerefox/_shared`, type module, private), `tsconfig.json` (strict, ESNext, bun-types). `_shared/README.md` documents the directory's purpose and future shape. `.gitignore` covers `_shared/node_modules` and `bun.lock`. |
| 20C.2 | Add `_shared/db-client/` — TS Supabase wrapper | Done | `createClient(settings)` factory; surface: `listProjects`, `rpc`, `tableExists`, `functionExists`, `rowCount`. Zod schemas for project rows. `functionExists` routes through the new `cerefox_pg_function_exists()` introspection RPC with a legacy-fallback empty-call probe. |
| 20C.3 | Add `_shared/db-status/` — reusable schema-introspection module | Done | `runDbStatusChecks(client, opts)` returns `{tables, functions, rowCounts, schemaVersion, allOk}`. `formatReport()` produces the human-readable output. Bundled-vs-deployed schema version compared via the `@version:` marker + `cerefox_schema_version()` RPC. |
| 20C.4 | Add `_shared/config/` — TS port of `paths.py` | Done | Mirrors the Python resolver 1:1: `resolveConfigDir`, `resolveEnvFile`, `userStateDir`, `isDevMode`. Plus `loadEnv()` (idempotent dotenv loader; existing `process.env` always wins) and `loadSettings()` (typed read of the v0.3.0 settings subset). |
| 20C.5 | Write `scripts/db_status.ts` (replaces `db_status.py`) | Done | Reads bundled `@version:` from `src/cerefox/db/schema.sql`; passes to `runDbStatusChecks`. `--json` flag emits structured output. Exit codes 0 / 1 / 2 (healthy / failures / config error). Smoke-tested against the maintainer's live Supabase. |
| 20C.6 | Write `scripts/sync_docs.ts` (replaces `sync_docs.py`) | Done | Discovers `README.md` + `AGENT_GUIDE.md` + `AGENT_QUICK_REFERENCE.md` + every `docs/**/*.md`. Delegates to the `cerefox-ingest` Edge Function via `fetch` — server-side embedding, no local OpenAI key needed. `--dry-run` and `--project` flags preserved from the Python version. |
| 20C.7 | Convert `scripts/db_status.py` and `scripts/sync_docs.py` to deprecation shims | Done | Each shim prints a ⚠ notice naming the TS replacement and the Bun install one-liner, then exits with code 2. Explicit failure (no silent forwarding) so migration is discoverable. Originally announced a v0.4.0 hard-removal date; **policy revised post-v0.3.0 — shims are kept indefinitely as a migration aid**. No scheduled removal; exit code stays non-zero so tooling that hasn't migrated keeps failing visibly. Verified `python scripts/sync_docs.py` and `python scripts/db_status.py` both print the notice and exit 2. |
| 20C.8 | Vitest test suite under `_shared/__tests__/` | Done | `paths.test.ts` covers all four resolver functions across 12 cases. Uses Bun's built-in `bun:test` runner (not Vitest — Bun's runner is API-compatible and is preferred per the design doc). All 14 tests pass under `bun test`. |
| 20C.9 | Parity test: `sync_docs.ts` lists the same files as the (now-deprecated) Python version | Done | `sync_docs.test.ts` snapshots the file-discovery logic (root-level docs + recursive `docs/**/*.md`) and asserts non-empty + presence of well-known files + exclusion of contributor-only files. |
| 20C.10 | Update `docs/guides/ops-scripts.md` | Done | New "Two languages, one directory" preamble with the TS/Python table; `db_status` and `sync_docs` sections rewritten for the TS form; new "TS scripts and `.env` resolution" subsection documents the precedence rule. |

### 20D: Cross-cutting — CONTRIBUTING, plan, decision log, cut_release.ts polish

| # | Task | Status | Notes |
|---|------|--------|-------|
| 20D.1 | Update `CONTRIBUTING.md` with the `_shared/` layout | Done | New "`_shared/` — cross-context TypeScript modules" subsection under Script-Language Policy with the directory layout, what each module is for, and where future `mcp-tools/` (v0.4) and `ingest/` (v0.7) modules will land. |
| 20D.2 | Polish `cut_release.ts` UX: clarify the "current == new" case | Done | When `currentVersion == newVersion`, prints a one-line explanation ("VERSION already at this value — pre-bumped, normal workflow leaves VERSION at the prior release"). The v0.2.0 wart is lifted; v0.3.0 onward sees the normal arrow form. |
| 20D.3 | Add "Release workflow" subsection to `CONTRIBUTING.md` | Done | Walks through the normal flow (PRs land without touching VERSION → cut_release.ts does the bump) and explicitly calls out v0.2.0 as the one-off pre-bumped release. Also re-iterates the force-move-tags rule. |
| 20D.4 | Update `.env.example` to mention `~/.cerefox/.env` as an option | Done | Header comment documents the full three-tier precedence (CEREFOX_CONFIG_DIR > ./.env > ~/.cerefox/.env) and notes that dev mode is the typical contributor flow. |
| 20D.5 | Update `README.md` "Getting Started" with the new install paths | Done | Project status roadmap table updated — v0.3.0 is now "this release" with the full feature list (~/.cerefox/, cerefox docs CLI, /app/help, schema-version banner, first TS script ports, _shared/ seeded). v0.2.0 dropped from "this release" to just shipped. The prereqs section + Node 20+ badge from the v0.2.0 fast-follow on main carry over. |
| 20D.6 | Decision Log entry | Done | Prepended to *Cerefox Decision Log — 2026 Q2 (Part 2)* via `cerefox_ingest` with `document_id` (deterministic update, preserves every prior entry verbatim). Covers Decision 1 (dev-mode-wins precedence + v1.0 revisit), Decision 2 (shims vs hard-delete vs silent-forward), Decision 3 (`_shared/` seed scope), and Lesson 1 (PostgREST 42883 → add introspection RPC). |
| 20D.7 | Mark all Iteration 20 tasks Done in plan.md | Done | This task. |
| 20D.8 | CHANGELOG `[Unreleased]` populated with v0.3.0 release notes | Done | Full notes under `## [Unreleased]` in `CHANGELOG.md` — `cut_release.ts` will promote them to `[v0.3.0]` on cut. Same convention as Iteration 19. |
| 20D.9 | Cut release v0.3.0 via `bun scripts/cut_release.ts 0.3.0` | Pending (post-merge) | Runs from `main` after the iter-20 PR merges. First true non-zero bump for the cut-release script (v0.2.0 was the pre-bumped dogfood case). |

**Total**: 30 sub-tasks across four parts (9 + 9 + 10 + 9 minus 8 [20D.7 is meta]).

**Tests / risk**: medium overall.

- **Highest-risk**: 20A's config resolver — wrong precedence breaks every existing dev install. Unit tests + a regression test that asserts the repo-root `.env` wins for the current dev environment cover this.
- **Medium-risk**: 20C's TS scripts replacing Python versions. The parity test (20C.9) catches divergence; manual smoke against a live Supabase confirms end-to-end behavior.
- **Lowest-risk**: 20B's docs surfacing (additive — adds endpoints + a page, doesn't change any existing surface) and 20D's cross-cutting docs / cut_release.ts polish.

**Deferred to later iterations** (not in v0.3.0):

- Porting `db_deploy.py`, `db_migrate.py`, `backup_create.py`, `backup_restore.py`, `reindex_all.py` to TS (§12f rule 3: stays Python until extended; deferred to v0.5 / v0.7 per the §12f migration table).
- **Hard-removal of the `sync_docs.py` / `db_status.py` deprecation shims** — **not scheduled** (policy revised post-v0.3.0; see 20C.7). The shims are kept indefinitely as a migration aid; their non-zero exit code keeps un-migrated tooling failing visibly. Revisit only if maintenance becomes a real burden.
- `cerefox init` and `cerefox configure-agent` (v0.5 — these are CLI commands, and the CLI itself moves to TS in v0.5).
- Layer 2 of MCP discoverability — `cerefox init` auto-ingests `AGENT_GUIDE.md` (v0.5; depends on `cerefox init` existing).
- Layer 3 — `cerefox_get_help` MCP tool (v0.4; ships with the TS MCP server).
- npm publishing — first publish is now scheduled for v0.4.0 as `@cerefox/memory` (containing the `cerefox-mcp` bin only); v0.5.0 adds the `cerefox` CLI bin to the same package. (Revised from the design doc's two-package plan; see iter-22 refinement #7.)
- **Reconsider `_resolve_config_dir()` precedence at v1.0** — see 20A "v1.0 revisit" note above.

---

## Iteration 21: SUPERSEDED — was Iteration 18

(Numbering bookkeeping: Iteration 18's content moved here for chronological consistency
with the v0.X.0 mapping. See Iteration 22 below for the actual content.)

---

## Iteration 22: v0.4.0 — "TS MCP Server" (first runtime component migrated)

**Goal**: Migrate the local `cerefox mcp` stdio MCP server from Python to TypeScript —
the first **runtime** component to move (scripts already ported earlier: `cut_release.ts`
in v0.2.0; `sync_docs.ts` + `db_status.ts` in v0.3.0). Shares tool handlers with the
existing `cerefox-mcp` Edge Function via a new `_shared/mcp-tools/` module. Publishes
`@cerefox/memory` (containing the `cerefox-mcp` bin) to npm.
**First npm publication for the Cerefox project.**

**Supersedes**: the original Iteration 18.

**Design**: [`docs/specs/polish-and-distribution-design.md` §4 + §10d + §13 v0.4.0](specs/polish-and-distribution-design.md).

**Estimated effort**: 3-4 weeks part-time.

### Release & publish — the OSS-relevant shape

**Publishes use npm OIDC trusted publishing**. The `.github/workflows/release.yml`
workflow (added in this iteration — see 22F.1) declares `permissions: id-token: write`
and runs `npm publish --access public --provenance` from `packages/memory/`.
Every published tarball ships with a sigstore-signed attestation linking it to
the exact GitHub Actions run that built it; the "Provenance" badge appears on
the package's npmjs.com page.

**The publish path is maintainer-only by design.** OIDC trust is bound to this
specific repo + workflow path (`fstamatelopoulos/cerefox` / `release.yml`);
contributors can propose changes via PR but can't trigger a publish. Releases
are cut by running `cut_release.ts` from `main` with the `--npm-publish` flag
(see 22F.2); the flag defaults to `false` so a bare `cut_release.ts X.Y.Z`
produces tag + GitHub Release without npm publishing — useful for staging.

First-publish bootstrap (single-maintainer ritual, day of v0.4.0 cut) is
intentionally not documented here. It's tracked in the maintainer's Cerefox
Decision Log alongside the equivalent cfcf playbook.

### Refinements vs. the design-doc bullets

A few small deviations from the v0.4.0 entry in
[`docs/specs/polish-and-distribution-design.md` §13](specs/polish-and-distribution-design.md),
shaped by what we learned in iter-19 / iter-20 / iter-21 and by reviewing
cfcf's existing npm-publish playbook (already ingested in Cerefox):

1. **Python `cerefox mcp` becomes a *soft* wrapper, not a hard shell-out.** The
   design says "shells out to `npx @cerefox/mcp-local`". A hard shell-out fails
   for users who installed Cerefox via `uv` but haven't installed npm / Bun.
   Instead, the Python `mcp` command **tries** the npx delegation; if the npm
   package isn't installed (or Bun/Node missing), it falls back to the legacy
   Python `mcp_server.py` with a one-line stderr notice nudging the user
   toward the npm install. No user surprise; no hard break of existing MCP
   client configs. Same pattern as the v0.3.0 deprecation-shim discussion —
   prefer graceful migration over silent forwarding **except when silent
   forwarding is the user-correct behavior** (here it is, because MCP clients
   are not humans — they don't read deprecation banners).
2. **`cerefox configure-agent` is deferred to v0.5.0.** The design doc lists
   updating it as a v0.4 task, but the command itself is scheduled for v0.5
   alongside the rest of the new lifecycle CLI commands. v0.4 ships
   `docs/guides/migration-v0.4.md` instead — a copy-pasteable cheat-sheet
   for Claude Code / Cursor / Claude Desktop config switches.
3. **`cerefox_get_help` content source: inline the whole AGENT_QUICK_REFERENCE.md.**
   The file is 73 lines — small enough to ship intact rather than curating
   subsets. The optional `topic` parameter filters by H2 heading
   (Tools / Essential Rules / Update Workflow / Catch-Up Workflow / CLI fallback).
   No-topic returns the full doc. Simpler, no curation drift.
4. **Set up the npm workspace at the repo root.** v0.3.0 left us with three
   uncoordinated `package.json`s: root (just `ora`), `_shared/`, `frontend/`.
   v0.4.0 promotes the root `package.json` to a proper npm workspace
   declaration with `_shared`, `packages/*`, and `frontend` as members.
   Bun hoists deps; cleaner imports; ready for the CLI's bin entry in v0.5.
5. **Schema-version-mismatch detection in the TS MCP server.** When the
   server starts, it calls `cerefox_schema_version()` once and compares to
   the version bundled with `@cerefox/memory`. On mismatch, prints a
   one-line stderr warning (doesn't refuse to serve — that'd break agents
   mid-session). Closes the v0.1.19 footgun for the MCP path the same way
   the web UI banner closed it for the web path.
6. **Don't print a deprecation banner for `mcp_server.py`.** It stays as
   a legitimate fallback for the foreseeable future (same indefinite-shim
   policy that emerged in v0.3.0). No "to be removed in v0.X.0" promises.
7. **One package, growing surface — `@cerefox/memory` from day one** instead
   of the design doc's two-package transition (`@cerefox/mcp-local` in v0.4
   → `@cerefox/memory` in v0.5 with "supersedes"). v0.4 publishes
   `@cerefox/memory@0.4.0` containing only a `cerefox-mcp` bin. v0.5 ships
   `@cerefox/memory@0.5.0` adding a `cerefox` CLI bin to the same package,
   same publish lineage. No rename, no orphaned npm package, no migration
   friction for early adopters. Mirrors cfcf's `@cerefox/codefactory` shape
   (one package, one-or-more bins).
8. **Decouple `npm publish` from `cut_release.ts`.** Tag-cutting and
   npm-publishing are two distinct confirmation surfaces — you sometimes
   want to ship a tag without immediately propagating to npm (to spot a
   problem in the staging window and roll a patch before the world sees it).
   v0.4 adds a `--npm-publish` flag (default `false`) to `cut_release.ts`.
   When set, the script triggers a GitHub Actions workflow via
   `gh workflow run` rather than calling `npm publish` directly. The
   workflow (`.github/workflows/release.yml`) is the auditable surface
   that actually publishes, with `--provenance` attestation and OIDC trust.

### Backward-compat invariant

Every existing MCP client config pointing at `uv run --directory … cerefox mcp`
keeps working unchanged, with the same stdio behavior. The transport doesn't
change; only what's at the other end of the pipe does.

### 22A: `_shared/mcp-tools/` — shared tool handlers

Extract the per-tool logic from `supabase/functions/cerefox-mcp/tools/*.ts`
into a runtime-neutral TS module that both the Edge Function (Deno) and the
new `@cerefox/memory` (Bun/Node) can import. The 8 existing tools become 9
with the addition of `cerefox_get_help`.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 22A.1 | Audit the 8 current MCP tool handlers in Python (`mcp_server.py`) vs TS (`supabase/functions/cerefox-mcp/tools/*.ts`) | Done | Audit folded into the extraction — diffs caught and resolved per-tool as `_shared/mcp-tools/*.ts` was authored. Conformance target: the EF response shapes (already TS, identical to what agents see today). Python handler kept in sync via 22E.2. |
| 22A.2 | Create `_shared/mcp-tools/` directory | Done | New subdirectory under `_shared/`. `index.ts` exports `ALL_TOOLS` + `TOOLS_BY_NAME`. |
| 22A.3 | Define `_shared/mcp-tools/types.ts` — common interfaces | Done | `ToolDefinition { name, description, inputSchema (JSON Schema object), handler(ctx, args) → string }`. Structural `MCPSupabaseClient` interface used in place of a concrete `SupabaseClient` import (avoids Bun-workspace duplicate-class issue, also keeps the Deno EF / Node MCP server runtime-neutral). |
| 22A.4 | Extract `search.ts`, `ingest.ts`, `get-document.ts`, `list-versions.ts`, `metadata.ts`, `metadata-search.ts`, `audit-log.ts`, `list-projects.ts`, `set-document-projects.ts` into `_shared/mcp-tools/` | Done | All 9 plus `get-help.ts` (added in 22B) live in `_shared/mcp-tools/`. Both the EF and `@cerefox/memory` import from the same source. |
| 22A.5 | Write `_shared/mcp-tools/index.ts` with `ALL_TOOLS: ToolDefinition[]` | Done | Single export consumed by both runtimes. Adding a tool is one line. |
| 22A.6 | Expand `_shared/db-client/` to cover every operation MCP tools need | Done | Generic `rpc<T>()` + table helpers cover all 10 tools without per-tool method bloat. Each tool calls `client.rpc("cerefox_*", {...})` directly. |
| 22A.7 | Vitest unit tests per tool handler in `_shared/__tests__/mcp-tools/*.test.ts` | Done | Bun-test suites under `_shared/__tests__/mcp-tools/` mock the `MCPSupabaseClient` and assert the handler calls the right RPC with the right args and formats the response correctly. Help-bundle, parity, and tool-list checks all green. |
| 22A.8 | Run the EF e2e suite to confirm extraction didn't regress the cloud path | Done (2026-05-27) | `uv run pytest -m e2e` against the deployed v0.4.0 EF — 83 passed, 0 failed (123s). Two test updates landed in the same run: bumped expected tool count 9→10 (added `cerefox_get_help`) and switched expected JSON-RPC error code from `-32603` to `-32602` (the refactor tightened input-validation errors to the spec-correct `Invalid params` code). Both shape changes are intentional improvements; tests updated to match. |

### 22B: `cerefox_get_help` — Layer 3 of MCP discoverability

Implements the new MCP tool that surfaces `AGENT_QUICK_REFERENCE.md` content
to remote / hosted-MCP / Edge-Function-only agents. Per design doc §10d.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 22B.1 | Bundle `AGENT_QUICK_REFERENCE.md` into `_shared/mcp-tools/` at build time | Done | `scripts/bundle_help.ts` reads the canonical file and emits `_shared/mcp-tools/get-help-content.ts` (a TS module with `HELP_CONTENT_FULL` + `HELP_SECTIONS`). Single source of truth: edit the MD, rerun the bundle. |
| 22B.2 | Implement `_shared/mcp-tools/get-help.ts` | Done | `cerefox_get_help(topic?: string)` returns full markdown + an `## Available topics` index by default; with a topic, does a case-insensitive substring match on H2 headings. Unknown topic → "no match" message + topic list. |
| 22B.3 | CI check that the bundled content is in sync with the repo source | Done | `scripts/check_help_bundle.ts` regenerates the bundle in memory and diffs against the on-disk file. Fails fast if someone edited the MD without rerunning `bundle_help.ts`. |
| 22B.4 | Register the new tool in `ALL_TOOLS` (both EF and local TS) | Done | Tool count is now 10. Both `cerefox-mcp` (EF) and `@cerefox/memory` (local) expose it via the shared `ALL_TOOLS`. |
| 22B.5 | Update `CLAUDE.md` MCP tool count + `AGENT_QUICK_REFERENCE.md` self-reference | Done | `AGENT_QUICK_REFERENCE.md` now lists 10 tools (added the `cerefox_get_help` row) and the intro notes the tool's MCP-only nature. `CLAUDE.md` references the shared `_shared/mcp-tools/` architecture. `AGENT_GUIDE.md` gained a "Self-help via MCP" subsection + a dedicated tool entry. |

### 22C: `packages/memory/` — new TS stdio MCP server (`@cerefox/memory`)

The new TS package that replaces (transparently, via the soft wrapper) the
Python `mcp_server.py`. Published as `@cerefox/memory` on npm — in v0.4.0
it contains only the `cerefox-mcp` bin; v0.5.0 adds the `cerefox` CLI bin to
the same package.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 22C.1 | Set up repo-root npm workspace | Done | Root `package.json` declares `"workspaces": ["_shared", "packages/*", "frontend"]`. Bun honours it. |
| 22C.2 | Create `packages/memory/` with package.json + tsconfig.json | Done | `name: "@cerefox/memory"`, `version: "0.4.0"` (kept in lockstep with VERSION), `bin: { "cerefox-mcp": "./dist/bin/cerefox-mcp.js" }`. ESM only. `engines: { node: ">=20", bun: ">=1.0.0" }`. `publishConfig: { access: "public", provenance: true }`. |
| 22C.3 | Write `packages/memory/src/server.ts` — the stdio MCP server | Done | `buildServer()` factory wires `ALL_TOOLS` into a `@modelcontextprotocol/sdk` `Server` with stdio transport. Server identity: `{ name: "cerefox", version: "0.4.0" }`. |
| 22C.4 | Write `packages/memory/src/bin/cerefox-mcp.ts` — entry-point shebang | Done | `#!/usr/bin/env node` with `--version` / `--help` short-circuits. Loads env via `_shared/config/`, calls `buildServer()`, starts the stdio loop. |
| 22C.5 | Add the startup schema-version check | Done | `warnIfSchemaVersionMismatch()` runs once on boot, calls `cerefox_schema_version()`, prints a one-line stderr warning on mismatch — never refuses to serve. |
| 22C.6 | Build config: `bun build` to produce ESM in `packages/memory/dist/` | Done | `bun build src/bin/cerefox-mcp.ts --outdir dist/bin --target node --format esm` produces a single ESM bundle. Shebang preserved from the source file (avoided the `--banner` flag after it caused duplicate-shebang SyntaxError). |
| 22C.7 | Manual smoke test: `node ./packages/memory/dist/bin/cerefox-mcp.js` exposes the 10 MCP tools over stdio | Done | Verified manually by spawning the bin and walking initialize → tools/list. Reports 10 tools. |
| 22C.8 | Bun-test integration that boots the stdio server, sends a `tools/list` request, and asserts the 10 tools come back | Done | `packages/memory/test/stdio-smoke.test.ts` spawns the built bin and asserts the full handshake plus the exact 10-tool name set. |

### 22D: Edge Function refactor

**Why it's needed**: today the `cerefox-mcp` Edge Function has its own
self-contained tool handlers (`supabase/functions/cerefox-mcp/tools/*.ts`).
The whole point of v0.4 is **one source of truth for tool behavior** — both
the new local TS MCP server (Bun/Node) and the existing remote EF (Deno)
import from `_shared/mcp-tools/`. Leaving the EF unchanged would mean two
copies of every handler drifting slowly apart — exactly the language-fit
problem the polish design doc §4 calls out as a primary motivation for the
migration arc. The refactor moves the handler code into `_shared/mcp-tools/`,
then changes the EF's `index.ts` to import from there. Zero behavior change
for callers; one source of truth thereafter.

**Cross-runtime context (terminology refresher)**:

- **Deno** is the JavaScript / TypeScript runtime that powers Supabase Edge
  Functions. Same family as Node.js; built by Node's original creator with a
  different design (more secure default, no `node_modules`, native TS).
- **Bun / Node** are the runtimes that the new local `@cerefox/memory` MCP
  server runs on (Bun preferred per the polish-design-doc §5b; Node 20+ as
  fallback).
- **ESM** = ECMAScript Modules — the standard JS module format (`import` /
  `export` statements). Both Deno and modern Node default to ESM.

**Why writing one module that runs on both is possible**: modern Supabase
Edge Functions support npm-style imports via the `npm:` specifier prefix.
So `_shared/mcp-tools/search.ts` can `import { z } from "zod"` (vanilla
npm-package name), and:

- The Bun/Node consumer (the new local TS MCP server) resolves it via
  `node_modules/` from the npm workspace.
- The Deno consumer (Supabase Edge Function) resolves it via the platform's
  `npm:zod@^3.23` compatibility layer at deploy time.

Same TS source, no conditional imports, no per-runtime ifdefs.

**Risk**: this is the highest-risk slice of v0.4 because the EF is in
production use today. Tasks 22A.8 (full e2e gauntlet) and 22D.4 (byte-level
response-shape parity test) are the safety net.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 22D.1 | Update `supabase/functions/cerefox-mcp/index.ts` to import `ALL_TOOLS` from `_shared/mcp-tools/` | Done | Refactored EF imports `ALL_TOOLS` from `_shared/mcp-tools/`. SERVER_VERSION bumped to `0.4.0`. Identity-enforcement wrapper preserved; `cerefox_set_document_projects` added to the author-check list. |
| 22D.2 | Delete the now-redundant `supabase/functions/cerefox-mcp/tools/*.ts` files | Done | Nine per-tool files and `embeddings.ts` deleted; `shared.ts` trimmed to `makeSupabaseClient`, response helpers, and CORS headers only. |
| 22D.3 | Deploy the refactored EF | Done (2026-05-27) | `npx supabase functions deploy cerefox-mcp` deployed cleanly on the v0.4.0 cut day after a one-shot fix: Deno's bundler resolves relative imports literally (no `.js`→`.ts` remap like Bun does), so the `.js` extensions in `_shared/mcp-tools/` imports failed with `Module not found`. Fix shipped on the same branch (commit `ed403fa`): converted all `.js` relative imports to `.ts` across `_shared/mcp-tools/`. `bun scripts/check_ef_parity.ts` now reports "EF parity OK (10 tools, all input schemas match)" against the deployed function. |
| 22D.4 | Verify response-shape parity with the pre-refactor EF | Done (programmatic equivalent) | The `_shared/mcp-tools/*.ts` handlers ARE the EF body — the refactor extracts the same code, doesn't rewrite it. Parity is enforced by (a) `scripts/check_ef_parity.ts` (CI-runnable) and (b) the `_shared/__tests__/mcp-tools/` snapshot/unit tests that already lock the response shapes per tool. Live byte-snapshot is captured opportunistically when the maintainer runs the e2e gauntlet post-deploy (22A.8). |

### 22E: Python `cerefox mcp` soft wrapper

The Python CLI keeps the `mcp` subcommand but the behavior changes: try the
npm package first, fall back to the legacy Python impl. No breaking change for
users.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 22E.1 | Refactor `src/cerefox/cli.py mcp` command | Done | `_run_mcp()` probes with `npx --no-install @cerefox/memory --version` first. Success → `os.execvp` hands stdio off to the npm bin. Failure (npx missing or probe non-zero) → falls back to `cerefox.mcp_server.run()` with a stderr nudge. Probe uses `--no-install` to avoid hitting the npm registry on every MCP server start. |
| 22E.2 | Update `src/cerefox/mcp_server.py` with `cerefox_get_help` so the legacy fallback exposes 10 tools too | Done | `_handle_get_help()` reads `AGENT_QUICK_REFERENCE.md` via `cerefox.docs_resources` and returns the same surface as the TS handler: full content + index when no topic, H2 substring match when given a topic. Best-effort `log_usage` records `access_path = "local-mcp"`. |
| 22E.3 | Unit tests for the soft-wrapper logic | Done | `tests/test_mcp_soft_wrapper.py` covers the three soft-wrapper paths (npx + package present → execvp; npx missing → fallback; package not installed → fallback) and verifies the `--no-install` probe flag. Plus 5 tests pinning the Python `cerefox_get_help` behaviour (full, topic match, unknown topic, log_usage path, log_usage failure-tolerant). |

### 22F: Publishing — `@cerefox/memory` to npm

**Package**: `@cerefox/memory`. v0.4.0 contains only the `cerefox-mcp` bin;
v0.5.0 adds the `cerefox` CLI bin to the same package (same publish lineage).
One install, growing surface. Mirrors cfcf's `@cerefox/codefactory` shape.

**Workflow**: `.github/workflows/release.yml` (added in 22F.1) declares
`permissions: id-token: write` and runs `npm publish --access public
--provenance` from `packages/memory/`. Triggered via `workflow_dispatch`
with a `publish_to_npm` boolean input.

**`cut_release.ts --npm-publish` flag** (default `false`). When set, the
cut script triggers the workflow via `gh workflow run` after the tag is
pushed. Two confirmation layers — the flag on the cut + the
`workflow_dispatch` input — let the maintainer cut a tag without
immediately propagating to npm (useful for staging or for the
spot-a-problem-post-tag case).

| Flag | Behavior |
|---|---|
| `bun scripts/cut_release.ts 0.4.0` (default) | Cut tag + GitHub Release only. npm publish requires a separate `gh workflow run release.yml -f publish_to_npm=true`. |
| `bun scripts/cut_release.ts 0.4.0 --npm-publish` | Cut tag + GitHub Release + trigger the workflow with `publish_to_npm=true`. |
| `bun scripts/cut_release.ts 0.4.0 --dry-run` | Same as before — preview only. |

| # | Task | Status | Notes |
|---|------|--------|-------|
| 22F.1 | Write `.github/workflows/release.yml` | Done | Manual `workflow_dispatch` with `tag` + `publish_to_npm` inputs. Permissions `contents: read, id-token: write` for OIDC. Job 1 (always): checkout the tag, install npm@latest (≥11.5.1 for trusted publishing), install deps, run Bun tests, build the bin, verify it runs. Job 2 (gated on `inputs.publish_to_npm`): `npm publish --access public --provenance` from `packages/memory/`. `NODE_AUTH_TOKEN` path kept for the v0.4.0 bootstrap window; OIDC takes over for v0.4.1+. |
| 22F.2 | Extend `scripts/cut_release.ts` with `--npm-publish` flag (default `false`) | Done | When set, after tagging and pushing, the script runs `gh workflow run release.yml -f tag=vX.Y.Z -f publish_to_npm=true`. Default off — a bare `cut_release.ts X.Y.Z` is publish-free. |
| 22F.3 | First publish: `@cerefox/memory@0.4.0` | Done (2026-05-27) | Bootstrap token publish succeeded. The published v0.4.0 turned out to ship without a usable bin field (npm ≥ 11.5 silently strips bin paths with `./` prefix); fix shipped as v0.4.2 (first working npm release). v0.4.0 has been deprecated on npm with a pointer to v0.4.2+. OIDC trusted publisher registered after the first publish; v0.4.2 and v0.4.3 both publish-attested via OIDC. Full first-publish saga captured in Cerefox Decision Log Q2 Part 3 (2026-05-27 entry). |
| 22F.4 | Document the install one-liner | Done | `npx -y @cerefox/memory cerefox-mcp` (or `npm i -g @cerefox/memory && cerefox-mcp`) is the primary recipe in `docs/guides/migration-v0.4.md` + `docs/guides/connect-agents.md` (Path A-Local). CHANGELOG entry calls it out for upgraders. |

### 22G: Documentation + cross-cutting

**Documentation coverage matrix** — the two user populations get different
paths in v0.4.0:

| User population | What they read | What they do |
|---|---|---|
| **Existing user** (already has `uv run cerefox mcp` configured in their MCP client today) | `docs/guides/migration-v0.4.md` — "before / after" config snippets per MCP client, clear callout that **existing configs keep working unchanged** via the soft wrapper. | Optional: switch their `.mcp.json` to invoke `npx @cerefox/memory cerefox-mcp` directly (recommended) at their leisure. No urgency; soft wrapper carries them. |
| **New user** (no Cerefox MCP config yet) | Updated `docs/guides/connect-agents.md` — the new npm path is the primary "Local stdio MCP" recipe; `uv run cerefox mcp` becomes the legacy fallback. | Copy-paste the snippet for their client. v0.5.0 ships `cerefox configure-agent` (TS CLI) which automates this — but for v0.4.0 it's still manual copy-paste. |

The soft wrapper (22E) + the migration doc together mean **no existing user
has to do anything urgent at the v0.4.0 cut**. The npm-direct path is a
performance + freshness upgrade they can take when convenient.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 22G.1 | Write `docs/guides/migration-v0.4.md` for **existing users** | Done | Top-level "nothing breaks" callout; before/after snippets per client (Claude Code, Cursor, Claude Desktop, Codex CLI). Links to the soft-wrapper rationale. |
| 22G.2 | Update `docs/guides/connect-agents.md` for **new users** | Done | Path A-Local rewritten around `npx -y @cerefox/memory cerefox-mcp` as the recommended config, with `uv run cerefox mcp` preserved as an alternative. Tool count 8 → 10. Verification prompts updated. New rows added for `cerefox_set_document_projects` and `cerefox_get_help`. |
| 22G.3 | Update `AGENT_GUIDE.md` + `AGENT_QUICK_REFERENCE.md` to document `cerefox_get_help` | Done | New "Self-help via MCP" subsection in `AGENT_GUIDE.md` + a dedicated tool entry. `AGENT_QUICK_REFERENCE.md` now lists 10 tools (added the `cerefox_get_help` row) and intro notes "10 MCP tools (9 of them have CLI equivalents — `cerefox_get_help` is MCP-only)". |
| 22G.4 | Update `CLAUDE.md` Edge Function inventory + tool count | Done | Single-Implementation-Principle item 4 rewritten to reference `_shared/mcp-tools/*.ts` (one source feeding both the EF and `@cerefox/memory`). Edge Function inventory row for `cerefox-mcp` updated. Tech Stack + Project Structure expanded with the `_shared/`, `packages/memory/`, and `supabase/functions/` layout. New TS-test rows in the Test Suites table. |
| 22G.5 | Update `CONTRIBUTING.md` with the npm-workspace layout | Done | "Development Setup" callout flags the v0.4.0 npm-package end-user path. Added "TS unit tests" + "MCP stdio smoke" rows to the test commands. New `packages/memory/` subsection under "_shared/" describing the package layout, build, and publish flow. |
| 22G.6 | Update `docs/guides/setup-supabase.md` to mention the OIDC trust setup | Skipped | Doesn't fit thematically — `setup-supabase.md` covers Supabase deployment; npm OIDC is a publisher concern. Covered in `CONTRIBUTING.md` § "Release workflow" + the `release.yml` header comment. |
| 22G.7 | Decision Log entry: "v0.4.0 — closing decisions from the iter-22 build" | Done | Ingested as a new "Cerefox Decision Log — 2026 Q2 (Part 3)" document (id `a27d97e5-a0b6-45b6-84a1-ab1cf21039fc`). Captures the soft-wrapper rationale, the one-package pivot, the `--npm-publish` default-off, the `cerefox_get_help` whole-file inlining choice, the Bun-workspace structural-typing workaround, and the byte-snapshot-vs-programmatic-parity tradeoff on the EF refactor. The Q2 Part 2 bootstrap-ritual entry (separate, 2026-05-26) covers the npm publish ops side. |
| 22G.8 | CHANGELOG `[Unreleased]` populated with v0.4.0 notes | Done | Top-level callout about the soft wrapper + migration guide link. Sections: Added (10 sub-bullets), Changed (5 sub-bullets), Migration notes. `cut_release.ts` will promote `[Unreleased]` to `[v0.4.0]` on cut. |
| 22G.9 | Mark all Iteration 22 tasks Done | Done | This row. |
| 22G.10 | Cut release v0.4.0 via `bun scripts/cut_release.ts 0.4.0 --npm-publish` | Done (2026-05-27) | First-ever npm publication for Cerefox shipped on 2026-05-27. Three patch versions followed in the same evening to close gotchas (v0.4.1 deleted after a publish failure; v0.4.2 first working release; v0.4.3 fixed the hardcoded version-literal sync in `cut_release.ts`). Current `latest` is v0.4.3, published via OIDC trusted publishing with sigstore provenance. See Cerefox Decision Log Q2 Part 3 (2026-05-27 "first publish gauntlet" entry) for the full retrospective. |

**Total**: 42 sub-tasks across 7 parts. (Plus a maintainer-side bootstrap ritual at v0.4.0 cut time that intentionally lives in the maintainer's private Decision Log, not here.)

**Tests / risk**: medium-high overall.

- **Highest-risk**: 22D (EF refactor) — the existing `cerefox-mcp` EF is in production use; refactoring it to import from `_shared/` could regress response shapes. The pre/post snapshot test (22D.4) + the full e2e run (22A.8) are the safety net.
- **Medium-risk**: 22A.4 (per-tool extraction) — the response formatters currently inline in the EF's `index.ts` move to per-tool modules; risk is subtle drift. Mitigated by ~45 unit tests + the parity test against the Python `mcp_server.py` text format.
- **Medium-risk**: 22F (first npm publish) — getting the package metadata right (bin entry, ESM only, engines field, README), and authenticating to the org. Mitigated by `--dry-run` flag on `cut_release.ts` + a manual smoke test before the cut.
- **Lower-risk**: 22B (`cerefox_get_help`) — additive, no existing behavior changes. 22E (soft wrapper) — small change to one Click command; tests mock the subprocess probe.

**Deferred to later iterations** (not in v0.4.0):

- **`cerefox configure-agent`** — v0.5.0 (depends on the TS CLI existing). v0.4 ships the migration guide instead.
- **`cerefox init` auto-self-doc-ingest** (Layer 2 of MCP discoverability) — v0.5.0.
- **`cerefox sync-self-docs`** — v0.5.0.
- **Hard-removal of `mcp_server.py`** — **not scheduled** (same indefinite-shim policy that emerged in v0.3.0). The Python fallback stays so users without npm/Bun keep working.
- **Refusing zero-chunk creates at `cerefox_ingest_document`** — surfaced as a latent bug while purging the v0.3.0 orphan doc. Small RPC fix; candidate for v0.4 IF time permits, otherwise v0.5. Tracked as candidate item; not in the 22A-G core scope.
- **`scripts/db_deploy.py` / `db_migrate.py` ports** — v0.5 / v0.7 per §12f migration table.

---

## Iteration 23: v0.5.0 — "TS CLI" (the CLI itself moves to TS)

**Goal**: Migrate the CLI from Python/Click to TS/commander. Ship `@cerefox/memory` to npm
with both `cerefox` and `cerefox-mcp` bins. Python CLI deprecated but functional. New
lifecycle commands (`init`, `doctor`, `self-update`, `configure-agent`, `sync-self-docs`)
land. Self-docs ingestion (Layer 2 of MCP discoverability) ships.

**Design**: [`docs/specs/polish-and-distribution-design.md` §13 v0.5.0](specs/polish-and-distribution-design.md),
plus §3 (target UX), §6 (distribution), §8 (CLI polish), §10d (MCP discoverability layers).

**Estimated effort**: 4-6 weeks part-time. **Largest single migration in the polish arc**;
broadest user-facing surface; first iteration where the npm install path becomes the
primary recommendation for new users.

### Refinements vs. the design-doc bullets

A few small deviations from the v0.5.0 entry in
[`docs/specs/polish-and-distribution-design.md` §13](specs/polish-and-distribution-design.md),
shaped by what we learned shipping iter-22:

1. **`cerefox web` stays Python-only for v0.5.** The TS web server is a v0.6 deliverable.
   For v0.5, `cerefox web` (npm-installed) prints a clear "not yet — install uv + clone the
   repo, or wait for v0.6" message. The alternative (shelling out to a Python subprocess
   from the npm CLI) would re-introduce the Python prerequisite that the npm install was
   supposed to eliminate, which defeats the whole point of v0.5. Documented in
   `docs/guides/migration-v0.5.md`.
2. **`cerefox ingest` / `ingest-dir` / `reindex` go through the `cerefox-ingest` Edge
   Function**, not the Python ingestion pipeline. v0.7 is when the TS ingestion pipeline
   lands; for v0.5 the EF is the canonical write path (already used by `sync_docs.ts`
   from iter-20). Same path GPT Actions use today. Single hop, no Python dep.
   `reindex` is **deferred to v0.7** because re-embedding existing chunks needs server-side
   logic that doesn't yet exist as an EF (it's currently in the Python pipeline). The TS
   `reindex` becomes a thin client over the new `cerefox-reindex` EF added in v0.7.
3. **`backup` / `restore` get ported in v0.5**, not deferred. They're pure JSON-snapshot
   operations against the Data API; mechanical port; users want CLI completeness.
4. **`cerefox mcp` (subcommand of the new TS CLI) calls `buildServer()` in-process**, not
   `os.execvp`. Same code path as the standalone `cerefox-mcp` bin. The two bins share
   the server factory; no subprocess hop.
5. **Use `commander` (not `oclif`).** oclif is "framework-y" (plugins, topics, command
   discovery via filesystem) — overkill for a 23-command CLI with no third-party plugin
   ambitions. commander is ~10KB, has typed argument parsing, supports tab completion
   via a one-line export, and matches the cfcf reference. Decision is reversible if oclif
   becomes attractive later.
6. **Tab completion via `commander-completer` (or hand-rolled).** commander itself doesn't
   ship completion out of the box; we generate scripts for bash/zsh/fish either via a
   small helper library or ~50 lines of TS that walk the command tree. Hand-rolled is fine
   for our surface.
7. **Self-doc ingest is its own Part (G), not folded into `init`.** Both `init` and
   `self-update` call into it. Separating cleanly lets the same logic feed both.
8. **First-publish gauntlet pre-flight checks** (from Decision Log Q2 Part 3) baked into
   the v0.5 release procedure: `git grep -F "<old-version>" packages/` after cut,
   `npm pack --dry-run` warning grep, post-publish 3-way verification (registry HEAD +
   bin field + npx run). Documented inline in 23J.
9. **The Python deprecation banner is gentle for v0.5.** Single-line ⚠ notice on every
   Python `cerefox` invocation with a link to the migration guide. The Python CLI keeps
   working with zero behavior change; removal lands in v0.8 / v0.9 per the strangler-fig
   plan.
10. **Web UI `/app/about` ships in v0.5; `/app/settings` deferred to v0.5.x or v0.6.**
    `/app/about` is small (~30 LOC; version + build SHA + doc count). Settings UI is a
    bigger design surface (which knobs? where do they persist? what's the per-knob UX?)
    that benefits from being scoped separately rather than rushed in.

### Backward-compat invariant

Every existing Python CLI invocation keeps working. The TS CLI is a parity port at the
user-facing layer — same command names, same flag names, same env vars, same exit codes,
same output formats. We add new commands and new flags; we don't remove or rename
existing ones. The Python CLI shims a deprecation banner but otherwise behaves identically
to v0.4.x. Both CLIs coexist for the entire v0.5–v0.7 arc; removal of Python is v0.8/v0.9.

### Risk surface

This iteration is **~3x the size of iter-22** by lines-touched and user-surface affected.
Major risk vectors:

- **Parity drift**: 17 existing CLI commands × many flags each. Easy to silently miss a
  flag or change an output format. Mitigation: per-command parity test that runs the
  Python and TS versions side-by-side against the same inputs and diffs outputs.
- **Ingestion path via Edge Function**: introduces a hard dependency on `cerefox-ingest`
  being deployed and reachable. Today the Python CLI can talk straight to the DB;
  npm-installed users lose that fallback. Mitigation: `cerefox doctor` checks EF
  reachability explicitly; clear error if EF down.
- **Auto-install dance in `cerefox self-update`**: detecting bun vs npm vs yarn vs pnpm
  and wrapping each one. Tested on each runtime. Mitigation: opaque error if detection
  fails; print the manual `<runtime> install -g @cerefox/memory` command for the user
  to run themselves.
- **`configure-agent`'s per-client config writers**: each agent (Claude Code, Claude
  Desktop, Cursor, Codex, Gemini) has a different config file location and format.
  Backup-before-merge required; never replace wholesale. Tested with golden files per
  client. **Phase 1 = Claude Code + Claude Desktop only**; Cursor + Codex + Gemini
  ship later in v0.5.x.

### Decisions taken before execution (2026-05-27 plan review)

1. **Single PR target.** All ~60 sub-tasks land on `feat/v0.5.0-ts-cli` as a stream of
   phased commits, opened as a single PR for review. Same shape as iter-22.
2. **`cerefox web` UX**: simplest possible — print a "use `uv run cerefox web` from a
   clone for now; native TS server lands in v0.6" message and exit 0. No subprocess
   detection, no Python prereq inheritance. The v0.5→v0.6 gap is intentionally short
   (days, not weeks).
3. **`reindex` deferred to v0.7** — confirmed. Same explicit-message pattern as `web`.
4. **`cerefox init` ships both modes**: interactive (primary) + `--config <file>.json`
   (convenience for CI / scripted setup). Same validation pipeline.
5. **install.sh: Bun-first with npm fallback** — confirmed.
6. **`cerefox upgrade` is a first-class alias** for `cerefox self-update` (both
   documented as equivalent in `--help` and in the docs). Removes the "homebrew muscle
   memory" friction.
7. **NEW: `packages/memory/README.md`** — npmjs.com warns about packages without a
   README. Ships in v0.5; light overview + link back to the repo. Refreshed each
   release. Tracked as **23I.10**.
8. **Test coverage**: more aggressive than iter-22. Build tests per command as the
   implementation lands. Maintain a manual test plan doc at
   `docs/research/v0.5-manual-test-plan.md` covering happy paths, error paths, and
   the clean-macOS-install scenario. Tracked as **23J.7**.
9. **`configure-agent` Phase 1** = Claude Code + Claude Desktop only. Cursor, Codex,
   Gemini ship later in v0.5.x or v0.6. Confirmed.
10. **`/app/settings` deferred to v0.5.x or v0.6**. Confirmed (bigger design surface,
    benefits from its own scoping).

### Iteration shape — 10 parts, ~50 sub-tasks

- **23A**: TS CLI scaffolding inside `packages/memory/`
- **23B**: Read commands ported (8 commands)
- **23C**: Write commands ported (3 commands) + ingestion via EF
- **23D**: Server + ops commands (mcp, web, backup, restore, docs, sync-docs)
- **23E**: New lifecycle commands (init, doctor, status, self-update, configure-agent)
- **23F**: Self-doc ingest (Layer 2 of MCP discoverability) — sync-self-docs + wiring
- **23G**: CLI polish (tab completion, --json, exit codes, error messages, bare-cerefox)
- **23H**: Python CLI deprecation banner + soft-wrapper review
- **23I**: install.sh + docs (migration-v0.5.md, installing.md, connect-agents.md, README)
- **23J**: Documentation + Decision Log + CHANGELOG + plan markup + release

### 23A: TS CLI scaffolding

The CLI bin entry, command framework, and shared infrastructure that every other
command will hang off. Same `packages/memory/` package as v0.4 — the v0.4 MCP server's
`buildServer()` factory becomes one of many imports.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23A.1 | Add `commander` + `picocolors` + `prompts` + `cli-progress` to `packages/memory/package.json` | Done | Plus `@types/prompts` and `@types/cli-progress` as devDeps. Bundle stays under 2MB target (current: cerefox.js 1.22 MB, cerefox-mcp.js 0.99 MB). |
| 23A.2 | Create `packages/memory/src/bin/cerefox.ts` — bin shebang + commander dispatch | Done | Top-level handler catches `CliError` for typed exit codes (0/1/2/3); generic `Error` → exit 2. Lazy import pattern used by `mcp` command (and to be used by `init`/`doctor` once they land). |
| 23A.3 | Add `"cerefox": "dist/bin/cerefox.js"` to package.json `bin` block | Done | Sibling of `cerefox-mcp`. Both ship from one npm package. |
| 23A.4 | Update `prepublishOnly` build to produce both bin bundles | Done | `bun build src/bin/cerefox-mcp.ts src/bin/cerefox.ts --outdir dist/bin --target node --format esm`. Shebangs preserved in both. Also added `build:mcp` / `build:cli` scripts for partial builds during development. |
| 23A.5 | Create `_shared/cli-core/` — runtime-neutral helpers | Done | 4 modules: `exit.ts` (`CliError` + `userError`/`systemError`/`notFound`), `output.ts` (`printJson`/`printTable`/`info`/`warn`/`ok`/`errorln` + TTY-gated picocolors), `argv.ts` (identity resolution + JSON/numeric parsers), `prompts.ts` (Ctrl-C-safe interactive wrappers + reusable validators). Index module re-exports everything. **20 new unit tests** under `_shared/__tests__/cli_core.test.ts` cover the exit-code / identity / parsing helpers. |
| 23A.6 | `commander` config: command grouping, subcommand registration pattern | Done | One file per command under `packages/memory/src/cli/commands/`. Each exports a `register*(program)` function that adds the command with its flags + action. `packages/memory/src/cli/program.ts` aggregates all 25 registrations. Adding a command is one file + one import line. **Help-text grouping (READS / WRITES / SERVERS / LIFECYCLE / OPS) deferred to Part 23G** (commander supports `addHelpText` but the prettier output benefits from being scoped with the rest of the polish work). |
| 23A.7 | Wire exit-code handling into commander | Done | `program.exitOverride()` differentiates: `commander.helpDisplayed` / `commander.version` → exit 0; everything else → exit 1 (user error: unknown command, missing arg, bad flag). Action throws of `CliError` exit with the carried code; bare `Error` → 2. Verified by smoke test cases for each code. |
| 23A.8 | `cerefox --version` and `cerefox --help` smoke test | Done | `packages/memory/test/cli-smoke.test.ts` — 7 tests: bin exists, `--version` returns semver + exit 0, `--help` lists all 25 expected subcommands + exit 0, unknown subcommand → exit 1, stub command (`search`) → exit 2 with plan-pointer hint, `cerefox web` → v0.6 message + exit 0, `cerefox reindex` → v0.7 message + exit 0. **Plus**: stdio smoke test's stale `0.4.0` literal assertion replaced with `/^\d+\.\d+\.\d+/` so it survives future cuts without manual update. |

### 23B: Read commands ported

The 8 read-side commands. All gain `--json` mode and consistent `--requestor` plumbing.
Each command's parity is verified against the Python output for a fixed set of inputs.

Common parity-test infrastructure (per command):
- Set up a fixed test DB state via fixtures.
- Run `uv run cerefox <cmd> <flags>` → capture stdout.
- Run `node ./packages/memory/dist/bin/cerefox.js <cmd> <flags>` → capture stdout.
- Assert byte-identical for the default output mode and structurally-equivalent JSON for
  `--json` mode (Python emits JSON via the same `--json` flag where supported).

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23B.1 | Port `cerefox search` | Done | Embeds the query client-side via `_shared/embeddings/getEmbedding()` (same path as MCP `cerefox_search`); calls `cerefox_search_docs` / `cerefox_hybrid_search` / `cerefox_fts_search` based on `--mode`. All flags ported: `--match-count`, `--project-name`, `--metadata-filter`, `--mode`, `--alpha`, `--min-score`, `--max-bytes`, `--requestor`, `--json`. **Refinement vs original plan**: direct RPC, not the EF — keeps the CLI's "talk to the DB directly" identity consistent with the rest of the commands, and matches the Python CLI's pattern. The EF path stays available for GPT Actions etc. |
| 23B.2 | Port `cerefox get-doc <document-id>` | Done | Calls `cerefox_get_document(p_document_id, p_version_id)` via the Data API. Maps RPC empty-result to exit 3 (not found). Human-readable output matches the Python CLI's `# Title` / dim metadata line / blank / content layout. |
| 23B.3 | Port `cerefox list-docs` | Done | Direct PostgREST query against `cerefox_documents` (filters out `deleted_at IS NULL`, orders by `updated_at` desc). `--project` resolves project name → ID then filters via the `cerefox_document_projects` junction. **Caught and fixed during build**: `metadata` is the actual column name (not `doc_metadata` — my initial type was wrong). |
| 23B.4 | Port `cerefox list-versions <document-id>` | Done | Calls `cerefox_list_document_versions(p_document_id)`. Distinguishes "doc has no versions yet" (empty result, doc exists) from "doc not found" (empty result, doc missing) — falls back to a `cerefox_documents.id` lookup in the empty case and raises exit 3 if the doc is genuinely missing. |
| 23B.5 | Port `cerefox list-projects` | Done | Direct `cerefox_projects` query, ordered by name. Best-effort `cerefox_log_usage` RPC fire-and-forget for the usage log (same pattern reused across all read commands). |
| 23B.6 | Port `cerefox list-metadata-keys` | Done | Calls `cerefox_list_metadata_keys` RPC, prints {key, doc_count, example_values[0..3]}. |
| 23B.7 | Port `cerefox metadata-search` | Done | Calls `cerefox_metadata_search` RPC directly. All flags ported including `--include-content` + `--max-bytes`. Required-option enforcement via commander's `requiredOption`; empty-object filter detected and rejected (exit 1, matches the MCP tool's `McpInvalidParams` semantics). |
| 23B.8 | Port `cerefox get-audit-log` | Done | Calls `cerefox_list_audit_entries` with all 6 optional filters. `--limit` clamped to 200 server-side; CLI passes through. Defensive null-handling on `created_at` / `doc_title` / `document_id` after smoke-test surfaced a real audit row with null `doc_title` from a previously-deleted document. |
| 23B.9 | Read-commands test suite | Done | `packages/memory/test/read-commands.test.ts` — **12 live tests** against the maintainer's Supabase: JSON shape validation, `--limit` enforcement, error paths (bogus project → exit 1, bogus UUID → exit 3, missing required option → exit 1, invalid JSON → exit 1, empty filter → exit 1, empty query → exit 1, fts mode works without embedding). Auto-skipped when Supabase isn't reachable (probes `list-projects --json` at module load). |

### 23C: Write commands ported + ingestion via EF

Write side is smaller (3 commands) but more dangerous — every command produces a real
write to the user's KB. Ingestion goes through the `cerefox-ingest` Edge Function
(not the Python pipeline), so the TS CLI doesn't pull the chunking/embedding logic
forward.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23C.1 | Port `cerefox ingest <path>` (file mode) | Pending | `--title`, `--project-name`, `--metadata` (JSON), `--update-if-exists`, `--document-id`, `--source`, `--author`, `--author-type`. Reads file from disk, POSTs to `cerefox-ingest` EF. Identity-flag resolution shared with v0.4 MCP server. |
| 23C.2 | Port `cerefox ingest --paste` (stdin mode) | Pending | Reads stdin to body bytes, requires `--title`. All flags from 23C.1 supported. |
| 23C.3 | Port `cerefox ingest-dir <dir>` (batch) | Pending | Recursive directory walk, file-extension filter (`.md`, `.txt`), `cli-progress`-based progress bar showing N/M files + the current path, retries on transient EF errors, summary table at end. Continues on partial failure (prints failed files). |
| 23C.4 | Port `cerefox delete-doc <document-id>` | Pending | `--reason`, `--author`, `--author-type`. Soft-delete only (matches Python). Confirms by printing the doc title + ID before the soft-delete. |
| 23C.5 | E2E parity test for write commands | Pending | One write test per command against a scratch project; verify result by reading back. Cleanup via the same `delete-doc` command tested. |

### 23D: Server + ops commands

The four "neither read nor write" commands. Most are thin shims today.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23D.1 | Port `cerefox mcp` subcommand | Pending | Imports `buildServer()` from `../server.ts` (same factory used by `cerefox-mcp` bin), runs in-process. No subprocess hop. The Python `cerefox mcp` soft-wrapper from v0.4 keeps working unchanged for users on the legacy `uv run cerefox` path. |
| 23D.2 | `cerefox web` — explicit "not-yet" message in v0.5 | Pending | Prints: "The TS web server lands in v0.6. For now: `uv run cerefox web` from a clone, or wait. See [`migration-v0.5.md`](docs/guides/migration-v0.5.md#web-ui-in-v05)." Exit code 0 (it's a feature signal, not an error). |
| 23D.3 | Port `cerefox backup` (JSON snapshot) | Pending | `--output-dir`, `--include-versions`. Reads all docs via Data API, writes JSON files; optional `--git` flag to `git add && git commit` in the output dir. Parity-tested against the Python output. |
| 23D.4 | Port `cerefox restore <snapshot-dir>` | Pending | Inverse of backup. Re-uses `cerefox-ingest` EF for the write path. `--dry-run` flag shows what would be restored without writing. |
| 23D.5 | Port `cerefox sync-docs` | Pending | Today this is `scripts/sync_docs.ts`; v0.5 wires it as a first-class subcommand. Logic stays in `scripts/`; the subcommand is a thin shim that calls into it. |
| 23D.6 | Port `cerefox docs [topic]` | Pending | Today serves bundled markdown via `cerefox docs`; TS version reads from the npm package's bundled `docs/` directory (which 23F bundles). Opens in `$BROWSER` or prints to stdout if `--print` is set. |
| 23D.7 | `cerefox reindex` — defer to v0.7 message | Pending | Prints: "Reindex is part of the v0.7 ingestion pipeline migration. For now: `uv run cerefox reindex` from a clone. See migration-v0.5.md." Exit 0. |
| 23D.8 | `cerefox config-get <key>` / `cerefox config-set <key> <value>` ports | Pending | Read/write `cerefox_config` table via the Data API. Same surface as Python: keys like `usage_tracking_enabled`. |

### 23E: New lifecycle commands

The six brand-new commands. `init` is the headline. `doctor` is the second-most-visible.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23E.1 | `cerefox init` — interactive bootstrap | Pending | Five `prompts.ts`-driven steps (Supabase URL, Supabase key, OpenAI key, Postgres URL, identity). Writes `~/.cerefox/.env` (or `CEREFOX_CONFIG_DIR`). Validates Supabase + OpenAI before writing. Then **deploys schema** (DDL via the Postgres URL) and **ingests bundled self-docs** (calls into 23F's `sync-self-docs`). Optional final step: wire MCP for Claude Code via 23E.5. |
| 23E.2 | `cerefox init --config <file>.json` non-interactive mode | Pending | Reads all 5 answers from a JSON file. For CI / scripted setup. Same validations as interactive. |
| 23E.3 | `cerefox doctor` — diagnostic | Pending | 8 checks: binary path, Bun/Node runtime, `~/.cerefox/.env` exists + mode 0600, Supabase Data API reachable, OpenAI test embedding, Postgres connection (DDL-capable), schema version match, MCP client configs detected. Each check returns `{name, status, detail, hint}`. Exit 0 all green, 1 if any error. |
| 23E.4 | `cerefox status` — quick sanity (faster `doctor`) | Pending | Subset of `doctor`'s checks: config present, Supabase reachable, schema version match. Designed to run in < 500ms for shell prompt integration / pre-commit hooks. |
| 23E.5 | `cerefox configure-agent --tool <claude-code\|claude-desktop>` | Pending | Phase 1 supports Claude Code (writes `~/.claude/mcp.json` or merges) + Claude Desktop (platform-specific config). Backs up existing config to `<file>.pre-cerefox.bak` before writing. Generates the `npx --package=@cerefox/memory cerefox-mcp` invocation form (the v0.4.1 canonical spelling). Phase 2 (Cursor, Codex, Gemini) ships in v0.5.x or v0.6. |
| 23E.6 | `cerefox self-update` | Pending | Detect installer (which `bun`/`npm`/`yarn`/`pnpm` actually installed `@cerefox/memory` — inspect global install dirs), wrap the corresponding update command, print version transition. Final step: call 23F's `sync-self-docs` to refresh bundled-docs ingest. `--check` for read-only "what's new", `--yes` for non-interactive, `--version X.Y.Z` to pin. |

### 23F: Self-doc ingest (Layer 2 of MCP discoverability)

Per design doc §10d, Layer 2: every Cerefox install gets the agent guidance ingested
automatically as part of `cerefox init`. v0.4 already shipped Layer 3
(`cerefox_get_help` MCP tool); v0.5 closes Layer 2.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23F.1 | Bundle `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`, and a curated `docs/guides/` subset into the npm package | Pending | Add to `packages/memory/package.json` `files` array. Verify they ship via `npm pack --dry-run`. Bundled docs are read at runtime via `import.meta.dir`-relative path. |
| 23F.2 | Implement `cerefox sync-self-docs` | Pending | Walks the bundled docs directory, ingests each via `cerefox-ingest` EF (same path as user-content ingest), assigns project `_cerefox-self-docs` (created on demand), metadata `{"type":"agent-guide","source":"cerefox-self-docs","version":"<from-package-json>"}`. Idempotent via `update_if_exists: true` keyed by title. Prints summary table at end. |
| 23F.3 | Wire `sync-self-docs` into `cerefox init` final step | Pending | After config + schema deploy, call into `sync-self-docs`'s exported `run()` function. Informational, not a prompt. |
| 23F.4 | Wire `sync-self-docs` into `cerefox self-update` final step | Pending | After the package update succeeds, call `sync-self-docs` automatically so docs stay in lockstep with code. |
| 23F.5 | Web UI: hide `_`-prefixed projects from default listings | Pending | Frontend change in `frontend/src/`. Project picker filters out `_*` names unless an `--include-system` toggle is set. Audit log + version history still show `_cerefox-self-docs` activity normally (since it's a real project). |
| 23F.6 | Self-doc ingest snapshot test | Pending | After a `sync-self-docs` against a fresh KB, assert the expected set of documents (by title) lands under `_cerefox-self-docs` with the right metadata version. Sensitive to bundled-doc changes; ratchet on intentional updates. |

### 23G: CLI polish

The "make it feel like a real CLI" layer. Most of these are small individually but
collectively define the v0.5 UX.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23G.1 | Tab completion generators (bash / zsh / fish) | Pending | `cerefox completion bash > /etc/bash_completion.d/cerefox` (or `~/.bashrc` source line). One script per shell — generated by walking the commander tree. Tested by sourcing the script and confirming `cerefox <TAB>` lists subcommands. |
| 23G.2 | `--json` mode uniformly on all read commands | Pending | Already required per-command in 23B; this task is the cross-command audit confirming every read command supports `--json` and the JSON shape is stable / documented in `--help`. |
| 23G.3 | Subcommand grouping in `--help` | Pending | commander supports help-text customisation; group commands by section: "READS", "WRITES", "SERVERS", "LIFECYCLE", "OPS". Replaces today's flat alphabetical list. |
| 23G.4 | Documented exit codes | Pending | Document `0/1/2/3` in CONTRIBUTING.md + `cerefox --help` output. Every error path in the CLI core uses `process.exit(code)` via the typed wrapper from 23A.7. |
| 23G.5 | Better error messages with hints | Pending | Every error message ends with "Try `cerefox <X>`" or a doc link. Common cases: Supabase unreachable → `cerefox doctor`; auth failed → `cerefox config-get` + key check; rpc not found → `db_deploy.py` nudge. |
| 23G.6 | Bare `cerefox` (no args) — friendly entry point | Pending | If args.length === 0: detect state. Config missing → "Run `cerefox init`". Config present + KB empty → "Try `cerefox ingest <path>` or `cerefox search <query>`". Else: show `--help`. |
| 23G.7 | Hidden `cerefox upgrade` alias for `cerefox self-update` | Pending | Per open question 6. One-line commander alias. Doesn't appear in `--help` but works as expected. |

### 23H: Python CLI deprecation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23H.1 | Add deprecation banner to `src/cerefox/cli.py` `cli()` group | Pending | Single-line ⚠ to stderr on every invocation: "Cerefox CLI has moved to TypeScript. Install via `npx -y --package=@cerefox/memory cerefox` or see https://github.com/.../migration-v0.5.md. The Python CLI remains functional through v0.7.x." Click decorator catches all subcommands. Suppress in `--json` mode (don't pollute JSON output). |
| 23H.2 | Update `src/cerefox/mcp_server.py` (legacy fallback) | Pending | The fallback's existence is unchanged. Just verify no banner / no behavior change. Tests pin this. |
| 23H.3 | Audit Python entry points in `pyproject.toml` | Pending | Ensure `cerefox` console_script still exists for fallback users; no removal in v0.5. |

### 23I: install.sh + docs

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23I.1 | Write `install.sh` | Pending | ~50 lines of POSIX sh. Detects shell, detects bun (via `which`), if absent runs `curl -fsSL https://bun.sh/install \| bash`, then `bun install -g @cerefox/memory` (fallback to `npm install -g` if bun install fails). Prints a "next steps" banner pointing at `cerefox init`. |
| 23I.2 | Attach `install.sh` to GitHub Releases | Pending | New step in `release.yml` (or `cut_release.ts`) — `gh release upload v0.5.0 install.sh` after the GitHub Release is created. URL stable: `https://github.com/.../releases/latest/download/install.sh`. |
| 23I.3 | Write `docs/guides/migration-v0.5.md` for existing v0.4.x users | Pending | What changes (CLI is npm-installable; Python CLI deprecated banner), what stays (Python CLI still works; existing MCP configs work via `cerefox-mcp` bin from v0.4), how to switch (one `bun install -g @cerefox/memory` + restart MCP clients). Includes the v0.5-specific notes: `web` is Python-only for now, `reindex` is Python-only for now. |
| 23I.4 | Rewrite `docs/guides/installing.md` (or merge into `quickstart.md`) | Pending | npm-native install is the primary path; Python install moved to a "From source" subsection at the bottom. Includes the `cerefox init` walkthrough. |
| 23I.5 | Update `docs/guides/connect-agents.md` for `cerefox configure-agent` | Pending | New "Automatic configuration" section makes `cerefox configure-agent --tool <client>` the recommended path. Manual MCP config snippets demoted to "Manual configuration" subsections per client. |
| 23I.6 | Update `README.md` for v0.5 | Pending | Project status → v0.5.0. Release table marks v0.5.0 as current. Prerequisites table flips: npm/bun installs are primary; uv + clone is "From source" / contributor path. |
| 23I.7 | Update `CLAUDE.md` Project Structure | Pending | `packages/memory/src/cli/` and `packages/memory/src/bin/cerefox.ts` added. `_shared/cli-core/` added. Bin count 1 → 2 (`cerefox`, `cerefox-mcp`). |
| 23I.8 | Update `CONTRIBUTING.md` Development Setup | Pending | Add `bun run cli -- <args>` invocation for running the CLI against the source tree. Note: `bun install` from repo root now bootstraps both bins. |
| 23I.9 | Update `AGENT_GUIDE.md` and `AGENT_QUICK_REFERENCE.md` | Pending | CLI fallback section: switch from `uv run cerefox` to `npx --package=@cerefox/memory cerefox` (or globally-installed `cerefox`). Tool-vs-CLI mapping section updated with the new bin name. |
| 23I.10 | Write `packages/memory/README.md` (npm package README) | Pending | npm warns about missing READMEs. Light overview (what is Cerefox, what's in this package, install one-liner, link to full docs on GitHub). Refreshed each release — owner is `cut_release.ts` indirectly (it bumps version literals; the README content tracks the package state but isn't auto-rewritten). |

### 23J: Documentation + Decision Log + CHANGELOG + plan markup + release

The closing iteration step. Mirrors iter-22 Part G.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23J.1 | CHANGELOG `[Unreleased]` populated with v0.5.0 release notes | Pending | Same structure as v0.4.x entries. `cut_release.ts` promotes on cut. |
| 23J.2 | Decision Log Q2 Part 3 (or Part 4 if Part 3 hits ~50K) entry: "v0.5.0 — TS CLI" | Pending | Capture: the commander-vs-oclif choice, the `web`/`reindex` deferral rationale, the ingestion-via-EF decision, the per-PR-grouping decision, the `configure-agent` Phase-1-only scope, the Python deprecation timing (banner now, removal v0.8/v0.9), and any new gotchas discovered during build. |
| 23J.3 | Mark all Iteration 23 sub-tasks with final status | Pending | Same shape as iter-22 — every row gets Done / Deferred / Skipped + a one-line outcome note. |
| 23J.4 | Open PR(s) for v0.5.0 | Pending | Per open question 1, likely 3 PRs (23A+B+C / 23D+E / 23F+G+H+I) merged sequentially. Final PR includes 23J. |
| 23J.5 | Post-merge: cut v0.5.0 | Pending (post-merge maintainer task) | `bun scripts/cut_release.ts 0.5.0 --npm-publish`. Pre-flight checks per Decision Log Q2 Part 3 procedure: `git grep -F "0.4.3" packages/ scripts/ _shared/` should be empty (or only intentional historical refs); `cd packages/memory && npm pack --dry-run` should emit no `bin[*]` warnings; CHANGELOG `[Unreleased]` should have real content. |
| 23J.6 | Post-publish verification (3-way) | Pending (post-merge maintainer task) | From `/tmp`: registry HEAD 200, `jq .bin/.version` matches, `npx -y --package=@cerefox/memory@0.5.0 cerefox --version` prints 0.5.0. Run `cerefox doctor` against a fresh install to confirm all green. |
| 23J.7 | Write `docs/research/v0.5-manual-test-plan.md` | Pending | Comprehensive manual test plan: every command with happy path + at least one error path, full `init` walkthrough on a fresh machine, `doctor` red-path scenarios, `configure-agent` per supported client (Phase 1: Claude Code + Claude Desktop), `self-update` + `upgrade` alias parity, install.sh on a clean macOS box. Maintained as a living checklist for v0.5+ releases. |

**Total**: ~60 sub-tasks across 10 parts.

**Tests / risk**: High overall (largest single migration in the arc).

- **Highest risk**: 23B + 23C parity drift across 11 ported commands. Mitigated by the parity test infrastructure (23B.9 + 23C.5) running side-by-side outputs.
- **High risk**: 23E.1 (`cerefox init`) — interactive flow with side effects (writes ~/.cerefox/.env, deploys schema, ingests docs, wires MCP). Test via the `--config` non-interactive mode (23E.2) which has the same code path minus prompts.
- **Medium risk**: 23F (self-doc ingest) — bundling docs into the npm package; sensitive to file-path resolution at runtime. Snapshot test (23F.6) catches drift.
- **Medium risk**: 23J.5 first cut via the v0.4.3-hardened cut_release.ts — should be smooth, but it's the first time we publish a package with a new bin entry. Pre-flight grep + dry-run pack.
- **Lower risk**: 23H (Python deprecation banner) — additive, no behavior change. 23I (docs).

**Deferred to later iterations** (not in v0.5.0):
- **`cerefox web` as a native TS server** — v0.6.0.
- **`cerefox reindex` via TS** — v0.7.0 (depends on TS ingestion pipeline).
- **`cerefox configure-agent` Phase 2** (Cursor, Codex, Gemini) — v0.5.x or v0.6.
- **`/app/settings` page** — v0.5.x or v0.6.
- **Hard-removal of Python CLI** — v0.8/v0.9.

---

## Iteration 24: v0.6.0 — "TS Web Server" (FastAPI → Hono)

**Goal**: Migrate the local web server from Python/FastAPI to TS/Hono on Bun. Web UI
unchanged (already TS). **Web server code lands in the existing `packages/memory/`** —
no new npm package. The v0.5.0 `cerefox web` subcommand boots the in-process Hono
server instead of shelling out to a Python FastAPI process.

**Design**: [`docs/specs/polish-and-distribution-design.md` §13 v0.6.0](specs/polish-and-distribution-design.md)
(the design doc's "`packages/web-server/`" naming is superseded — see the
"Living design notes" callout at the top of that file for the consolidated
single-package model).

**Estimated effort**: 4 weeks part-time.

**Detailed task breakdown will be created when this iteration is started.** Headline items:
- New TS web server **inside `packages/memory/`** (`packages/memory/src/web/`) using Hono. No new npm package.
- `packages/memory/package.json` `bin` block grows by zero — `cerefox web` is a subcommand of the existing `cerefox` binary, not a separate bin entry.
- All `/api/v1/*` endpoints ported with response-shape parity.
- Frontend `dist/` continues to ship inside `@cerefox/memory` (already there from v0.4.0's bundling). Hono serves it from the bundled location.
- E2E test suite passes against the new server.
- `cerefox web` (TS) replaces `cerefox web` (Python).
- Python `api/app.py` + `api/routes_api.py` deprecated but kept around (same indefinite-shim policy as iter-20's other Python shims).
- First-run UX in web UI: empty-state getting-started panel.

---

## Iteration 25: v0.7.0 — "TS Ingestion Pipeline" (last big Python component)

**Goal**: Migrate chunking + embedding orchestration + version snapshotting to TS. PDF and
DOCX support **dropped** (never used; not worth porting). **Ingestion code lands inside
`packages/memory/`** (under `_shared/ingest/` since the same modules are also used by the
Edge Functions). No new npm package.

**Design**: [`docs/specs/polish-and-distribution-design.md` §13 v0.7.0](specs/polish-and-distribution-design.md)
(see the "Living design notes" callout at the top of that file for the
consolidated single-package model).

**Estimated effort**: 6 weeks part-time. Chunking parity is the critical test.

**Detailed task breakdown will be created when this iteration is started.** Headline items:
- New TS chunking module under `_shared/ingest/` — port of `markdown.py` heading-aware splitter (snapshot-test parity).
- New TS embedding orchestration using OpenAI Node SDK.
- New TS ingestion pipeline calling `cerefox_ingest_document` RPC.
- `cerefox ingest` and `cerefox ingest-dir` invoke the TS pipeline in-process (no shell-out).
- The `cerefox-ingest` Edge Function (Deno) also imports the same `_shared/ingest/` modules — one chunking implementation, two consumers, like the v0.4 `_shared/mcp-tools/` pattern.
- PDF/DOCX support **dropped**; CHANGELOG announces removal.
- Remaining `scripts/*.py` ported to `scripts/*.ts` per the §12f script-language policy: `db_deploy.py`, `db_migrate.py`, `backup_create.py`, `backup_restore.py`, `reindex_all.py`. All become TS scripts that consume `_shared/ingest/` and `_shared/db-client/`.

---

## Iteration 26: v0.8.0 — "Deprecate Python" + v0.9.0 — "Python Removal"

**Goal**: Two-step Python retirement.

**v0.8.0** (~2 weeks): all Python entry points print prominent deprecation banner. Code
moved to `python-legacy/` subdirectory. Install docs no longer mention Python.

**v0.9.0** (~1 week): `python-legacy/` deleted. `pyproject.toml`, `uv.lock`, `.python-version`
removed. Repo is pure TS + SQL + React.

**Design**: [`docs/specs/polish-and-distribution-design.md` §13 v0.8.0 + v0.9.0](specs/polish-and-distribution-design.md).

---

## Iteration 27: v1.0.0 — "Stability Commitment"

**Goal**: Not a feature release. The contract release. Strict SemVer policy from §11 of the
design doc becomes binding.

**Trigger**: ~2-3 months of v0.9 in the wild without breaking changes + at least one outside
user installing without help.

**Design**: [`docs/specs/polish-and-distribution-design.md` §13 v1.0.0](specs/polish-and-distribution-design.md).

---

## Iteration 28: Document Relations & Semantic Graph (post-v1.0, target v1.1+)

**Goal**: Add explicit document-to-document relations (`related_to`, `references`,
`supersedes`, etc.) on top of Cerefox's existing many-to-many `cerefox_documents` ↔
`cerefox_projects` model. Enables semantic-graph traversal, "what links here" navigation,
high-fan-in truncation, and explicit cross-document context propagation. The web-UI
link-resolver shipped in v0.1.19 is a sister piece — same problem domain (cross-doc
references) at the rendering layer; this iteration adds it at the data-model layer.

**Status**: independent of the polish & migration arc (Iterations 19-27). The polish arc
absorbed the OLD "Iteration 18 = narrow TS port of mcp_server.py" plan; this iteration is
a completely separate body of work that shares neither code nor schedule with it. The
naming collision is historical — both got tagged "Iteration 18" at different points in
2026 when each was the next thing planned.

**Design**: [`docs/research/document-relations-and-semantic-graph.md`](research/document-relations-and-semantic-graph.md) —
562-line technical brief originally drafted April 2026 (filename changed
2026-05-25 from `iteration-18-design.md` to match topic-based naming
convention used by other docs in `docs/research/`). Covers:

- New `cerefox_document_relations` table (M2M, typed edges) — junction with
  `relation_type` and an optional `bidirectional` flag. Junction-table soft-delete
  discipline applies (see Decision Log Q2 Part 2 entry, 2026-05-25).
- Lifecycle metadata on documents (states: draft → review → published → archived;
  `superseded_by` relation when content is replaced rather than updated).
- Retrieve-then-traverse search pattern: Phase 1 = hybrid search; Phase 2 = graph
  traversal from top-N hits.
- Slack message modeling as a canonical sequential/threaded use case — channel as
  a "container relation", thread as a "reply relation".
- High fan-in truncation (`max_inbound_display` per relation type, day-one concern
  to avoid e.g. a "tagged-with-meeting" relation overwhelming a doc's incoming list).
- Obsidian wikilink → `related_to` relation sync (`[[Note Name]]` syntax extraction).
- Implementation sketch for RPCs, Python client methods, MCP tools, Edge Functions,
  REST API endpoints, and Web UI surfaces.

**Why post-v1.0**: this iteration adds new data-model surface (a new junction table,
new RPCs, new MCP tools, new web UI). Under strict SemVer, that's minor-version
behavior for v1.x — perfectly fine. Doing it pre-v1.0 would either delay the
stability commitment or risk landing the data-model addition under a still-evolving
schema. Cleaner to ship v1.0 with a stable model and add relations as v1.1.

**Estimated effort**: large. Probably 4-6 weeks part-time across multiple sub-iterations
once started (RPC + table → Python client → MCP tools → web UI graph traversal → Obsidian
sync). Worth breaking into 28a/28b/28c when scheduled.

**Detailed task breakdown will be created when this iteration is started.**

---

## Current Focus

**Recent releases (May 2026)**:
- **v0.1.19** (2026-05-18, updated 2026-05-24) — web UI link resolver + FTS query-parser
  fix (`websearch_to_tsquery` → `plainto_tsquery`) + agent-guidance refinement (doc-uuid
  is the only recommended link form).
- **v0.1.20** (2026-05-25) — issue #38 coordinated four-part fix: multi-project membership
  preservation on content update. Non-destructive add for singular `project_name` on
  update; new `project_names: string[]` parameter for explicit destructive replace; new
  MCP tool `cerefox_set_document_projects` (tool count 8 → 9). All three paths (local
  Python MCP, remote MCP, `cerefox-ingest` Edge Function) share one contract.
- **v0.1.21** (2026-05-25) — three small web-UI quality-of-life fixes: dashboard project
  counts no longer include trashed docs (now shows "5 (1 in trash)"); project documents
  page paginated; trash page shows project membership chips per row.
- **v0.2.0** (2026-05-26) — "Real Release". Foundations + first TS artifact.
  VERSION file as single source of truth; `cerefox --version` shows the real
  version (was stuck on `0.1.0`); web UI footer with `<VersionFooter>` and
  `/api/v1/version` endpoint; `scripts/cut_release.ts` (first TS file outside
  Edge Functions / frontend) implements the full release ritual including the
  previously-missed `gh release create` step; OSS hygiene files; SemVer +
  script-language policies in CONTRIBUTING.md; Bun added as a contributor
  prerequisite (end users unaffected). Design-of-record promoted from
  `docs/research/` to `docs/specs/`. **First-ever GitHub Release for Cerefox.**
- **v0.3.0** (pending — cut post-merge of feat/v0.3.0-install-anywhere) —
  "Install Anywhere". Config-state refactor with `~/.cerefox/` as the new
  user-state root (backward-compat: repo-local `.env` still wins for dev mode);
  bundled documentation surface (`cerefox docs [TOPIC]` CLI + `/app/help` web
  UI page + `/api/v1/docs` endpoints); schema-version-mismatch banner that
  closes the v0.1.19 redeploy footgun; first two Python → TS script ports
  (`scripts/db_status.ts` + `scripts/sync_docs.ts`) per the §12f policy, with
  the legacy `.py` files converted to **deprecation shims** (kept indefinitely
  as a migration aid; no scheduled removal). `_shared/` cross-context TS module seeded with `config/`,
  `db-client/`, and `db-status/`. New introspection RPC
  `cerefox_pg_function_exists()`. Frontend `dist/` bundled into the wheel via
  hatchling `force-include`. End-user redeploy required:
  `uv run python scripts/db_deploy.py` (two new RPCs ship in v0.3.0).

**Test counts**: 569 Python unit tests + 14 Bun tests + 80 e2e tests pass.

**Strategic shift codified** (2026-05-24): pivoting from "Iteration 18 = narrow TS port
of MCP server" to the broader **Polish & Distribution arc** covering v0.2.0 through v1.0.0
via a Python → TypeScript strangler-fig migration. Design-of-record:
[`docs/specs/polish-and-distribution-design.md`](specs/polish-and-distribution-design.md).

**Next**: Iteration 22 (v0.4.0 — "TS MCP Server", supersedes old Iteration 18).
Detailed 39-task breakdown landed in the Iteration 22 section above — 7 parts:

- **22A** (8 tasks) — `_shared/mcp-tools/` extraction. Audit Python ↔ EF
  parity, factor the 8 current MCP tool handlers + the new `cerefox_get_help`
  into runtime-neutral modules, grow `_shared/db-client/` to cover every
  RPC the tools need.
- **22B** (5 tasks) — `cerefox_get_help` MCP tool (Layer 3 of the MCP
  discoverability response per design doc §10d). Bundles
  `AGENT_QUICK_REFERENCE.md` whole; CI check enforces in-sync.
- **22C** (8 tasks) — new `packages/memory/` TS stdio server (published as
  `@cerefox/memory`, containing the `cerefox-mcp` bin in v0.4 + the
  `cerefox` CLI bin from v0.5) using `@modelcontextprotocol/sdk`, repo-root
  npm workspace setup, startup schema-version check.
- **22D** (4 tasks) — refactor `supabase/functions/cerefox-mcp/` to import
  from `_shared/mcp-tools/` instead of self-contained tools. Highest-risk
  step; mitigated by snapshot parity tests + the full 80-test e2e gauntlet.
- **22E** (3 tasks) — Python `cerefox mcp` becomes a *soft* wrapper: tries
  `npx @cerefox/memory cerefox-mcp`, falls back to the legacy Python impl
  with a stderr nudge if npm/Bun isn't available. No hard break of
  existing MCP configs. (Refinement vs. the design doc's "shells out to npx".)
- **22F** (4 tasks) — first npm publication for Cerefox. Adds the
  `.github/workflows/release.yml` workflow (OIDC trusted publishing,
  `--provenance` attestation). `--npm-publish` flag on `cut_release.ts`
  defaults to `false` so tag-cutting and publishing are two distinct
  confirmation surfaces. The maintainer-side bootstrap procedure is
  tracked privately, not here.
- **22G** (10 tasks) — docs (`migration-v0.4.md` for existing users,
  `connect-agents.md` updates for new users, agent guides, CLAUDE.md,
  CONTRIBUTING.md, setup-supabase note on OIDC), Decision Log, CHANGELOG,
  release cut.

Deferred to v0.5.0 / later (called out in the iter-22 section so they
don't get smuggled in): `cerefox configure-agent`, `cerefox init` self-doc
ingest (Layer 2 of discoverability), zero-chunk-create RPC refusal,
`scripts/db_deploy.py` / `db_migrate.py` ports.

**After Iteration 22**: Iterations 23–27 (TS CLI + remaining script ports,
web server, ingestion, Python removal, v1.0 commitment).
