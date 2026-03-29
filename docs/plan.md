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
| 16B.1 | Add `project_names TEXT[]` to RETURNS TABLE of all 6 existing search/retrieve RPCs | Todo | Affected: `cerefox_hybrid_search`, `cerefox_fts_search`, `cerefox_semantic_search`, `cerefox_search_docs`, `cerefox_reconstruct_doc`, `cerefox_get_document`. Requires `DROP FUNCTION IF EXISTS ...` before `CREATE OR REPLACE` for each (signature change). Use `ARRAY(SELECT p.name FROM cerefox_projects p JOIN cerefox_document_projects dp ON p.id = dp.project_id WHERE dp.document_id = d.id)` |
| 16B.2 | Write `cerefox_list_projects()` RPC | Todo | `SELECT id, name, description FROM cerefox_projects ORDER BY name`; SECURITY DEFINER |
| 16B.3 | Write `cerefox_metadata_search` RPC | Todo | SECURITY DEFINER; GIN containment filter; both `project_ids` and `project_names` in output; p_max_bytes pruning when include_content=true |
| 16B.4 | Create and deploy migration `0005_metadata_search.sql` | Todo | Contains all changes from 16B.1–16B.3; `uv run python scripts/db_migrate.py` |

**Step 2 -- Python client**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.5 | Add `project_names: list[str]` field to `SearchChunkResult`, `DocResult`, and any other result types in `search.py` and `client.py` | Todo | New field from updated RPCs; additive -- existing code ignores it |
| 16B.6 | Add `list_projects_rpc()` to `client.py` | Todo | Calls `cerefox_list_projects` RPC; returns `list[dict]` with id/name/description |
| 16B.7 | Add `metadata_search()` to `client.py` | Todo | Calls `cerefox_metadata_search` RPC; params mirror RPC signature |

**Step 3 -- REST API**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.8 | Update search response models to include `project_names: list[str]` | Todo | `SearchResultResponse`, `DocResultResponse` in `routes_api.py` -- additive field |
| 16B.9 | Add `POST /api/v1/documents/metadata-search` endpoint | Todo | JSON body matches RPC params; `max_bytes=None` (uncapped for web UI) |

**Step 4 -- Edge Functions and MCP wiring**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.10 | Update `tools/search.ts` in `cerefox-mcp` -- change input from `project_id UUID` to `project_name TEXT`; resolve name → UUID via `cerefox_list_projects` RPC before calling `cerefox_hybrid_search` | Todo | Return error if project_name not found |
| 16B.11 | Update `tools/ingest.ts` in `cerefox-mcp` -- same `project_name` input pattern | Todo | Already consistent with local MCP; remote was the odd one out |
| 16B.12 | Add `tools/list-projects.ts` to `cerefox-mcp` -- calls `cerefox_list_projects` RPC directly | Todo | Thin; no params; returns formatted list |
| 16B.13 | Update `index.ts` dispatcher -- add `cerefox_list_projects` tool; update tool schemas for search and ingest | Todo | Tool count: 6 → 8 (adding list_projects + metadata_search) |
| 16B.14 | Create `cerefox-metadata-search` primitive Edge Function | Todo | Thin wrapper over `cerefox_metadata_search` RPC; accepts `project_id UUID` (primitive interface); enforces max_bytes ceiling |
| 16B.15 | Add `tools/metadata-search.ts` to `cerefox-mcp` -- calls `cerefox_metadata_search` RPC directly; resolves `project_name` → UUID | Todo | Consistent with 16A architecture |
| 16B.16 | Deploy all updated Edge Functions | Todo | `npx supabase functions deploy cerefox-metadata-search cerefox-mcp` |

**Step 5 -- Local MCP server**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.17 | Add `cerefox_list_projects` tool to `mcp_server.py` | Todo | Calls `client.list_projects_rpc()`; returns formatted table |
| 16B.18 | Add `cerefox_metadata_search` tool to `mcp_server.py` | Todo | Calls `client.metadata_search()`; resolves project_name → UUID via `client.list_projects_rpc()`; handles max_bytes ceiling |

**Step 6 -- CLI**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.19 | Add `cerefox metadata-search` CLI command | Todo | Options: `--filter` (JSON), `--project` (name), `--updated-since`, `--created-since`, `--limit`, `--include-content`; output: formatted table |

**Step 7 -- Web UI**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.20 | Update search results components to display `project_names` instead of (or alongside) raw UUIDs | Todo | Affects Search page result cards; use names for display, keep IDs for links |
| 16B.21 | Add "Metadata Search" page at `/app/metadata-search` | Todo | Metadata filter builder (key/value rows with autocomplete), date filters, project name dropdown, include-content toggle; results show doc card with metadata chips, project names, optional content preview |
| 16B.22 | Add "Metadata Search" nav link | Todo | After "Search" in the nav bar |

**Step 8 -- Tests**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.23 | Unit tests: `project_names` field present in all result types; `list_projects_rpc()` param pass-through | Todo | Mock RPCs |
| 16B.24 | Unit tests: `metadata_search()` in `client.py`; param propagation; max_bytes pass-through | Todo | Mock RPC call; test all param combinations |
| 16B.25 | E2e test: ingest 3 docs with varying metadata across 2 projects; assert metadata_search returns correct docs with correct project names; assert cerefox_list_projects returns both projects | Todo | Add to `tests/e2e/test_api_e2e.py`; test AND semantics, project_name filter, updated_since, include_content, result limit |
| 16B.26 | E2e test: add `test_mcp_edf.py` tests for new MCP tools (`cerefox_list_projects`, `cerefox_metadata_search`) and project_name resolution via MCP | Todo | Extend `tests/e2e/test_mcp_e2e.py` (written in 16A); regression-test `cerefox_search` project_name breaking change |
| 16B.27 | E2e test: add `test_edge_functions_e2e.py` tests for new `cerefox-metadata-search` primitive Edge Function | Todo | Extend `tests/e2e/test_edge_functions_e2e.py` (written in 16A); cover metadata filter, project_id filter, include_content=true |
| 16B.28 | Playwright UI e2e test: navigate to `/app/metadata-search`; enter a filter; verify results render with project name chips | Todo | Add to `tests/e2e/test_ui_e2e.py` |

**Step 9 -- Documentation**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16B.28 | Update `docs/guides/connect-agents.md` -- updated tool schemas (project_name inputs, new tools); GPT Actions OpenAPI schema v1.5.0; note primitive Edge Functions still use project_id UUID | Todo | |
| 16B.29 | Update `docs/guides/upgrading.md` -- add v0.1.10 breaking change notice: MCP `project_id` input removed, replaced by `project_name`; affected tools: cerefox_search, cerefox_ingest, cerefox_metadata_search; primitive Edge Functions unaffected | Todo | Already drafted in upgrading.md; task is to verify accuracy after implementation |
| 16B.30 | Update `README.md` -- add metadata search and project discovery to feature table | Todo | |
| 16B.31 | Update `CLAUDE.md` -- Edge Function inventory (new `cerefox-metadata-search`; total 8 Edge Functions, 8 MCP tools); MCP tool list | Todo | |
| 16B.32 | Update `MEMORY.md` -- revised Edge Function and MCP tool counts | Todo | |
| 16B.33 | Update `docs/solution-design.md` -- add metadata search as a named retrieval mode; project name standardisation pattern | Todo | |
| 16B.34 | Add entry to Cerefox Decision Log -- record: metadata search as first-class primitive; project name standardisation (names in MCP, UUIDs in primitive Edge Functions); decision to return both project_ids and project_names in all RPCs; `p_include_content` opt-in design; dual date filter rationale | Todo | Via `cerefox_ingest` with `update_if_exists: true` |

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
| 16C.1 | Create migration `0006_usage_log.sql` -- new tables and RPCs | Todo | `cerefox_usage_log` table, `cerefox_config` table, RLS (deny direct access; SECURITY DEFINER RPCs used by all callers), indexes |
| 16C.2 | Update `schema.sql` to reflect final state | Todo | |

**Step 2 -- RPCs**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.3 | Write `cerefox_log_usage` RPC | Todo | Reads config; no-op if disabled; inserts row; SECURITY DEFINER |
| 16C.4 | Write `cerefox_get_config` and `cerefox_set_config` RPCs | Todo | `cerefox_set_config` validates key against allowlist (only `usage_tracking_enabled` for now) |
| 16C.5 | Write `cerefox_list_usage_log` RPC | Todo | Filters: start/end, operation, access_path, reader, project_id; ordered `logged_at DESC` |
| 16C.6 | Write `cerefox_usage_summary` RPC | Todo | Returns JSON with: ops_by_day (array), ops_by_operation (object), ops_by_access_path (object), top_documents (array, doc_id + title + count), top_readers (array, reader + count), total_count |

**Step 3 -- Python client**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.7 | Add `log_usage()`, `get_config()`, `set_config()`, `list_usage_log()`, `usage_summary()` to `client.py` | Todo | All call corresponding RPCs |

**Step 4 -- REST API**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.8 | Add `GET /api/v1/usage-log` endpoint | Todo | Params: start, end, operation, access_path, reader, project_id, limit; returns list |
| 16C.9 | Add `GET /api/v1/usage-log/export.csv` endpoint | Todo | Same filters; returns CSV with all columns; `Content-Disposition: attachment` |
| 16C.10 | Add `GET /api/v1/usage-log/summary` endpoint | Todo | Params: start, end, project_id, access_path; returns summary JSON from RPC |
| 16C.11 | Add `GET /api/v1/config/{key}` and `PUT /api/v1/config/{key}` endpoints | Todo | Read/write config values; PUT validates against allowlist |

**Step 5 -- Wire logging through Edge Functions and MCP**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.12 | Add `cerefox_log_usage` call to `cerefox-search` Edge Function | Todo | access_path = `"edge-function"` for direct callers |
| 16C.13 | Add `cerefox_log_usage` call to `cerefox-metadata-search` Edge Function | Todo | |
| 16C.14 | Add `cerefox_log_usage` call to `cerefox-get-document` Edge Function | Todo | |
| 16C.15 | Add `cerefox_log_usage` call to `cerefox-list-versions` Edge Function | Todo | |
| 16C.16 | Add `cerefox_log_usage` call to `cerefox-get-audit-log` Edge Function | Todo | |
| 16C.17 | Add `cerefox_log_usage` calls to all 8 `tools/*.ts` handlers in `cerefox-mcp` | Todo | access_path = `"remote-mcp"`; covers 6 tools from 16A + 2 from 16B (`metadata-search.ts`, `list-projects.ts`); fire-and-forget after RPC call |
| 16C.18 | Deploy all updated Edge Functions | Todo | `npx supabase functions deploy <names>` |

**Step 6 -- Wire logging through Python paths**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.19 | Add `log_usage` calls to all read endpoints in `routes_api.py` | Todo | Fire-and-forget (try/except); access_path = `"webapp"`; reader from request auth or omitted |
| 16C.20 | Add `log_usage` calls to all read tools in `mcp_server.py` | Todo | access_path = `"local-mcp"`; reader from tool input or omitted |
| 16C.21 | Add `log_usage` calls to CLI read commands in `cli.py` | Todo | access_path = `"cli"`; reader = omitted |

**Step 7 -- CLI config commands**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.22 | Add `cerefox config get <key>` and `cerefox config set <key> <value>` CLI commands | Todo | Calls corresponding client methods; `cerefox config set usage_tracking_enabled true/false` |

**Step 8 -- Tests**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.23 | Unit tests: `log_usage` (disabled no-op, enabled insert, RPC pass-through) | Todo | Mock RPC; test enabled/disabled paths |
| 16C.24 | Unit tests: `get_config` / `set_config` client methods and `/api/v1/config` endpoints | Todo | Test allowlist validation (unknown key rejected); test read-back after write |
| 16C.25 | Unit tests: `usage_summary` response parsing | Todo | Mock RPC return; test field mapping |
| 16C.26 | E2e test: enable tracking, run search via Python client, verify entry appears in usage log with correct operation and access_path=`webapp` | Todo | Add to `tests/e2e/test_api_e2e.py`; tests opt-in behavior and access_path attribution end-to-end |
| 16C.27 | E2e test: disable tracking, run search, verify no new entry added | Todo | Add to `tests/e2e/test_api_e2e.py`; tests opt-out behavior |
| 16C.28 | E2e test: extend `test_mcp_e2e.py` -- enable tracking, run MCP search and ingest, verify usage log entries with access_path=`remote-mcp` | Todo | Confirms MCP usage logging works end-to-end; requires 16A e2e test file to already exist |

**Step 9 -- Documentation**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16C.29 | Add entry to Cerefox Decision Log -- record decision to use a separate `cerefox_usage_log` table (not extend audit log); record opt-in-by-default rationale; record `cerefox_config` table design (DB-stored config, no redeploy needed to toggle); record `access_path` taxonomy and why it is set by the caller layer, not the RPC | Todo | Via `cerefox_ingest` with `update_if_exists: true` |

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
| V1 | Calls per day (time-series bar chart, stacked by operation type) | Included | @mantine/charts (Recharts) | Primary activity overview |
| V2 | Calls per access path (time-series bar chart or grouped bar) | Included | @mantine/charts | Shows which clients are most active |
| V3 | Top N most-accessed documents (horizontal bar chart) | Included | @mantine/charts | Ranked by access count |
| V4 | Top N most-active readers (horizontal bar chart) | Included | @mantine/charts | Ranked by call count |
| V5 | Operations breakdown (donut/pie chart) | Included | @mantine/charts | Quick proportion view |
| V6 | Search query word cloud | Deferred | react-d3-cloud | Requires D3 dep; interesting for pattern discovery; add in post-16 |
| V7 | HEB (Hierarchical Edge Bundling): readers → documents | Deferred | D3.js | Shows multi-agent coordination patterns; which agents accessed which documents; add in post-16 when usage data accumulates enough to make it meaningful |

For V6 and V7, add placeholder cards in the UI with "Coming soon" text so the layout is
reserved, making it easy to drop in the visualization without a layout redesign.

#### Tasks

**Step 1 -- API client (TypeScript)**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16D.1 | Add `getUsageSummary`, `listUsageLog`, `exportUsageLogCsv`, `getConfig`, `setConfig` to the TypeScript API client | Todo | Mirrors REST endpoints; TanStack Query hooks |

**Step 2 -- Analytics page**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16D.2 | Create `Analytics.tsx` page with date range picker, project filter, access path filter | Todo | Filter state in URL params for shareability |
| 16D.3 | Add summary stat cards (total calls, unique readers, docs accessed, top operation) | Todo | Derived from `/api/v1/usage-log/summary` |
| 16D.4 | Implement V1: calls-per-day stacked bar chart | Todo | `@mantine/charts` BarChart |
| 16D.5 | Implement V2: calls-per-access-path bar chart | Todo | `@mantine/charts` BarChart |
| 16D.6 | Implement V3: top documents horizontal bar chart | Todo | Link each bar to document detail page |
| 16D.7 | Implement V4: top readers horizontal bar chart | Todo | `@mantine/charts` BarChart |
| 16D.8 | Implement V5: operations breakdown donut chart | Todo | `@mantine/charts` DonutChart |
| 16D.9 | Add placeholder cards for V6 (word cloud) and V7 (HEB) | Todo | "Coming soon" with brief description |
| 16D.10 | Add Usage Tracking toggle card | Todo | Reads config via API; toggle calls PUT; shows current state |
| 16D.11 | Add CSV export button | Todo | Triggers download with current filter params |
| 16D.12 | Add "Analytics" to app navigation (after "Audit Log") | Todo | |

**Step 3 -- Tests**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16D.13 | Playwright e2e: navigate to analytics page, verify stat cards and charts render | Todo | Usage tracking must be enabled and have log entries; seed via e2e setup |

**Step 4 -- Documentation**

| # | Task | Status | Notes |
|---|------|--------|-------|
| 16D.14 | Add analytics section to `README.md` | Todo | |
| 16D.15 | Update `docs/solution-design.md` -- add usage log table and analytics page to architecture | Todo | |
| 16D.16 | Update `CLAUDE.md` -- note new `cerefox_config` and `cerefox_usage_log` tables | Todo | |

**Deliverable**: Users can visualize Cerefox usage patterns with filterable charts. Usage
tracking is opt-in and controllable from the web UI. CSV export available for offline
analysis. Placeholder cards reserve layout space for word cloud and HEB visualizations
in a future iteration.

---

## Current Focus

**Iteration 15 complete.** Planning iteration 16.

**Iteration 15 shipped:**
- Audit log (immutable, append-only) with cerefox_create_audit_entry and cerefox_list_audit_entries RPCs
- New cerefox-get-audit-log Edge Function + cerefox_get_audit_log MCP tool (7 Edge Functions, 6 MCP tools total)
- Review status (approved/pending_review) with auto-transition based on author_type
- Version archival (archived flag protects from cleanup)
- Version diff viewer (unified)
- Review status filter on search (docs mode)
- Audit log shows document titles (SQL join in RPC)
- Author pass-through: MCP agents can set their name via author parameter
- Author/author_type wired through all access paths (web UI, MCP, Edge Functions)
- Upgrading guide with links from README and quickstart
- All 391 unit tests + 9 UI e2e tests pass

**Iteration 16 branches and order:**
1. `feat/mcp-consolidation` -- implement 16A (MCP refactor); merge first; no DB changes
2. `feat/metadata-search` -- implement 16B; can be developed in parallel with 16A but
   **must merge after 16A** (16B.10–16B.13 wire new tools into the refactored cerefox-mcp)
3. `feat/usage-analytics` -- implement 16C then 16D; start after 16A is merged (16C wires
   logging into the refactored cerefox-mcp tool handlers)
