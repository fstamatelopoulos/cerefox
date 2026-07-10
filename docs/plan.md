# Cerefox Implementation Plan

> **What this doc is — read this first.** `plan.md` is the project's primary
> **cross-session hand-off artifact** and high-level progress record. Its main
> consumer is the *next* AI dev session (and any human adopter following along):
> read it to understand where the project is and what's next *before* touching
> code. It tracks history and progress at a higher level than git — the "why"
> and "what next", not every commit.
>
> **How to use it:**
> - **Read [`## Current Focus`](#current-focus) (at the very bottom) first.** It is
>   the live status + what's next. Everything above it is the dated iteration log
>   — newest work appended over time — kept as the high-level history record.
> - **Keep it current — this is non-negotiable.** Whenever work starts, completes,
>   or is re-scoped, update the relevant iteration entry **and** the `Current Focus`
>   block in the same session. A stale `plan.md` silently breaks the next session's
>   hand-off; treat updating it as part of finishing the work, not an afterthought.
> - **It is not the changelog.** Release-by-release notes live in
>   [`CHANGELOG.md`](../CHANGELOG.md); design rationale lives in `docs/specs/`.
>   Link those rather than duplicating them here (duplicates rot).
>
> **Approach**: iterative and agile — each iteration delivers working functionality.

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
   `docs/research/v0.7-manual-test-plan.md` covering happy paths, error paths, and
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
| 23C.1 | Port `cerefox ingest <path>` (file mode) | Done | Reads file via `node:fs.readFileSync`, derives title from basename when `--title` omitted, builds args matching the shared `ingestTool.handler` schema. **Refinement vs plan**: calls the shared `ingestTool.handler` from `_shared/mcp-tools/` directly rather than POSTing to the EF — the MCP server already does this, and routing through the EF would be a needless extra hop. Same chunking + embedding + RPC path that MCP uses. Identity-flag resolution via `resolveAuthor` / `resolveAuthorType`; emits ⚠ when no identity provided. |
| 23C.2 | Port `cerefox ingest --paste` (stdin mode) | Done | Reads stdin via async iterator; `--title` required. Empty stdin → exit 1 with clear message. All other flags from 23C.1 reused. |
| 23C.3 | Port `cerefox ingest-dir <dir>` (batch) | Done | Recursive `walk()` using `node:fs.statSync`/`readdirSync`. `cli-progress` SingleBar shown only when stdout is a TTY (suppressed in CI / pipes). Fails-soft per file: continues on errors, prints a summary table at the end. If every file failed → exit 2. `--extensions` defaults to `.md,.txt`. |
| 23C.4 | Port `cerefox delete-doc <document-id>` | Done | Calls `cerefox_delete_document` RPC (soft-delete only; matches Python). Looks up the doc first to print title + size before the prompt; bogus UUID → exit 3 with no prompt. Already-deleted doc → idempotent no-op with informational message. **Surfaced during smoke test**: the RPC is `cerefox_delete_document`, not `cerefox_soft_delete_document` — fixed before commit. `--reason` flag accepted but printed informationally only (the RPC doesn't take a reason parameter). |
| 23C.5 | E2E test suite for write commands | Done | `packages/memory/test/write-commands.test.ts` — 7 live tests: ingest paste happy path, ingest title-required, ingest empty-stdin → exit 1, ingest missing-file → exit 1, full ingest + update-if-exists cycle (up-to-date detection + content-change update), ingest-dir walk + progress + summary, delete-doc bogus UUID → exit 3. Cleanup via `afterAll`. Every test doc is prefixed `[E2E v0.5-test]` so leftovers are findable. |
| 23C.6 | Re-export individual tools from `_shared/mcp-tools/index.ts` | Done | Added `ingestTool`, `searchTool`, `getDocumentTool`, etc. as named exports so the CLI's `ingest` / `delete-doc` / etc. commands can call a specific handler directly without going through `ALL_TOOLS` dispatch. Type-only `AccessPath` export also added. |
| 23C.7 | Widen `AccessPath` to include `"cli"` | Done | The existing `"remote-mcp" \| "local-mcp"` union now includes `"cli"`, matching what Python ingestion writes to `cerefox_usage_log.access_path`. `LogUsageParams.accessPath` references the union so every callsite is type-safe. **NB**: the Postgres CHECK constraint on `cerefox_usage_log.access_path` already accepts `"cli"` (from v0.3+ Python CLI usage), so no schema change needed. |

### 23D: Server + ops commands

The four "neither read nor write" commands. Most are thin shims today.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23D.1 | Port `cerefox mcp` subcommand | Done (in 23A) | Lazy-imports `buildServer()` from `../server.ts` (same factory used by the `cerefox-mcp` bin) and runs in-process. No subprocess. |
| 23D.2 | `cerefox web` — explicit "not-yet" message in v0.5 | Done (in 23A) | Prints v0.6-deferred message + the `uv run cerefox web` fallback path; exit 0. Tested in cli-smoke. |
| 23D.3 | Port `cerefox backup` (JSON snapshot) | Done | Faithful port of `src/cerefox/backup/fs_backup.py:FileSystemBackup.create()`. Writes `cerefox-<utc-stamp>[-label].json` under `--output-dir` (default `~/.cerefox/backups`). Includes docs + chunks (with embeddings); excludes `version_id IS NOT NULL` archived chunks per the "current state only" semantics. **Deferred to follow-up**: `--git` commit support and `--include-versions` archived-chunk inclusion (CLI flags accept them but print ⚠ pointing at `uv run` for now). Progress indicator on stderr in TTY mode. |
| 23D.4 | Port `cerefox restore <snapshot>` | Done | Reads a JSON backup file (or picks the most recent in a directory by mtime). Inserts docs + chunks via the Data API, idempotent by `content_hash`. `--dry-run` shows the would-restore count without writing. Per-doc fail-soft with end-of-run summary; any errors → exit 2. |
| 23D.5 | Port `cerefox sync-docs` | Done | Walks the CWD's `docs/` + the 3 root-level docs (README, AGENT_GUIDE, AGENT_QUICK_REFERENCE) and ingests each via the shared `ingestTool.handler` with `update_if_exists=true`. `--project` defaults to `cerefox`. `--dry-run` lists targets without writing. Same ingest path as v0.3.0's `scripts/sync_docs.ts` so behavior is unchanged. |
| 23D.6 | Port `cerefox docs [topic]` | Done | New `packages/memory/src/cli/util/bundled-docs.ts` resolves the docs dir (either inside the npm package or repo-root when running from source via package.json `name` walk-up). `--list` shows topics; positional `<topic>` opens in the platform browser (`open`/`xdg-open`/`start`); `--print` writes to stdout. Bundled docs that ship with the npm package are configured via the `files` array in `packages/memory/package.json` — Part 23F+23I follow up. |
| 23D.7 | `cerefox reindex` — defer to v0.7 message | Done (in 23A) | Same pattern as `web`. Tested in cli-smoke. |
| 23D.8 | `cerefox config-get <key>` / `cerefox config-set <key> <value>` ports | Done | Both call `cerefox_get_config(p_key)` / `cerefox_set_config(p_key, p_value)` RPCs. `config-get --json` emits `{key, value}`. `config-set` errors point at the server-side allowlist for typos. |

### 23E: New lifecycle commands

The six brand-new commands. `init` is the headline. `doctor` is the second-most-visible.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23E.1 | `cerefox init` — interactive bootstrap | Done | 5-step flow with `prompts` (Ctrl-C-safe wrappers in `_shared/cli-core/prompts.ts`). Validates Supabase + OpenAI before writing. Writes `.env` with chmod 0600 (POSIX). **Refinement vs original plan**: schema deploy is *not* in scope for v0.5 — the npm CLI doesn't yet have the Postgres direct connection. Init prints the `uv run python scripts/db_deploy.py` command and links the relevant doc; v0.6 ports the deploy step. Self-doc ingest call is a TODO comment until Part 23F lands. Optional final step wires Claude Code or Claude Desktop via the same writer 23E.5 uses. |
| 23E.2 | `cerefox init --config <file>.json` non-interactive mode | Done | Same validation pipeline, prompts replaced by JSON-file reads. Strict schema check: `CEREFOX_SUPABASE_URL`/`CEREFOX_SUPABASE_KEY`/`OPENAI_API_KEY` required; `CEREFOX_DATABASE_URL`/`CEREFOX_AUTHOR_*` optional. |
| 23E.3 | `cerefox doctor` — diagnostic | Done | New `packages/memory/src/cli/util/checks.ts` houses 9 reusable checks (binary, runtime, version, config (mode-0600 warn), supabase, openai, schema, postgres (skipped in v0.5), mcp clients). Each returns `{name, status, detail, hint}`. Statuses include `skipped` for "deferred to v0.6" cases. `doctor --json` emits the full array; human mode renders a coloured-symbol-per-row table. Exit 1 iff any `error`; warns / skipped don't fail. **Refinement vs original plan**: schema-version check no longer asserts `deployed === installed` — those ratchet independently, and the v0.3.0 schema-mismatch banner is a UI concern, not a doctor concern. |
| 23E.4 | `cerefox status` — quick sanity | Done | Three checks: version + config + supabase. Skips OpenAI + schema + MCP-config probes for speed. Tested live: completes in < 200ms on the maintainer's machine. |
| 23E.5 | `cerefox configure-agent --tool <client>` | Done | New `packages/memory/src/cli/util/mcp-config-writers.ts` houses the per-client config writers (Claude Code + Claude Desktop in v0.5 Phase 1). Each writer: reads existing config → backs up to `<file>.pre-cerefox.bak` → merges (preserves other `mcpServers` entries) → writes back. `--dry-run` prints the planned write. `--config-path` overrides the default location (used by tests). `--no-backup` suppresses the backup. Server entry uses the v0.4.1 canonical spelling: `npx -y --package=@cerefox/memory cerefox-mcp`. Unknown `--tool` → exit 1 with the list of supported values. |
| 23E.6 | `cerefox self-update` (+ `cerefox upgrade` alias) | Done | Detects installer by inspecting `process.argv[1]` against known prefixes (`.bun/`, `.pnpm/`, `.yarn/`, default npm). Wraps `<rt> install -g @cerefox/memory@<version>` via `child_process.spawnSync` with stdio inherit (so the user sees the runtime's progress). `--check` queries the npm registry and prints current vs target without writing. `--version` pins. `upgrade` is a first-class alias registered on the same action (per maintainer feedback during plan review). After successful upgrade, prints the `cerefox sync-self-docs` nudge — Part 23F wires the automatic call. |

### 23F: Self-doc ingest (Layer 2 of MCP discoverability)

Per design doc §10d, Layer 2: every Cerefox install gets the agent guidance ingested
automatically as part of `cerefox init`. v0.4 already shipped Layer 3
(`cerefox_get_help` MCP tool); v0.5 closes Layer 2.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23F.1 | Bundle `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`, and curated `docs/guides/` into the npm package | Done | New `scripts/bundle_package_docs.ts` copies 14 curated guides + the two top-level agent docs into `packages/memory/docs/` and `packages/memory/AGENT_*.md` at `prepublishOnly` time. Bundled copies are gitignored (source of truth is the repo root). `packages/memory/package.json` `files` array now lists `docs`, `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`. Curated subset excludes `docs/specs/`, `docs/research/`, `docs/plan.md` — those are contributor-internal. |
| 23F.2 | Implement `cerefox sync-self-docs` | Done | New `packages/memory/src/cli/commands/sync-self-docs.ts`. Walks bundled docs via the same `listBundledDocs()` helper that powers `cerefox docs`, ingests each via `ingestTool.handler`. Title defaults to the first `# H1` in the doc (falling back to basename). Metadata: `{type:"agent-guide", source:"cerefox-self-docs", version:"<PKG_VERSION>", source_path, topic}`. Idempotent via `update_if_exists:true`. Exports `runSyncSelfDocs(opts)` so `init` and `self-update` can call it without spawning a subprocess. |
| 23F.3 | Wire `sync-self-docs` into `cerefox init` final step | Done | `init` now dynamic-imports `runSyncSelfDocs` and calls it after writing the .env + validating credentials. Best-effort: if the ingest fails (e.g. schema not deployed yet), warn and continue. `--skip-self-docs` opts out. |
| 23F.4 | Wire `sync-self-docs` into `cerefox self-update` final step | Done | After a successful package install, self-update calls `runSyncSelfDocs` so bundled-docs ingest follows the version transition. Best-effort: failure prints a yellow ⚠ pointing at the manual `cerefox sync-self-docs` command. |
| 23F.5 | Web UI: hide `_`-prefixed projects from default listings | Done | `frontend/src/hooks/useProjects.ts` gains an `isSystemProject(name)` predicate (true when name starts with `_`) and a `useProjects({ includeSystem })` parameter (default `false`). Pages that currently call `useProjects()` get the filtered list automatically; a future `--include-system` toggle is one line of UI away. Query-key includes `includeSystem` so React Query caches both variants separately. |
| 23F.6 | Self-doc ingest live smoke | Done | Smoke-tested against the maintainer's KB by syncing into a throwaway `_e2e-v0.5-self-docs` project: 16 bundled docs detected, 16 ingest-handler calls executed, 6 documents (the ones with no pre-existing identical-title match) ended up tagged with the new `source=cerefox-self-docs` metadata. The other 10 detected pre-existing content from prior `sync_docs.ts` runs and no-op'd — expected behaviour from `ingestTool`'s content-hash dedup. Documented as a non-test smoke step in the manual test plan. |

### 23G: CLI polish

The "make it feel like a real CLI" layer. Most of these are small individually but
collectively define the v0.5 UX.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23G.1 | Tab completion generators (bash / zsh / fish) | Done | New `packages/memory/src/cli/commands/completion.ts` walks the commander tree (subcommand names + their long-form flags) and emits a per-shell script. Bash uses `compgen -W`; zsh uses the `compdef` + `_values` form; fish uses `complete -c cerefox -n '__fish_use_subcommand'` per subcommand. Flag-*value* completion (file paths, UUIDs) is deliberately out of scope for v0.5 — adds maintenance burden, doesn't pay back. |
| 23G.2 | `--json` mode uniformly on all read commands | Done | Every read command in 23B + the doctor/status commands accept `--json`. Audited via the smoke + read-commands test suites. |
| 23G.3 | Subcommand grouping in `--help` | Done | commander's `addHelpText("after", …)` appends a footer that groups all 28 commands into READS / WRITES / SERVERS / LIFECYCLE / OPS. Tested in cli-smoke. |
| 23G.4 | Documented exit codes | Done | The `--help` footer documents the four codes inline. `CliError` + `userError`/`systemError`/`notFound` helpers (Part 23A) carry typed codes; every action throws through that surface. CONTRIBUTING.md update lands in Part 23I. |
| 23G.5 | Better error messages with hints | Done | Every `CliError` carries an optional `hint`; the top-level handler in `bin/cerefox.ts` prints the hint via the `info()` cyan-ℹ formatter. Hits applied throughout 23B-23F (e.g. "Run `cerefox init`", "Run `cerefox doctor`", "Verify the API key", "Use the service-role key"). |
| 23G.6 | Bare `cerefox` (no args) — friendly entry point | Done | `bin/cerefox.ts` short-circuits when `process.argv.length === 2` to a state-aware welcome banner: detects whether `~/.cerefox/.env` exists and suggests either `cerefox init` (missing config) or `cerefox doctor` + common commands (configured). Doesn't fight commander's `--help` — `cerefox --help` still shows the full surface. |
| 23G.7 | `cerefox upgrade` first-class alias for `cerefox self-update` | Done (in 23E) | Per maintainer feedback during plan review, the alias is first-class (visible in `--help`), not hidden. |

### 23H: Python CLI deprecation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23H.1 | Add deprecation banner to `src/cerefox/cli.py` `cli()` group | Done | New `_emit_deprecation_banner()` helper inspects `sys.argv` and suppresses the banner for `--json`/`--help`/`--version`/`mcp` subcommand and when `CEREFOX_NO_DEPRECATION_BANNER` is set. Click group callback calls it once per invocation. **9 unit tests** in `tests/test_python_cli_deprecation_banner.py` cover every suppression case + happy path. |
| 23H.2 | Update `src/cerefox/mcp_server.py` (legacy fallback) | Done (no change) | The Python MCP fallback (`mcp_server.py`) is unchanged. The `mcp` subcommand suppresses the deprecation banner (so stdio MCP clients don't see ⚠ in their logs), and `_run_mcp()` already nudges the user to install `@cerefox/memory` when falling back. |
| 23H.3 | Audit Python entry points in `pyproject.toml` | Done | `cerefox` console_script still present and functional. v0.5 only deprecates; v0.8/v0.9 removes. `tests/test_cli.py`'s `runner` fixture suppresses the banner via `CEREFOX_NO_DEPRECATION_BANNER` so the broader 587 Python tests aren't impacted by the new stderr output. |

### 23I: install.sh + docs

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23I.1 | Write `install.sh` | Done | ~90 lines of POSIX sh. Detects Bun first (faster, single-binary), falls back to npm if Node ≥ 20 is present, bootstraps Bun via `curl https://bun.sh/install` if neither is available. Supports `VERSION=x.y.z sh install.sh` for pinning. Prints a next-steps banner pointing at `cerefox init` and `cerefox configure-agent`. |
| 23I.2 | Attach `install.sh` to GitHub Releases | Done | `cut_release.ts` extended to `gh release upload <tag> install.sh --clobber` right after the GitHub Release is created. Best-effort: warns if the upload fails (doesn't fail the cut). Stable URL: `https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh`. |
| 23I.3 | Write `docs/guides/migration-v0.5.md` | Done | New file covers: what changed (npm-installable CLI + 6 lifecycle commands), install paths (one-liner + direct npm/bun), what's NOT in v0.5 (web/reindex/schema-deploy deferred to v0.6/v0.7), upgrade flow for existing MCP configs (no change required), known gotchas (npx-inside-workspace, schema-version banner). |
| 23I.4 | Rewrite installing.md | Done (in README) | Folded into the README's "Quickstart" + "Prerequisites for the npm install path" sections rather than a separate file — fewer doc files to keep in sync. The migration-v0.5.md guide covers the v0.4-to-v0.5 transition.  |
| 23I.5 | Update `docs/guides/connect-agents.md` for `cerefox configure-agent` | Done | The package README + migration-v0.5.md both surface `cerefox configure-agent --tool <client>`. connect-agents.md's manual-config sections remain accurate (the configure-agent command writes the same JSON shape). A bigger restructure to "automated path is primary" lands in v0.5.x when the Phase 2 clients (Cursor / Codex / Gemini) also have configure-agent support. |
| 23I.6 | Update `README.md` for v0.5 | Done | Project status v0.4.3 → v0.5.0. Release table marks v0.5.0 as current. New "Quickstart (npm path — recommended as of v0.5.0)" section leads with the one-line install. Prerequisites split into "npm install path" (Node OR Bun + Supabase) and "Building from source / Contributors" (Python + Node + Bun). |
| 23I.7 | Update `CLAUDE.md` Project Structure | Done | `packages/memory/` tree expanded to show `bin/cerefox.ts`, `cli/program.ts`, `cli/commands/`, `cli/util/`, `meta.ts`, and the new test files. `_shared/cli-core/` listed under `_shared/`. |
| 23I.8 | Update `CONTRIBUTING.md` Development Setup | Done | Header paragraph updated: from v0.5 the npm package contains BOTH bins; contributors still need all three runtimes. `packages/memory/` subsection expanded with the full v0.5 directory tree + the `bundle_package_docs.ts` doc-bundling step. |
| 23I.9 | Update `AGENT_GUIDE.md` and `AGENT_QUICK_REFERENCE.md` | Done | `AGENT_QUICK_REFERENCE.md` CLI fallback section now leads with `cerefox <subcommand>` (v0.5+ canonical) and keeps `uv run` as the legacy path. CLI mapping table updated. New `cerefox_get_help` → `cerefox docs agent-quick-reference --print` mapping added. Help bundle regenerated. |
| 23I.10 | Write `packages/memory/README.md` (npm package README) | Done | Two-bin landing card: what's in the package, install paths, first-run setup, MCP-client wiring, common commands, "why install the CLI when MCP works" rationale, links back to the GitHub repo for everything deeper. Refreshed each release. |

### 23J: Documentation + Decision Log + CHANGELOG + plan markup + release

The closing iteration step. Mirrors iter-22 Part G.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 23J.1 | CHANGELOG `[Unreleased]` populated with v0.5.0 release notes | Done | Comprehensive section: Added (CLI bin + 6 lifecycle commands + completion + help groups + bare entry + install.sh + npm README), Changed (bin block / Python deprecation / web UI filter / cut_release.ts consolidation / prepublishOnly), Deferred to v0.6/v0.7 callout, Testing summary. `cut_release.ts` will promote `[Unreleased]` → `[v0.5.0]` on cut. |
| 23J.2 | Decision Log Q2 Part 3 entry: "v0.5.0 — closing decisions from the iter-23 build" | Done | Single document update (Part 3 was at ~23K chars; v0.5 entry pushed it to 35,675 — still well under the 50K split threshold). Captures 6 design decisions worth keeping plus a meta-decision on iteration cadence: (1) reads direct-to-DB not via EF, (2) web/reindex as explicit-not-yet messages, (3) schema-version check reports-not-asserts, (4) test plan as living artifact, (5) configure-agent Phase 1 scope discipline, (6) `_`-prefixed system project convention, (7) install.sh Bun-first rationale, plus the v0.4 → v0.5 same-day cadence observation. |
| 23J.3 | Mark all Iteration 23 sub-tasks with final status | Done | Every row across 23A-23J shows Done / Deferred-post-merge / Skipped with a one-line outcome note. |
| 23J.4 | Open PR for v0.5.0 | Done | Single PR per maintainer's direction (single-PR with phased commits, not split). Branch `feat/v0.5.0-ts-cli`, ~12 commits, ~60 sub-tasks landed. PR URL recorded in the closeout commit message. |
| 23J.5 | Post-merge: cut v0.5.0 | Pending (post-merge maintainer task) | `bun scripts/cut_release.ts 0.5.0 --npm-publish`. Pre-flight checks per Decision Log Q2 Part 3 procedure: `git grep -F "0.4.3" packages/ scripts/ _shared/` should be empty (or only intentional historical refs); `cd packages/memory && bun run bundle-docs && npm pack --dry-run` should emit no `bin[*]` warnings; CHANGELOG `[Unreleased]` should have real content (verified by `cut_release.ts`); `install.sh` should auto-attach to the GitHub Release. |
| 23J.6 | Post-publish verification (3-way) | Pending (post-merge maintainer task) | From `/tmp`: registry HEAD 200, `jq .bin/.version` shows both `cerefox` + `cerefox-mcp` bins + version 0.5.0, `npx -y --package=@cerefox/memory@0.5.0 cerefox --version` prints 0.5.0. Run `cerefox doctor` against a fresh install to confirm all green. Optional but recommended: walk the manual test plan (`docs/research/v0.7-manual-test-plan.md`) on the clean macOS box. |
| 23J.7 | Write `docs/research/v0.7-manual-test-plan.md` | Done | 11-section living checklist: install paths, read/write/server/ops commands, lifecycle, self-doc ingest, tab completion, polish, Python deprecation, three-way post-publish verification, edge cases. Each section has a Status line + checkboxes; marks "(automated)" for items covered by the TS test suite. Maintained per release. |

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

**Size**: **XL** (T-shirt; largest port we've done — 35 endpoints + frontend bundling + zod schemas + Phase 2 configure-agent). We've stopped using weeks/hours estimates after iter-23; the strangler-fig cadence has consistently outpaced human-scale estimates by 1-2 orders of magnitude.

**Headline items**:
- **v0.6.0 ships as a normal public release** (cut via `cut_release.ts --npm-publish`, GH Release page, npm publish). 3 ingest endpoints return 503 with a friendly toast pointing at v0.7; users have working fallbacks (`cerefox ingest file.md` via the CLI hits the EF and works fully; `uv run cerefox web` still has full ingest). v0.7 follows quickly and replaces the 503 stubs with in-process pipeline calls. Decision revised 2026-05-27: dropped the "internal milestone, no release" framing — too much added complexity (special cut flow, source-vs-npm UX divergence during the build, migration-v0.5.md gymnastics) for marginal benefit when the toast UX is good enough.
- New TS web server **inside `packages/memory/`** (`packages/memory/src/web/`) using Hono. No new npm package.
- `packages/memory/package.json` `bin` block grows by zero — `cerefox web` is a subcommand of the existing `cerefox` binary, not a separate bin entry.
- **32 of 35 `/api/v1/*` endpoints** ported with response-shape parity (zod schemas + narrow snapshot tests). 3 ingestion endpoints (`/ingest`, `/ingest/file`, `/documents/{id}/upload`) return **503 stubs** until v0.7 lands the TS ingestion pipeline — decision locked 2026-05-27 (see Cerefox Decision Log v0.6 entry).
- Frontend `dist/` **gets bundled into `@cerefox/memory` for the first time** (the v0.4.0 bundling was Python-wheel only; npm package previously had no frontend). New build step in `packages/memory/package.json`'s `prepublishOnly`.
- E2E test suite (TS port of `tests/e2e/test_api_e2e.py`) passes against the new server, probe-and-skip pattern when Supabase unreachable.
- `cerefox web` (TS) ships in v0.6 code on main but **does NOT become "the default" yet** — no Python web-specific deprecation banner. Rationale: with 503 ingestion stubs, the TS web is not yet a complete replacement; we cannot nudge users away from the fully-working Python web until v0.7's in-process ingestion lands. The existing v0.5.0 generic Python CLI deprecation banner (which points to `npm install -g @cerefox/memory` without specifically routing `cerefox web` to TS) is **unchanged** — it's safe because v0.5.4 npm's `cerefox web` itself sends users back to `uv run cerefox web`. **The Python web-specific deprecation banner is deferred to v0.7's Part 25L**, where it lands together with the in-process ingestion swap.
- Python `api/app.py` + `api/routes_api.py` kept around through v0.7.x; deprecation banner added in v0.7.0 (Part 25L); prominent in v0.8, deleted in v0.9.
- First-run UX in web UI: empty-state getting-started panel + graceful "v0.7 feature" handling when ingestion 503s.
- **Configure-agent Phase 2**: add Cursor, Codex CLI, Gemini CLI writers + the round-trip smoke test that was missing in v0.5.0–v0.5.4 (the one that would have caught the v0.5.3 wrong-path bug).
- **Update [`docs/research/v0.7-manual-test-plan.md`](research/v0.7-manual-test-plan.md)** with a v0.6.0 section covering: `cerefox web` boot smoke (both Mode 1 / Mode 2 / Mode 3 of "Local testing" below), Hono response-shape parity against FastAPI snapshots, web UI loads served from the bundled `frontend/dist/`, frontend 503 toast on ingestion endpoints, configure-agent round-trip verification. **Python web deprecation messaging is NOT in v0.6's test plan** — moves to v0.7's section per the deferred-banner decision.
- **Add v0.6 entry to Cerefox Decision Log** (Part 4 or Part 5 — check size before writing) capturing the FastAPI → Hono port decisions, zod-schemas-as-contract pattern, ingestion 503 deferral rationale, frontend bundling pattern, and any platform gotchas surfaced during the cut.

**Locked design decisions (2026-05-27, before iteration kickoff)**:

| Decision | Resolution | Rationale |
|---|---|---|
| **v0.6.0 release strategy** | **Normal public release.** Standard `cut_release.ts --npm-publish` flow. The 3 ingest endpoints return 503 with a friendly toast; the toast UX is the contract with users — explicit, points at v0.7. Decision revised 2026-05-27 after the maintainer pointed out that an "internal milestone" cut added more complexity (special cut flow, source-vs-npm UX divergence during the build, migration-v0.5.md gymnastics) than the marginal benefit of avoiding the 503 window. v0.7 follows quickly on iter-24's heels and swaps the stubs for in-process calls. | Standard release flow; no special script changes. Users see the 503 toast for ~days, not weeks. |
| **Ingestion endpoints in v0.6** | Return **503** with a clear `{"error": "Ingestion lands in v0.7", "see": "<migration-guide-url>"}` body. Frontend detects 503 and shows a "v0.7 feature" toast instead of "ingestion failed". | TS pipeline scheduled for v0.7; pulling forward would add ~6 weeks. EF-delegation alternative rejected to keep the v0.6 → v0.7 transition clean — when v0.7 ships, those three handlers swap from 503 to in-process pipeline calls. |
| **Schema deploy port** | **Stays in v0.7** (with the other `scripts/*.py` ports). | `db_deploy.py` is closer to the ingestion pipeline (writes to DB, needs direct Postgres). Decoupling from v0.6 keeps web-server work focused. |
| **Response parity test approach** | **Zod schemas in `_shared/schemas/` as the contract** (consumed by both server and frontend) + **narrow byte-snapshot tests** for ~5 critical endpoints (`/search`, `/dashboard`, `/documents/{id}`, `/audit-log`, `/version`). **HTTP-boundary tests in TS from v0.6 onward** under `packages/memory/test/web-integration/` — see design doc §19 "Test migration policy". | Matches the v0.4.0 Decision Log §6 rule: byte-snapshot only where shape really matters. Zod gives runtime + compile-time safety; snapshots catch wire-level regressions on the endpoints the frontend depends on most strongly. **Correction (2026-05-28, post-merge)**: the original framing "Python `pytest -m e2e` covers parity at the `/api/v1/*` HTTP boundary" was wrong — `tests/e2e/test_api_e2e.py` talks to Supabase directly via `CerefoxClient` and never exercises Hono routes. The v0.6 follow-up commit ports `tests/api/test_docs_endpoints.py` to `packages/memory/test/web-integration/meta.test.ts` and adds `destructive.test.ts` for the 5 mutation endpoints Part 24E shipped without HTTP-level coverage. |
| **Iteration size** | **Single iter-24, 12 Parts, one PR, one cut.** Same discipline as iter-23. | Atomic switchover from Python web to TS web. Avoids the awkward middle state where some routes are TS and some are still Python. |
| **Routing structure** | One file per endpoint group under `packages/memory/src/web/routes/` — 8 files for 35 endpoints. Mirrors `_shared/mcp-tools/` shape. | Easy to navigate, easy to PR-review. |
| **Hono `serveStatic`** | Used for `/app/*` (SPA bundle) and `/static/*` (logo/favicon). SPA catch-all returns `index.html`. Root `/` returns the existing HTML redirect page. | Built-in, runtime-neutral. |
| **Auth model** | 127.0.0.1 binding by default, no auth on `/api/v1/*`. Same as Python. | Local-only by design — Cerefox web is a personal tool, not a multi-tenant service. |
| **Dev mode** | New `--watch` flag (Bun's `--hot`). Existing `--reload` stub renamed to `--watch`. | Convention. |
| **Python web deprecation banner** | **Deferred from v0.6 to v0.7 (Part 25L)**. v0.6 does NOT add a Python web-specific deprecation banner — that would nudge users away from the fully-working Python web while the TS web still has 503 stubs. The existing v0.5.0 generic Python CLI deprecation banner (points users at `npm install -g`, doesn't specifically route `cerefox web` to TS) stays unchanged through v0.6. v0.7's Part 25L adds the Python web-specific banner at the same moment the in-process ingestion swap lands — TS web is then a complete replacement. Python `api/app.py` + `api/routes_api.py` code stays through v0.7.x, prominent deprecation in v0.8, deleted in v0.9. | Maintainer call 2026-05-27: "we cannot block users from using the Python web until the full app is fully tested." Banner timing tied to TS web being functionally complete. |
| **Configure-agent Phase 2** | Adds Cursor (direct-write to `~/.cursor/mcp.json`), Codex CLI (direct-write to `~/.codex/config.toml` — TOML, not JSON), Gemini CLI (direct-write to `~/.gemini/settings.json`). All `kind: "direct-write"` per the v0.5.4 ConfigWriter interface. | Phase 2 of the v0.5.0 design (deferred to v0.6 per iter-23 closing). |
| **Configure-agent round-trip smoke test** | Gated on `command -v claude` (skip if not installed). Spawns `claude mcp list` after `configure-agent --tool claude-code` and asserts `cerefox` appears. Needs sandboxing so it doesn't pollute the contributor's actual `~/.claude.json` — use a temp `$HOME` override via env var. | Closes the gap that let the v0.5.3 wrong-path bug ship to npm for four releases. |
| **`.env` resolution tightening (v0.5.3 leftover)** | Level-3 (legacy dev-mode) fallback in `_shared/config/paths.ts` should only match CWD `.env` files containing at least one `CEREFOX_*` key — protects against the user who runs `cerefox` from an unrelated Node project with its own `.env`. Small inline change. | Flagged in v0.5.3 decisions; v0.6 design discussion confirmed the heuristic is safe. |
| **`bundle_package_docs.ts` migration-v0.4.md removal** | Drop `migration-v0.4.md` from the bundled-docs list. By v0.6, anyone reading docs in the npm package is way past v0.4; the historical reference in git is sufficient. | Reduces noise in `cerefox docs --list`. |

**Out of scope (deferred)**:

| Item | Where it lands |
|---|---|
| `IngestionPipeline` port (3 web endpoints become functional) | v0.7 (iter-25) |
| `db_deploy.py` port (eliminates the residual Python step in `cerefox init`) | v0.7 (iter-25) |
| Standalone binaries (`pkg`/`bun build --compile`) | Phase 2 of design doc §6d — post-v0.6 |
| Full `cerefox docs` web UI integration | If demand surfaces — not in v0.6 |

**Detailed Parts breakdown** (each Part = one commit in the iter-24 PR):

> **Pre-iter step (do BEFORE Part 24A starts)**: capture Python response
> snapshots for the 5 critical endpoints (`/search`, `/dashboard`,
> `/documents/{id}`, `/audit-log`, `/version`) against the maintainer's
> live Python web + Supabase. Save as fixture files under
> `packages/memory/test/fixtures/python-parity/` (gitignored or
> committed — committed is fine; they're small). Parts 24C–24G assert
> their TS responses match these. Without this step, the parity test
> in Part 24I has nothing to compare against. Cost: ~10 minutes of
> `curl + jq` against the running Python server.

| Part | Goal | Acceptance |
|---|---|---|
| **24A — Hono scaffolding + `cerefox web` wire-up + dev-mode paths** | Minimal Hono app boots via `cerefox web`; `/api/v1/version` returns 200 with the version JSON. **Source-mode testing**: maintainer runs `bun packages/memory/src/bin/cerefox.ts web` from the repo and the server boots without `npm install -g`. **Frontend fallback**: when `packages/memory/dist/frontend/` doesn't exist (source-mode), Hono falls back to `<repo>/frontend/dist/` — same pattern Python uses (`_resolve_spa_dist` in `api/app.py`). The maintainer can `cd frontend && npm run build` once at the start of testing, then iterate on the Hono server from source without rebuilding the package. | `cerefox web` listens on 127.0.0.1:8000, `curl /api/v1/version` returns `{"version": "0.6.0", …}`. New `packages/memory/test/web-smoke.test.ts` passes (probe-and-skip pattern). Maintainer can boot the server from source via `bun packages/memory/src/bin/cerefox.ts web` and load the web UI at `http://127.0.0.1:8000/app/`. |
| **24B — Frontend bundle pipeline** | `frontend/dist/` lands inside `packages/memory/dist/frontend/` at build time. Hono serves it at `/app/*` with SPA catch-all. | `packages/memory/package.json` `prepublishOnly` runs `cd ../../frontend && npm install && npm run build && cp -R frontend/dist <package>/dist/frontend`. `npm pack --dry-run` includes `dist/frontend/index.html`. Visiting `http://127.0.0.1:8000/app/` loads the React SPA. |
| **24C — Meta + search + discovery endpoints (12 endpoints)** | `/version`, `/docs`, `/docs/{path}`, `/schema-version`, `/search`, `/projects`, `/metadata-keys`, `/dashboard`, `/projects/{id}/documents`, `/documents/trash`, `/documents/metadata-search`, `/resolve-link`. New `_shared/schemas/` module with zod schemas. | Each endpoint matches FastAPI response shape (verified by zod parse + snapshot test for `/search` and `/dashboard`). |
| **24D — Document read endpoints (5 endpoints)** | `/documents/{id}`, `/{id}/chunks`, `/{id}/versions`, `/{id}/download`, `/check-filename`. | Each endpoint passes a zod-parse test against captured FastAPI response. Snapshot test for `/documents/{id}` (most complex shape). |
| **24E — Document write endpoints (6 endpoints)** | `/edit`, DELETE, `/restore`, `/purge`, `/review-status`, `/versions/{vid}/archive`. | Each endpoint mutates the DB correctly via RPC; audit-log entries created where the Python version creates them. |
| **24F — Project CRUD + Config CRUD (5 endpoints)** | POST/PUT/DELETE `/projects`, GET/PUT `/config/{key}`. | Project create-update-delete round-trip works in the web UI. Config get/set round-trip works. |
| **24G — Audit + usage log (4 endpoints)** | `/audit-log`, `/usage-log`, `/usage-log/export.csv`, `/usage-log/summary`. CSV streaming response. | CSV download in the web UI produces a file identical to the Python version (snapshot test). |
| **24H — Ingestion 503 stubs (3 endpoints)** | `/ingest`, `/ingest/file`, `/documents/{id}/upload` return 503 with `{"error": "Ingestion lands in v0.7", "see": "<url>"}`. | curl gets the 503 with the right body. Frontend detects this and shows a "v0.7 feature" toast in the web UI (no crash). |
| **24I — Parity snapshot tests** | The 5 captured Python response fixtures (from the pre-iter step) become snapshot tests. Each TS endpoint's response must match its captured fixture (zod-parse + byte-snapshot). **No TS e2e port** — the Python `pytest -m e2e` suite already covers live Supabase validation; duplicating it in TS just to skip in CI is wasted effort. Live e2e validation moves to the manual test plan (Part 24L). | All 5 snapshot tests pass in CI without Supabase. Maintainer runs Python e2e (`uv run pytest -m e2e`) against the running TS server during the manual test plan walk — Python tests hit `/api/v1/*` via HTTP, so they're server-implementation-agnostic. |
| **24J — Frontend 503 toast handling** | Frontend detects 503 from the 3 ingest endpoints and shows a user-facing toast pointing at v0.7. **No empty-state panel work** — the current Dashboard (zeros + empty tables on a fresh KB) is sufficient; richer welcome UX would be a separate task. | Triggering ingest in the web UI (any of the 3 paths: paste, file upload, document replace) shows "Ingestion lands in v0.7 — use `cerefox ingest file.md` from the CLI for now" toast. No crash, no scary error. |
| **24K — Configure-agent Phase 2 + round-trip smoke test** | Cursor (JSON) + Codex (**TOML — extends ConfigWriter to support file format per risk R1**) + Gemini (JSON) writers added. `--tool claude-code` round-trip smoke test (gated on `command -v claude`) — spawn `claude mcp list` after configure-agent + assert `cerefox` appears. **Verify `$HOME` override actually sandboxes `claude mcp add` per risk R2** before committing the test; fall back to "local-only, manual test plan only" if sandboxing isn't reliable. Also: tighten level-3 `.env` heuristic to require `CEREFOX_*` keys + drop `migration-v0.4.md` from `bundle_package_docs.ts`. | `cerefox configure-agent --tool cursor` writes the expected JSON. `--tool codex` writes the expected TOML (verified by parsing back). `--tool gemini` writes the expected JSON. Round-trip test passes when Claude Code is installed (CI: skips). |
| **24L — Closeout (standard release cut)** | Update `CHANGELOG.md` (v0.6.0 entry — standard format, calls out the 3 ingest endpoints' 503 behavior + v0.7 timeline). Add a v0.6 section to `docs/guides/migration-v0.5.md` explaining the 503 toast + the working fallbacks (`cerefox ingest` CLI, `uv run cerefox web` Python). Update `docs/research/v0.7-manual-test-plan.md` with the v0.6 section (per the pre-existing iter-24 deliverable). Decision Log v0.6 entry (Part 4 or Part 5 — check size before writing). **No Python web deprecation banner** — deferred to v0.7 Part 25L per the locked decision. Cut v0.6.0 with **`cut_release.ts --npm-publish`** (standard flow). | PR ready for review; CI green; CHANGELOG complete; Decision Log entry ingested; `v0.6.0` git tag present; npm registry shows v0.6.0; manual test plan walked. |

**Local testing during the build (no `npm install` needed)**:

The maintainer can iterate on the v0.6 code without going through the npm install
path. Three modes:

```bash
# Mode 1 — Source mode (recommended for active iteration)
# Run the bin directly from source via Bun. No build step needed; Bun TS-loads
# the source. Hot reload available with --watch (Bun's --hot).
bun packages/memory/src/bin/cerefox.ts web --port 8000
bun packages/memory/src/bin/cerefox.ts web --watch    # hot-reload on file changes

# Mode 2 — Built mode (catches packaging-stage issues)
# Build first, then run the bundled output via Node. Mirrors what npm-installed
# users see.
cd packages/memory && bun run build
node packages/memory/dist/bin/cerefox.js web --port 8000

# Mode 3 — Mixed (server from source, frontend from built dist)
# Build the frontend once, then iterate on the Hono server from source. Hono's
# static-file fallback (see Part 24A acceptance) finds <repo>/frontend/dist/
# when packages/memory/dist/frontend/ doesn't exist.
cd frontend && npm install && npm run build && cd ..
bun packages/memory/src/bin/cerefox.ts web   # picks up <repo>/frontend/dist/
```

For E2E tests during the build: `cd packages/memory && bun test web-smoke.test.ts`
(probe-and-skip when Supabase unreachable, same pattern as `stdio-smoke.test.ts`).

**Critical files / directories created in iter-24**:
- `packages/memory/src/web/` — new directory housing the Hono server
  - `web/server.ts` — Hono app factory `buildWebServer({ port, host })`
  - `web/static.ts` — `serveStatic` middleware + SPA catch-all
  - `web/routes/meta.ts` (4 endpoints: `/version`, `/docs`, `/docs/{path}`, `/schema-version`)
  - `web/routes/discovery.ts` (6 endpoints: `/search`, `/metadata-keys`, `/dashboard`, `/documents/trash`, `/documents/metadata-search`, `/resolve-link` — search-as-discovery is intentional naming so the file has a single coherent purpose)
  - `web/routes/documents-read.ts` (5 endpoints: `/documents/{id}`, `/chunks`, `/versions`, `/download`, `/check-filename`)
  - `web/routes/documents-write.ts` (6 endpoints: `/edit`, DELETE, `/restore`, `/purge`, `/review-status`, `/versions/{vid}/archive`)
  - `web/routes/ingest.ts` (3 endpoints — 503 stubs)
  - `web/routes/projects.ts` (5 endpoints: GET (list), GET `/{id}/documents`, POST, PUT, DELETE — read + CRUD together)
  - `web/routes/audit-usage.ts` (4 endpoints: `/audit-log`, `/usage-log`, `/usage-log/export.csv`, `/usage-log/summary`)
  - `web/routes/config.ts` (2 endpoints: GET / PUT `/config/{key}`)
  - **Total: 35 endpoints across 8 files** — confirmed sum
- `_shared/schemas/` — new directory
  - `_shared/schemas/index.ts`
  - One file per response group, mirroring the routes structure
- `packages/memory/test/web-smoke.test.ts` — boot + first-route smoke
- `packages/memory/test/fixtures/python-parity/` — captured Python response snapshots for the 5 critical endpoints (committed; small)
- `packages/memory/dist/frontend/` — built React SPA (gitignored; built by `prepublishOnly`)

**Files modified**:
- `packages/memory/package.json` — add `hono` dep; update `scripts.build` and `prepublishOnly`; add `dist/frontend` to `files`
- `packages/memory/src/cli/commands/web.ts` — replace v0.5 stub with `import { buildWebServer } from '../../web/server.ts'` etc.
- `packages/memory/src/cli/util/mcp-config-writers.ts` — add Cursor / Codex / Gemini writers (Phase 2)
- `_shared/config/paths.ts` — level-3 heuristic: only match CWD `.env` containing `CEREFOX_*`
- `scripts/bundle_package_docs.ts` — drop `migration-v0.4.md`
- `frontend/src/api/*.ts` — import response types from `_shared/schemas/` instead of duplicating
- `frontend/src/api/ingest.ts` (or equivalent) — detect 503 from `/ingest`, `/ingest/file`, `/documents/{id}/upload`; surface a Mantine toast pointing at v0.7

**Known risks / questions that need resolution DURING the build** (raised in the pre-kickoff review pass on 2026-05-27; resolve in the Part where they bite):

| # | Risk / open question | Resolves in | Default plan |
|---|---|---|---|
| R1 | **Codex CLI config is TOML, not JSON.** The locked decision says "all `kind: direct-write` per v0.5.4 ConfigWriter", but that interface assumes JSON parse/serialize. | Part 24K | Add a TOML dep (`smol-toml` or `@iarna/toml`) and extend `ConfigWriter` to know its file format (`format: "json" \| "toml"`). +30 LOC + 1 dep. **Verify in Part 24K** whether OpenAI's Codex CLI has a `codex mcp add` command (would let us delegate like Claude Code); if yes, prefer delegation. |
| R2 | **Configure-agent round-trip smoke test sandboxing isn't verified.** Plan says "use `$HOME` override via env var", but `claude mcp add` may not respect `$HOME`. | Part 24K | Verify $HOME respect FIRST. If it doesn't respect: fall back to "test runs locally only, skip in CI; explicit step in the manual test plan". Do NOT pollute the contributor's real `~/.claude.json`. |
| R3 | **`_shared/schemas/` consumption by frontend.** Vite (frontend's bundler) needs to resolve imports from a sibling workspace. | Part 24C | Add a `resolve.alias` entry in `frontend/vite.config.ts` pointing `@cerefox/schemas` → `../_shared/schemas/`. Verify TS+Vite agree on the path. |
| R4 | **CSV streaming response in Hono on Bun.** `/usage-log/export.csv` uses FastAPI `StreamingResponse`. Hono + Bun should support `c.body(ReadableStream)`, but not exercised in our codebase yet. | Part 24G | Smoke test early in Part 24G with a small CSV (10 rows). If streaming doesn't work, buffer the whole CSV in memory — fine at personal-KB scale. |
| R5 | **SPA catch-all route ordering.** Hono middleware order matters; `/app/*` catch-all must NOT shadow `/app/assets/*` static. | Part 24A | Document the order explicitly in `web/server.ts`: (1) `/api/v1/*` → routes, (2) `/static/*` → serveStatic, (3) `/app/assets/*` → serveStatic Vite hashed assets, (4) `/app/*` → catch-all returns `index.html`, (5) `/` → HTML redirect page. Test by curling `/app/assets/index-abc123.js` and asserting Content-Type is `application/javascript` not `text/html`. |
| ~~R6~~ | ~~`release.yml` trigger semantics~~ | **Resolved 2026-05-27** | Maintainer confirmed: `release.yml` is `workflow_dispatch` only — no action needed. |
| R7 | **Zod schema enforcement level.** Are we adding runtime `.parse()` at endpoint exit (slower but stricter) or just using zod for compile-time types (faster but drift-prone)? | Part 24C | Default: parse in dev mode (`NODE_ENV !== 'production'`), skip in production. ~1-2ms per request in dev, near-zero in prod. |
| ~~R8~~ | ~~First-run empty-state panel scope~~ | **Resolved 2026-05-27** | Maintainer dropped from v0.6 scope — current Dashboard (zeros + empty tables) is sufficient. |
| ~~R9~~ | ~~Effort estimate is a guess~~ | **Resolved 2026-05-27** | Replaced per-iteration "X weeks part-time" estimates with T-shirt sizes (S/M/L/XL/XXL). Maintainer's note: previous iterations have taken at most a couple of hours of AI-paired session time, so human-weeks estimates are misleading. |

**For a fresh-session pickup**: this iter-24 design is self-contained. Read this section + the v0.5.3/v0.5.4 Decision Log entries in Q2 Part 3 and Part 4 + the design doc `docs/specs/polish-and-distribution-design.md` §13 v0.6.0 (which is the abstract framing). All locked decisions are documented above; the table of known risks (R1–R9) lists what still needs resolution during the build, with default plans for each. Nothing needs re-deciding before code starts; the risks are flagged for resolution in their specific Parts.

---

## Iteration 25: v0.7.0 — "TS Ingestion Pipeline" (last big Python component)

**Goal**: Migrate chunking + embedding orchestration + version snapshotting to TS. PDF and
DOCX support **dropped** (never used; not worth porting). **Ingestion code lands inside
`packages/memory/`** (under `_shared/ingest/` since the same modules are also used by the
Edge Functions). No new npm package.

**Design**: [`docs/specs/polish-and-distribution-design.md` §13 v0.7.0](specs/polish-and-distribution-design.md)
(see the "Living design notes" callout at the top of that file for the
consolidated single-package model).

**Size**: **XL** (T-shirt). Chunking byte-parity is the critical risk — must produce byte-identical chunks for the same input as the Python pipeline (locked) so existing corpus stays valid without re-embed.

**Headline items**:
- **Completes the v0.6 TS web** by swapping the 3 ingest endpoints' 503 stubs for in-process pipeline calls. Same wire shape; no frontend changes (the `V07IngestionDeferredError` toast just stops firing because no more 503s — detector code stays as a no-op).
- **`migration-v0.5.md` gets a v0.7 section** explaining the ingestion-swap + the deprecation-banner timing.
- **Python web-specific deprecation banner** lands in v0.7's Part 25L (deferred from iter-24 per maintainer call 2026-05-27). Banner appears at the same commit that completes the in-process ingestion swap, so TS web is functionally complete the moment users see "switch to npm." The v0.5.0 generic Python CLI deprecation banner stays unchanged.
- **New `_shared/ingest/` directory**: `chunker.ts`, `embedder.ts` (or extended `_shared/embeddings/`), `pipeline-helpers.ts` (normalize + hash + project-id resolver). Consumed by `packages/memory/src/ingestion/pipeline.ts` (the TS port of the Python pipeline). **NOT consumed by the `cerefox-ingest` Edge Function** — Deno Edge Runtime can't import from the monorepo's `_shared/`; the EF keeps its own chunker copy. Cross-runtime parity enforced by shared fixture tests at the EF / TS-CLI / Python level (locked decision below).
- **New TS ingestion pipeline** at `packages/memory/src/ingestion/pipeline.ts` calling `cerefox_ingest_document` RPC. Implements the same 4 public methods as Python (`ingestText`, `updateDocument`, `ingestFile`, `ingestDir`) with byte-parity for content hashing + chunk boundaries.
- **`cerefox ingest` and `cerefox ingest-dir`** invoke the TS pipeline in-process (no shell-out, no EF round-trip).
- **PDF/DOCX support dropped**: `src/cerefox/chunking/converters.py` + `tests/chunking/test_converters.py` deleted; CHANGELOG announces removal.
- **Remaining `scripts/*.py` ported** per §12f script-language policy: `db_deploy.py`, `db_migrate.py`, `backup_create.py`, `backup_restore.py`, `reindex_all.py`. Python originals become 1-line husks pointing at the TS equivalents (matches v0.5's `cerefox`-CLI deprecation pattern).
- **Unit-test migration** (per design doc §19): port `tests/chunking/`, `tests/embeddings/`, `tests/ingestion/`, `tests/retrieval/`, `tests/db/test_versioning.py`, `tests/db/test_audit_and_governance.py` alongside their code. **`tests/test_db_client.py` STAYS in pytest** — `CerefoxClient` itself stays in Python through v0.9+ for the Python MCP server (per the 2026-05-28 Python-minimization policy clarification). Coverage matrix produced in the iter-25 design pass confirms MCP-only ↔ ingestion-only methods don't overlap.
- **HTTP-boundary tests for the 3 unblocked ingest endpoints** at `packages/memory/test/web-integration/ingest.test.ts`. Probe-and-skip + self-cleaning shape, same as the v0.6 `destructive.test.ts`.
- **Update [`docs/research/v0.7-manual-test-plan.md`](research/v0.7-manual-test-plan.md)** with a v0.7.0 § 13 covering: chunking byte-parity vs Python pipeline, embedding round-trip + cosine-similarity sanity, `cerefox ingest` end-to-end on a real repo, schema-deploy via the new `db_deploy.ts`, EF-vs-TS-CLI chunker parity smoke (any random markdown ingested via both paths produces the same content_hash + chunk boundaries).
- **v0.7 entry in Cerefox Decision Log** capturing the chunking-parity strategy, EF-divergence acceptance, Postgres client choice, scripts-as-husks pattern, any platform gotchas surfaced during the cut.

**Locked design decisions (2026-05-28, pre-iter-25 design pass)**:

| Decision | Resolution | Rationale |
|---|---|---|
| **`_shared/ingest/` structure** | New dir under `_shared/` with `chunker.ts` + `embedder.ts` (extends existing `_shared/embeddings/`) + `pipeline-helpers.ts` (normalize / hash / resolveProjectIds) + `types.ts`. Pipeline itself at `packages/memory/src/ingestion/pipeline.ts`. | Chunker + embedder reusable across TS surfaces (web, CLI, future MCP write-path). Pipeline is consumer-specific. |
| **`cerefox-ingest` EF chunker** | EF keeps its own chunker copy. Deno Edge Runtime can't import from the monorepo's `_shared/`. Refactor to shared-via-import-maps is overkill for v0.7 scope. | Per iter-25 design pass investigation: EF's `index.ts` has no `_shared/` imports today; the chunker is copy-pasted from Python's. Accept divergence + enforce parity via tests. |
| **Chunking parity strategy** | **Byte-identical** chunks across Python + TS + EF for the same input. Verified by cross-runtime fixture tests (Python output → captured fixture → TS chunker + EF chunker both assert structural equality). | Existing corpus was chunked by Python; any drift requires re-embed (cost + time). Byte-identical preserves the existing chunk rows. |
| **`content_hash` algorithm** | Same `normalize` (CRLF→LF + strip + collapse `\n{3,}`) + SHA-256 across all three runtimes. Promote v0.6's inline `normalizeForHash` (in `documents-write.ts`) into `_shared/ingest/pipeline-helpers.ts` so there's one source of truth. | Already in production for v0.6's `/edit` short-circuit; dedup parity demands identical hashing. |
| **Embedding batch size** | TS port adopts Python's 96-chunks-per-API-call limit. Extend `_shared/embeddings/embedBatch()` with a `batchSize` param (default 96) and chunk-then-flatten the input. | OpenAI accepts 2048; 96 is the Python contract; bulk ingest of large docs would otherwise blow per-request limits. |
| **Postgres client for TS scripts** | `postgres` (Porsager) — small, well-typed, no native deps, runs on Node + Bun. Used by `db_deploy.ts` + `db_migrate.ts`. Rejected: `bun:sql` (Bun-only, locks scripts to Bun); `pg` (heavier, native deps). | Cross-runtime, small footprint, active maintenance. |
| **`scripts/*.py` keep-or-remove** | Each Python script becomes a husk: prints "Use `bun scripts/<name>.ts`" + exits 0. Mirrors v0.5.0's `cerefox-CLI` deprecation pattern. | Existing users with muscle memory get a clear pointer; no silent breakage. Eventual deletion: v0.9 per the Python-minimization policy. |
| **Python `IngestionPipeline` retention** | `src/cerefox/ingestion/pipeline.py` stays through v0.7.x as a callable module (Python MCP doesn't use it — see coverage matrix below — but `routes_api.py`'s `/edit` and `/upload` still do during the husk phase). v0.8 deprecation banner + husk; v0.9 deleted. | Python MCP↔pipeline overlap is **zero** per the iter-25 coverage matrix; pipeline can disappear before MCP does. |
| **Python web (`api/`) retention** | `api/app.py` + `api/routes_api.py` stay through v0.7. Deprecation banner lands in Part 25L. v0.8 → husk (each route returns 503 + "use `cerefox web` from npm"). v0.9 → keep husk or delete (TBD by iter-26 design pass). | Pre-locked in iter-24 design pass. |
| **Test migration scope (v0.7)** | Port: `tests/chunking/`, `tests/embeddings/`, `tests/ingestion/`, `tests/retrieval/`, `tests/db/test_versioning.py`, `tests/db/test_audit_and_governance.py`. NEW: `packages/memory/test/web-integration/ingest.test.ts`. **Don't port `tests/test_db_client.py`** — CerefoxClient stays in Python (MCP needs it); tests stay in pytest until v0.9. | Per design doc §19 "Test migration policy": tests follow code; if code stays, tests stay. |
| **PDF/DOCX support** | Dropped. `chunking/converters.py` + `tests/chunking/test_converters.py` deleted. CLI / web / EF all reject non-markdown inputs going forward. | Locked in iter-24 headlines; never used in practice; conversion adds dependencies for a feature no one asked for. |
| **`/ingest` endpoint cutover** | **Atomic in Part 25F**: all 3 endpoints (`/ingest`, `/ingest/file`, `/documents/{id}/upload`) swap from 503 stub to real handler in the same commit. The `/edit` content-change branch (also 503 in v0.6) swaps in 25E alongside the pipeline's `updateDocument` path. Frontend's `V07IngestionDeferredError` toast detector stays in place; just stops firing. | No partial state where 1 endpoint works and 2 don't. Detector stays = no frontend churn = easier rollback if needed. |
| **Audit entry on metadata-only updates** | TS pipeline creates the `update-metadata` audit entry **client-side** (after the DB update), matching Python's `update_document()` path. The `cerefox_ingest_document` RPC only emits `create` / `update-content` entries. Easy to forget in the TS port — explicit in 25E acceptance. | Per Python coverage; missing the entry means `update-metadata` operations silently disappear from audit log. |
| **Pre-iter step** | Capture Python chunker output for 8-10 diverse markdown fixtures + Python embedder output for a known input. Save under `packages/memory/test/fixtures/python-parity/chunking/` (and `embedding/`). Parts 25A and 25B assert byte-identical (and cosine-equivalent, within 1e-6) TS output. | Mirrors iter-24's pre-iter Python-parity capture pattern. ~10 minutes of `uv run python -c "..."` + `jq`. |

**Out of scope (deferred)**:

| Item | Where it lands |
|---|---|
| Python MCP server port to TS | v0.9 (subprocess-pattern tests for the surviving Python MCP) |
| Python `CerefoxClient` removal | v0.9 (or post-v1.0 — its MCP-only methods stay as long as the Python MCP does) |
| EF chunker shared-module refactor | post-v0.7 (would require import-maps + Supabase function changes; not worth it for one EF) |
| `tests/test_cli.py` + `tests/test_mcp_server.py` migration | v0.9 (subprocess pattern; per design doc §19 row 6) |
| Standalone binaries (`bun build --compile`) | post-v0.7 per design doc §6d |

**Detailed Parts breakdown** (each Part = one commit in the iter-25 PR):

> **Pre-iter step (do BEFORE Part 25A starts)**: capture Python chunker output for ~10 diverse markdown fixtures (varied: short / long / heavy-headings / no-headings / oversized-section / CRLF endings / unicode / empty / single-paragraph / heading-only) and a single Python embedder output for a known reference text. Save under `packages/memory/test/fixtures/python-parity/chunking/*.json` + `embedding/<seed>.json`. Without these, Parts 25A and 25B have no baseline to assert byte-parity against. Cost: ~15 minutes of `uv run python -c …`.

| Part | Goal | Acceptance |
|---|---|---|
| **25A** | `_shared/ingest/chunker.ts` — TS port of `chunking/markdown.py`. Cross-runtime parity tests against the captured fixtures (Python → TS) and against the EF chunker (TS → EF). | TS chunker produces byte-identical chunks (same indexes, content, heading_path, heading_level, char_count) to Python for every fixture. EF chunker fixture parity recorded for monitoring (no enforcement; EF stays independent). |
| **25B** | `_shared/ingest/embedder.ts` — extend `_shared/embeddings/embedBatch()` with 96-chunk batching. Verify cosine match against the captured Python embedding fixture (within 1e-6). | Batch limit at 96; cosine similarity assertions pass against the fixture. Existing v0.4 embedding tests still pass. |
| **25C** | `packages/memory/src/ingestion/pipeline.ts` — IngestionPipeline class scaffolding: constructor, types (`IngestResult`, `IngestOptions`), helpers (`normalize`, `hash`, `resolveProjectIds`). No live RPC calls yet. `_shared/ingest/pipeline-helpers.ts` holds the cross-consumer helpers; `documents-write.ts` switches to import from there. | Pipeline file compiles; helpers exported; v0.6's `/edit` SHA short-circuit migrates to the shared helper (no behavior change). |
| **25D** | Pipeline `ingestText` path: create + skip-by-content-hash + project assignment (singular non-destructive + list full-set semantics per issue #38). Live tests cover all three outcomes. | `cerefox ingest <new-file>` creates a doc; ingesting same content again returns skipped=true; ingesting with `--project-name` / `--project-names` produces the expected M2M state. |
| **25E** | Pipeline `updateDocument` path: 3 sub-paths (content unchanged + title change → re-embed; content changed → snapshot + re-chunk; metadata-only → no chunk work + `update-metadata` audit entry). Wire `/edit` content-change branch from 503 to in-process. | Live tests for all 3 sub-paths; `/edit` with new content now succeeds (no more 503); audit log entries match Python's shape (`update-content` from RPC; `update-metadata` client-side). |
| **25F** | Swap the 3 web ingest endpoints' 503 stubs for real handlers calling `pipeline.ingestText` / `updateDocument` / file-upload-then-`updateDocument`. Update `packages/memory/test/web-integration/ingest.test.ts` (new file) with end-to-end smokes. | curl POST `/ingest` creates a real doc; `/ingest/file` parses multipart upload; `/documents/{id}/upload` replaces content. Frontend Mantine toast (`V07IngestionDeferredError`) stops firing — code stays in place as dead branch. |
| **25G** | TS port of `cerefox ingest` + `cerefox ingest-dir` CLI commands. Invoke the in-process pipeline (no shell-out to EF, no shell-out to Python). Python `cli.py` ingest commands stay live but get a `⚠ This command runs in-process via the npm package; from a checkout, prefer `cerefox ingest …` (TS)` deprecation hint (matches v0.5 deprecation banner pattern). | `cerefox ingest <file>` works on an npm-installed Cerefox without internet round-trip to the EF. `cli-smoke.test.ts` updated. |
| **25H** | `scripts/db_deploy.ts` + `scripts/db_migrate.ts` — Postgres client via `postgres` (Porsager); load `src/cerefox/db/schema.sql` + `rpcs.sql` + `migrations/*.sql` via filesystem (the SQL files stay where they are). `--dry-run`, `--reset`, `--status` flags preserved. Python originals → 1-line husks. | `bun scripts/db_deploy.ts --dry-run` prints the planned SQL; `--reset` prompts then deploys; `bun scripts/db_migrate.ts --status` lists pending. End-to-end run on a fresh test Supabase project succeeds. |
| **25I** | `scripts/backup_create.ts` + `scripts/backup_restore.ts` + `scripts/reindex_all.ts`. `_shared/db-client/` grows the methods needed (`list_all_documents_basic`, `list_all_chunks`, etc.). Python originals → husks. | Round-trip: `backup_create` → modify DB → `backup_restore` → state matches. `reindex_all` re-embeds chunks via the new TS pipeline (or delegates to the v0.7-ported `cerefox reindex` if that's where the logic lives — TBD in 25I). |
| **25J** | Test migration: port the 6 Python test files listed in the policy table. Delete the corresponding `tests/*.py` files. Add `packages/memory/test/web-integration/ingest.test.ts`. Run both suites in CI; pytest collection drops to ~470 tests (down from 575). | All ported tests pass in `bun test`. `pytest --collect-only` confirms only the surviving Python test files remain. CI green on both runners. |
| **25K** | Python web deprecation banner: `api/app.py` adds a startup banner ("`uv run cerefox web` is deprecated; the canonical web is `cerefox web` from `@cerefox/memory`. This Python web becomes a husk in v0.8 and may be removed in v0.9 — see `docs/guides/migration-v0.5.md` § v0.7"). Also PDF/DOCX removal: delete `chunking/converters.py` + `tests/chunking/test_converters.py`; CHANGELOG bullet announces removal. | `uv run cerefox web` boots and prints the banner once. PDF/DOCX paths return 400 with a clear message ("Markdown only; convert client-side"). |
| **25L** | Closeout: CHANGELOG v0.7.0 entry; `migration-v0.5.md` v0.7 section (covers ingestion-swap + Python web deprecation banner + scripts husk pattern); `v0.7-manual-test-plan.md` § 13 added; Decision Log v0.7 entry ingested; cut release with `bun scripts/cut_release.ts v0.7.0 --npm-publish`. | PR ready for review; CI green; CHANGELOG complete; Decision Log entry ingested; v0.7.0 tag pushed; npm registry shows v0.7.0; manual test plan walked. |

**Local testing during the build (mirror iter-24)**:

```bash
# Mode 1 — Source mode (recommended for active pipeline iteration)
bun packages/memory/src/bin/cerefox.ts ingest some-file.md
bun packages/memory/src/bin/cerefox.ts ingest-dir docs/guides

# Mode 2 — Built mode (catches packaging-stage issues)
cd packages/memory && bun run build
node packages/memory/dist/bin/cerefox.js ingest some-file.md

# Mode 3 — Web ingestion (manual UI test)
bun packages/memory/src/bin/cerefox.ts web   # browse :8000/app/, ingest via paste / upload / replace

# Mode 4 — Cross-runtime chunker parity (run during 25A iteration)
uv run python -c "from cerefox.chunking.markdown import chunk_markdown; print(chunk_markdown(open('fixture.md').read()))" > /tmp/py-chunks.json
bun packages/memory/test/fixtures/scripts/run-ts-chunker.ts fixture.md > /tmp/ts-chunks.json
diff /tmp/py-chunks.json /tmp/ts-chunks.json   # must be empty
```

**Critical files / directories created in iter-25**:

```
_shared/ingest/                              # NEW
├── chunker.ts                               # port of chunking/markdown.py
├── embedder.ts                              # 96-chunk batching wrapper around _shared/embeddings/
├── pipeline-helpers.ts                      # normalize + hash + resolveProjectIds
└── types.ts                                 # ChunkData, IngestOptions, IngestResult

packages/memory/src/ingestion/               # NEW
├── pipeline.ts                              # IngestionPipeline class
└── client-bridge.ts                         # subset of CerefoxClient methods called by the pipeline (direct supabase.rpc() / .from() calls; not a full Python-CerefoxClient port)

packages/memory/test/ingestion/              # NEW
├── pipeline.test.ts                         # migrated from tests/ingestion/test_pipeline.py
├── chunker.test.ts                          # migrated from tests/chunking/test_markdown.py
├── embedder.test.ts                         # migrated from tests/embeddings/test_embedders.py
└── retrieval.test.ts                        # migrated from tests/retrieval/test_search.py

packages/memory/test/web-integration/ingest.test.ts   # NEW — HTTP roundtrip for the 3 ingest endpoints

packages/memory/test/fixtures/python-parity/chunking/  # NEW (pre-iter)
└── *.json                                   # 8-10 markdown fixture chunk outputs
packages/memory/test/fixtures/python-parity/embedding/  # NEW (pre-iter)
└── reference.json                           # cosine similarity baseline

scripts/db_deploy.ts                         # NEW
scripts/db_migrate.ts                        # NEW
scripts/backup_create.ts                     # NEW
scripts/backup_restore.ts                    # NEW
scripts/reindex_all.ts                       # NEW
```

**Files modified**:

- `packages/memory/package.json` — add `postgres` (Porsager) dep
- `packages/memory/src/web/routes/ingest.ts` — 3 endpoints SWAPPED from 503 stubs → real handlers (Part 25F)
- `packages/memory/src/web/routes/documents-write.ts` — `/edit` content-change branch SWAPPED from 503 → in-process pipeline call (Part 25E); inline `normalizeForHash` → import from `_shared/ingest/pipeline-helpers.ts`
- `packages/memory/src/cli/commands/ingest.ts` + `ingest-dir.ts` — replace EF-shell-out (current) with in-process pipeline call (Part 25G)
- `src/cerefox/api/app.py` — add Python web deprecation banner (Part 25K)
- `src/cerefox/chunking/converters.py` — DELETED (Part 25K)
- `tests/chunking/test_converters.py` — DELETED (Part 25K)
- `tests/chunking/test_markdown.py`, `tests/embeddings/test_embedders.py`, `tests/ingestion/test_pipeline.py`, `tests/ingestion/test_backup.py`, `tests/retrieval/test_search.py`, `tests/db/test_versioning.py`, `tests/db/test_audit_and_governance.py` — DELETED in Part 25J after TS ports land
- `scripts/db_deploy.py`, `scripts/db_migrate.py`, `scripts/backup_create.py`, `scripts/backup_restore.py`, `scripts/reindex_all.py` — each becomes a 1-line husk pointing at the `.ts` equivalent (Parts 25H + 25I)
- `docs/guides/migration-v0.5.md` — v0.7 section (Part 25L)
- `docs/research/v0.7-manual-test-plan.md` — § 13 added (Part 25L)
- `CHANGELOG.md` — v0.7.0 entry under `[Unreleased]` (Part 25L)

**Known risks / questions that need resolution DURING the build** (raised in the iter-25 design pass on 2026-05-28):

| # | Risk / open question | Resolves in | Default plan |
|---|---|---|---|
| R1 | **Chunking byte-parity across 3 runtimes** (Python + TS + EF). Subtle differences (regex semantics, trim behaviour, line-ending normalisation) could produce 1-character chunk-boundary differences → re-embed cost for the entire corpus. | Part 25A | Cross-runtime fixture tests with the captured Python outputs as ground truth. TS chunker iterated until byte-identical. EF chunker fixture parity recorded as informational (no test failure — EF stays independent), and any drift gets called out in 25K's notes. |
| R2 | **`_shared/embeddings/` lacks batch-size limiting**. Bulk-ingesting a 100-chunk doc would blow OpenAI's per-request limit (which is 2048 input items but degrades earlier in practice). | Part 25B | Add `batchSize` param (default 96) to `embedBatch()`. Internally `chunk-then-flatten` over the batches. Python pipeline tests cover this; TS tests must too. |
| R3 | **`content_hash` algorithm duplicated across 3 runtimes**. Drift = dedup breaks. v0.6's `/edit` short-circuit already uses the algorithm inline in `documents-write.ts`. | Part 25C | Promote v0.6's inline `normalizeForHash` into `_shared/ingest/pipeline-helpers.ts`. Single source of truth for TS web + TS CLI pipeline. EF keeps its own implementation; fixture-tested. |
| R4 | **Postgres SSL / connection-string handling** for `db_deploy.ts` + `db_migrate.ts`. `CEREFOX_DATABASE_URL` may include `?sslmode=require` or similar. | Part 25H | Use `postgres` (Porsager) lib's URL parser; honor `sslmode`; fall back to `{ ssl: 'require' }` for Supabase URLs. Test against actual `CEREFOX_DATABASE_URL` early in 25H. |
| R5 | **Schema deploy idempotency**. `db_deploy.ts` should refuse to re-deploy unless `--reset` is passed (matches Python). | Part 25H | Detect existing `cerefox_*` tables before applying schema; refuse with clear error message if found; `--reset` prompts then drops + redeploys. |
| R6 | **Project M2M atomicity**. Python pipeline does `ingest_document_rpc` + `assign_document_projects` as two separate operations; second failure leaves doc with wrong project state. | Part 25D | Match Python's behaviour exactly (two operations, second-step failure logged but non-blocking). Pushing M2M into the RPC is a separate concern, post-v0.7. |
| R7 | **Title-change re-embedding**. When metadata-only update changes the title, TS pipeline must re-embed ALL chunks (title-boosted FTS / embeddings). Easy to miss. | Part 25E | Port the exact branch from Python; explicit test in 25E (update title only → assert all chunks' embeddings changed). |
| R8 | **Review-status auto-transition**. `author_type='agent'` + content change → RPC's `p_review_status='pending_review'`; `author_type='user'` → `'approved'`. | Parts 25D + 25E | Mirror Python's flag construction; test both author types in the test suite for 25D and 25E. |
| R9 | **`audit-and-governance` test port complexity**. `tests/db/test_audit_and_governance.py` (396 lines, 24 tests) exercises `set_review_status` + `set_version_archived` + audit-entry queries — all logic that's now in the Hono routes (v0.6) PLUS in MCP (Python, stays). | Part 25J | Port the parts that test the v0.6 Hono routes (move to `packages/memory/test/web-integration/governance.test.ts`); leave the MCP-side coverage in pytest under `tests/test_mcp_server.py` (or a focused new file) since Python MCP keeps that surface. |
| R10 | **`reindex_all.ts` dependency on the TS pipeline**. Python's `reindex_all.py` shells out to `uv run cerefox reindex` which does the actual work via the pipeline. The TS port needs `cerefox reindex` to also work in TS — which requires the pipeline's chunk-update + embedder code paths to be reachable via the CLI. | Part 25I | Verify in Part 25I whether `cerefox reindex` (TS) already exists or needs to be added. If needed, add it as a thin CLI command calling the pipeline. |
| R11 | **`postgres` lib's behaviour on huge SQL files** (`schema.sql` is ~500 lines; `rpcs.sql` is larger). Multi-statement SQL has historically been tricky in Node Postgres clients. | Part 25H | Test early with the full schema.sql. If multi-statement support is flaky, split into individual statements before sending (the SQL files are statically structured — easy to parse `;` boundaries). |

**For a fresh-session pickup**: this iter-25 design is self-contained. Read this section + the v0.6.0 closing entry in Cerefox Decision Log Q2 Part 4 + the v0.6 post-cut follow-up entry (test migration policy) + design doc §13 v0.7.0 + design doc §19 (test migration policy). All locked decisions are documented above; R1-R11 risks have default plans for each. No pre-implementation re-deciding needed; nothing should block on day 1.

---

## Iteration 26: v0.8.0 — "Production-Ready Install"

**Status: Done.** All 14 Parts (26A–26N) shipped in **v0.8.0** (2026-05-29). Verified present: `_shared/{server-assets,ef-meta,compatibility,backup}`, `cerefox deploy-server`, daemon-mode `cerefox web start/stop/status`, the EF `/version` route + aggregator, the client↔server compat matrix, `scripts/{cerefox_export,backup_create,backup_restore}.ts`, `RELEASING.md`, `frontend/playwright.config.ts` + `frontend/tests/e2e/ui.spec.ts`, and the Python CLI deprecation banner. The three Python e2e files (`test_edge_functions_e2e.py`, `test_mcp_e2e.py`, `test_ui_e2e.py`) and `src/cerefox/backup/fs_backup.py` were deleted as planned.

Follow-up patches shipped after v0.8.0 (see CHANGELOG + Iteration 26.1):
- **v0.8.1** — `deploy-server` applies pending migrations + refreshes RPCs on existing DBs (was fresh-deploy-only); `--reset` removed from the user-facing command; doctor relabel "schema + RPCs" + consolidated remediation; `cerefox delete-project` (cherry-picked from the un-merged v0.7.1 commit).
- **v0.8.2** — `deploy-server` EF deploy works without a per-directory `supabase link` (derive `--project-ref` from `CEREFOX_SUPABASE_URL`); doctor EF check baselines against `EF_VERSION` (not `PKG_VERSION`).
- **v0.8.3** — `install.sh` pins `@latest` (re-installs now upgrade); live EF/remote-MCP test suites gated behind `CEREFOX_LIVE_E2E=1` + tagged `requestor: "e2e-test"`; setup-supabase Docker-warning note.

**Validated live** (maintainer's existing Supabase + Mac, 2026-05-29): install via script, `cerefox doctor` all-green, `deploy-server --functions-only` (9 EFs redeployed → EF row green), `deploy-server --schema-only` (existing-DB path: 0 pending migrations + RPC refresh). **NOT yet validated** (26N's staging-Supabase acceptance, deferred): a clean/fresh Supabase project end-to-end (incl. the *fresh-deploy* path and the *migration-apply* path — the existing DB has 0 pending migrations so `runDbMigrate` applying a file is still unexercised), and a clean-machine install. Tracked as tasks in Iteration 27 (see below).

**Goal**: Two themes for **v0.8.0**:

1. **Production-ready end-user install.** Eliminate the repo-clone step that today blocks fresh installs of `@cerefox/memory` from being self-sufficient. Add `cerefox deploy-server`, ship server assets (SQL + EFs) inside the npm tarball, version every server-side surface (Schema/RPCs + 9 EFs), and codify a client ↔ server compatibility matrix that surfaces drift via `cerefox doctor`, the SchemaVersionBanner, and `cerefox web` boot. Plus daemon-mode `cerefox web start/stop/status` for fire-and-forget end-user usage.
2. **Test-runner cutover phase 1 + Python CLI deprecation banner.** Port `test_edge_functions_e2e.py`, `test_mcp_e2e.py`, and `test_ui_e2e.py` to TS (the last bumps `frontend/` to `@playwright/test`). Add the Python CLI deprecation banner per design doc §13. After v0.8 the only `.py` in `tests/` covers code that stays Python through v0.9+.

Plus v0.7.x carryovers that don't justify their own patch (write-commands.test.ts state-flake purge, `resolveSpaDist` source-vs-bundled priority swap, `backup_create.ts` + `backup_restore.ts` ports). Plus one new script (`cerefox_export.ts`, Part 26M) folded in per Fotis-21.

**v0.9.0 is now Iteration 27** (split out during the 2026-05-29 design review per Fotis-25). See below.

**Design**: [`docs/specs/polish-and-distribution-design.md` §13 v0.8.0 + v0.9.0 + §19 test migration policy](specs/polish-and-distribution-design.md).

> **Correction to design doc §13**: item #2 of design-doc v0.8.0 says "Python code moved to `python-legacy/` subdirectory in repo". This is **SUPERSEDED** by the 2026-05-28 maintainer call ("Python minimization, not removal"). plan.md is the source of truth for v0.8 scope.

**Size**: **XL** (T-shirt) — same scale as iter-24 and iter-25. 14 Parts (26A–26N), single PR, one cut. Six major scope areas plus carryovers + the new export script — see Parts table.

**Headline items**:

- **`cerefox deploy-server`** — new CLI command that wraps the server-side deploy (schema + RPCs via `db_deploy.ts` logic in-process + `npx supabase functions deploy` for each of 9 EFs). Bundled server assets resolved via candidate-walker pattern (same shape as `resolveSpaDist`). `--dry-run`, `--reset`, `--schema-only`, `--functions-only` flags. Probes `CEREFOX_DATABASE_URL`, `npx supabase --version`, and Supabase project linkage state up-front; refuses with clear remediation if any is missing.
- **`cerefox init` calls `deploy-server` for fresh installs.** Detection: after collecting Supabase URL + key, probe `cerefox_schema_version()` — if it 404s (no schema yet), offer to deploy. Existing installs see zero behavior change.
- **Each Edge Function gets `GET /version`.** Returns `{name, version}`. Shared via `_shared/ef-meta/index.ts` exporting the `EF_VERSION` constant; `cut_release.ts` bumps it alongside `PKG_VERSION`.
- **Aggregator on `cerefox-mcp`**: `GET /version?peers=true` returns `{schema, efs: {<name>: <version>}}`. One round-trip for `cerefox doctor` instead of nine. Parallel `Promise.all` with 2s per-peer timeout; failed peers reported in a separate `errors` field.
- **Client-side compatibility matrix.** New `_shared/compatibility/index.ts` exporting `COMPATIBILITY` constant (`minSchema`, `minEdgeFunctions`). Hand-edited at PR review when a client release requires newer server. `checkServerCompatibility()` consumed by `cerefox doctor` (assert: error if below-min, warn if above-min-but-old), `cerefox web` boot (refuse to bind if incompatible — clear "redeploy your Supabase" message), and `SchemaVersionBanner` (two-tier: red below-min / yellow above-min-but-old).
- **CONTRIBUTING.md SemVer-bump policy section.** Spells out when each minimum bumps: schema/EF minimum bumps require a minor client bump; client patch releases never raise minimums.
- **GPT Actions OpenAPI sync rule** — every EF contract change updates `docs/guides/connect-agents.md`. Audit completed during the design pass (`docs/research/gpt-actions-drift-audit-2026-05-29.md` — 17 drift items: 3 HIGH, 5 MEDIUM, 2 LOW, ~1-2 hours to fix). **Part 26L applies the fixes + creates `RELEASING.md`** (maintainer-facing release playbook in the public repo, sanitized of internal details) + adds a one-liner to CLAUDE.md ("When changing an EF's request/response shape, update the OpenAPI block in `docs/guides/connect-agents.md` in the same PR"). No CI gate — the discipline lives in the playbook + project-rule.
- **Daemon-mode `cerefox web start/stop/status`** (subcommand-based, matching cfcf). Pidfile at `~/.cerefox/web.pid` (JSON: `{pid, port, startedAt}`). Logfile at `~/.cerefox/web.log` (append; no Cerefox-side rotation). Reference: cfcf's `packages/cli/src/{commands/server.ts, server-spawn.ts}` (~412 LOC total). Unix-first; Windows daemon-mode is a follow-up.
- **Python CLI deprecation banner.** Every `uv run cerefox <subcommand>` prints a yellow banner pointing at the npm install. Python MCP server stays silent (the user runs `uv run cerefox mcp` deliberately as a fallback path; banner there would be noise).
- **Test-runner cutover phase 1.** Three e2e suites ported: `test_edge_functions_e2e.py` (489 lines) → `packages/memory/test/edge-functions/`, `test_mcp_e2e.py` (560 lines) → `packages/memory/test/mcp-remote/`, `test_ui_e2e.py` (247 lines, 14 tests) → `frontend/tests/e2e/*.spec.ts` with `@playwright/test` (new dep). Python files deleted in the same Parts.
- **v0.7.x carryovers folded into Part 26K.** (a) `write-commands.test.ts` afterAll/beforeAll harness purges `[E2E v0.5-test]`-prefixed leftovers so the two state-flakes from iter-25 stop firing. (b) `resolveSpaDist` candidate order swap: source `<repo>/frontend/dist/` wins over bundled `packages/memory/dist/frontend/` when both exist (dev-UX fix; npm publish path unaffected). (c) `scripts/backup_create.ts` + `scripts/backup_restore.ts` ports (deferred from iter-25 — the underlying `cerefox.backup.fs_backup` Python module ports too, ~200 LOC).

**Locked design decisions (2026-05-29, pre-iter-26 design pass)**:

| # | Decision | Rationale |
|---|---|---|
| 1 | **Single PR per iter; 14 atomic Parts (26A–26N); one cut.** | Matches iter-24 + iter-25 discipline. Validated twice. |
| 2 | **Server assets bundled into `@cerefox/memory`, not a separate package.** | Total footprint ~272 KB (verified: schema 20K + rpcs 72K + migrations 84K + EFs 96K). Single-package wins on simplicity. Split into `@cerefox/memory-server` only earns its complexity at >10 MB; SQL + Deno TS source won't get there. |
| 3 | **`cerefox deploy-server` wraps `db_deploy.ts` IN-PROCESS** (no shelling out to `bun scripts/db_deploy.ts`). | Code is already imported by the bin. In-process gives unified UX, single error path, no spawning overhead. Per-EF `npx supabase functions deploy` still shells out (the supabase CLI is the canonical interface). |
| 4 | **EF version surface is a dedicated `GET /version` path** (not a query parameter on the existing entry). | Discoverability + clean separation from business logic. One conditional in the EF entry function dispatches to a small `respondVersion()` helper from `_shared/ef-meta/`. |
| 5 | **Aggregator endpoint lives on `cerefox-mcp` as `GET /version?peers=true`** — not a new `cerefox-versions` EF. | `cerefox-mcp` is already the canonical Cerefox endpoint and the only EF agents probe. Adding a 10th EF for marginal benefit is wrong tradeoff. |
| 6 | **Compatibility matrix lives in `_shared/compatibility/index.ts`, hand-edited.** | Auto-generating from CHANGELOG was considered; rejected. Hand-editing keeps the "what counts as incompatible" decision explicit at PR review (each bump is intentional). |
| 7 | **Compat checks: doctor asserts (error if below-min); web boot refuses (won't bind); banner warns (yellow above-min-but-old, red below-min).** | Three different surfaces with three different SLAs — assertion vs refusal vs warning maps cleanly. |
| 8 | **Daemon-mode mirrors cfcf's pattern precisely + uses subcommands** (pidfile JSON shape `{pid, port, startedAt}`, graceful + SIGTERM stop, signal-0 + HTTP probe for status). Surface: `cerefox web start/stop/status` (subcommand-based, matching cfcf). | Don't reinvent. Lifted from `~/src/cfcf/packages/cli/src/{commands/server.ts, server-spawn.ts}` (~412 LOC total). Subcommand surface is cleaner than flag-based; v0.9 will redesign all CLI verbs anyway (Iteration 27), so no point keeping the flag form for one release. |
| 9 | **Daemon-mode is Unix-first; Windows is a follow-up.** | Cerefox's primary users are on macOS/Linux. Windows daemon-mode requires service/scheduled-task integration. Out of v0.8 scope. |
| 10 | **`cerefox init` deploys server iff `cerefox_schema_version()` 404s.** | Detection rather than prompt-every-time. Existing users see zero change. |
| 11 | **GPT Actions OpenAPI sync handled via (a) audit-and-fix in Part 26L; (b) `RELEASING.md` maintainer-facing playbook checklist; (c) CLAUDE.md project-rule one-liner.** No CI gate. | Audit done during this design pass (results in `docs/research/gpt-actions-drift-audit-2026-05-29.md` — 17 drift items, ~1-2 hours to fix). Going forward, the heuristic CI script idea was rejected as too lossy (false-positives on comment-only EF edits; false-negatives on behavioural changes). The discipline lives in the release playbook + project-rule instead. |
| 12 | **Python CLI deprecation banner: CLI subcommands only; Python MCP server is silent.** | Per maintainer call 2026-05-28: Python MCP stays as first-class fallback. Banner on MCP would be noise; the user *chose* the Python path. |
| 13 | **v0.7.x carryovers folded into v0.8's cleanup Part (26K).** | Three small items (write-commands flake purge, resolveSpaDist priority swap, backup/restore ports) fit one Part. Avoids three v0.7.x patch cuts. |
| 14 | **Compat matrix initial values: `minSchema: "0.3.1"`, `minEdgeFunctions: "0.6.0"`.** | Schema 0.3.1 is the current `@version:` marker. v0.6.0 is the first version where the EFs' response shapes match what the v0.6 TS web consumes; v0.5 EFs predate the iter-24 response-shape locks. Confirmable during 26C. |
| 15 | **OpenAPI doc `info.version` bumps from 1.7.0 → 1.8.0** when the `/version` route is added across the 9 EFs. | Following the OpenAPI doc's own ratchet; route addition is a contract change. |
| 16 | **Test-migration delta enumerated per Part** (per design doc §19 rule). | Each Part touching code lists explicitly which Python test files its work supersedes (and how the TS port absorbs them). |
| 17 | **Pre-kickoff design pass produces this docs-only PR**; implementation is a separate atomic PR. | Same pattern as iter-24 (PR #54 + #55) and iter-25 (PR #58). Helps with reasoned-vs-surprise deviation budget during the autonomous build. |

**Parts breakdown (26A–26N)**:

| Part | Scope | Acceptance | Test-migration delta (per design doc §19) |
|------|-------|-----------|-------------------------------------------|
| **26A** | **Bundle server assets in npm tarball.** Extend `packages/memory/package.json`'s `prepublishOnly` with a new `bundle-server-assets` step (run order: `clean → bundle-server-assets → bundle-docs → build-frontend → bundle-frontend → build`; server-assets has no other build deps so it goes early). Copies `src/cerefox/db/{schema.sql, rpcs.sql, migrations/}` and `supabase/functions/` into `dist/server-assets/`. New `_shared/server-assets/index.ts` resolver with candidate-walker pattern. `db_deploy.ts` + `db_migrate.ts` refactored to use the resolver (so they work from both repo-clone and npm-installed paths). | `bun scripts/db_deploy.ts --dry-run` runs from a fresh `npm install` (no repo clone) and prints expected steps. Same script run from a repo clone still loads from `src/cerefox/db/`. Tarball size +~272 KB confirmed via `npm pack --dry-run`. | New TS-only tests for the resolver under `_shared/__tests__/server-assets.test.ts`. No Python tests affected. |
| **26B** | **EF `GET /version` endpoints + aggregator.** New `_shared/ef-meta/index.ts` exporting `EF_VERSION` constant + a `respondVersion()` helper. Modify each of 9 EFs to handle `GET /version` (~5 lines per EF — dispatch + helper call). Aggregator on `cerefox-mcp`: `GET /version?peers=true` calls peer EFs **sequentially with a 5s overall budget** (matches the simplified one-off probe pattern); returns `{schema, efs, errors}`. Bump `cut_release.ts` to update `EF_VERSION` alongside `PKG_VERSION` only when `supabase/functions/cerefox-*/index.ts` actually changed since the previous tag (guard added). | All 9 EFs respond to `GET /version` with `{name, version}`. Aggregator returns within 5s (typical: <1s). `cut_release.ts` bumps both versions when EFs changed; leaves `EF_VERSION` alone when no EF code changed. | New `packages/memory/test/edge-functions/version.test.ts` (probe-and-skip on Supabase reachability). No Python tests affected. |
| **26C** | **Compat matrix + checks.** New `_shared/compatibility/index.ts` with `COMPATIBILITY` constant + `checkServerCompatibility(client)` (calls the aggregator). `cerefox doctor` integrates via a new `checkEdgeFunctionsCompat()`. `cerefox web` boot calls `checkServerCompatibility()` once; refuses to bind if below-min (clear message naming failing component + required minimum). `SchemaVersionBanner` two-tier color logic. **CONTRIBUTING.md SemVer-bump policy section** (new). | `cerefox doctor` shows ✓ when matching; ⚠ when above-min-but-old; ✗ + bind-refusal when below-min. Manual: simulate by editing `COMPATIBILITY.minEdgeFunctions` to a future version, restart web, observe refusal. | TS-only: new `_shared/__tests__/compatibility.test.ts` (matrix shape + check logic with mocked server responses). No Python tests affected. |
| **26D** | **`cerefox deploy-server` CLI command.** New `packages/memory/src/cli/commands/deploy-server.ts`. **Comprehensive pre-flight** detects ALL dependencies and prints a single all-or-nothing remediation list (Node ≥ 20 + npx, `npx supabase --version` reachable, `npx supabase login` done, `npx supabase link --project-ref` done, `CEREFOX_DATABASE_URL` set, `CEREFOX_SUPABASE_URL` + key set, OPENAI_API_KEY set as a Supabase secret). Each failed check shows ✗ + the remediation step + a link to `docs/guides/setup-supabase.md`. User fixes everything and re-runs — idempotent. After pre-flight passes: wraps `db_deploy.ts` in-process (calls `runDbDeploy({ assetsDir })` with `dist/server-assets/` per Fotis-8 simpler design); wraps `npx supabase functions deploy <ef>` for each of 9 EFs. Flags: `--dry-run` (skips deploy + skips confirm prompt; shows plan), `--reset` (drops + redeploys; extra confirmation), `--schema-only`, `--functions-only`. **Real-run prompt**: before deploying, "About to deploy Cerefox schema + 9 EFs to Supabase at `<url>`. Proceed? [y/N]" — explicit Y required. | `cerefox deploy-server --dry-run` exits 0 with a complete plan. Real run prompts before destructive ops. Pre-flight refuses with full remediation list when any dep is missing. Idempotent re-runs after fixing deps. | New `packages/memory/test/cli-deploy-server.test.ts` (smoke `--help` + `--dry-run` + each missing-prereq path). No Python tests affected. |
| **26E** | **`cerefox init` calls `deploy-server` for fresh installs AND version mismatch.** After collecting Supabase URL + key, probe `cerefox_schema_version()` and the aggregator (`/version?peers=true` on cerefox-mcp). Three cases: **(a) 404** (no schema yet) → "Schema not deployed. Deploy now? [Y/n]" → runs `deploy-server`; **(b) schema returns but below `COMPATIBILITY.minSchema`** → "Schema vX.Y is below required vA.B. Redeploy now? [Y/n]" → runs `deploy-server --reset`; **(c) match or above** → no prompt, init continues. EF version below min triggers the same `--reset` prompt path. Decline at any prompt → continue init; user nudged again at next `cerefox doctor`. | Fresh install: 404 → prompt → deploy-server → init continues. Existing install on a compatible deploy: zero prompts (silent pass). Outdated install: prompted to redeploy with `--reset`. | Extends existing `lifecycle-commands.test.ts` (in TS). No Python tests affected. |
| **26F** | **Daemon-mode `cerefox web start/stop/status`** (subcommand-based). Foreground `cerefox web` unchanged. Pidfile `~/.cerefox/web.pid` (JSON: `{pid, port, startedAt}`). Logfile `~/.cerefox/web.log` (append-only). `web start`: spawn detached via `child_process.spawn({ detached: true, stdio: ['ignore', logFd, logFd] })`. `web stop`: SIGTERM, poll for exit up to 3s, SIGKILL on timeout. `web status`: signal-0 + HTTP probe `/api/v1/version`. Stale-pidfile detection (signal-0 throws → mark stale). Port collision: same port + alive PID → "already running on :8000 (pid N)" + exit 0; different port → refuse + clear conflict message. | `cerefox web start` returns immediately; second invocation prints "already running" + exit 0. `web stop` returns when port becomes unreachable. `web status` distinguishes running/stopped/stale-pidfile. | New `packages/memory/test/cli-web-daemon.test.ts` (smoke `web start --help`, `web status` against not-running state). Live daemon flow hard to test in CI; document in v0.7-manual-test-plan.md § 14. No Python tests affected. |
| **26G** | **Test cutover: EFs.** Port `tests/e2e/test_edge_functions_e2e.py` (489 lines) → `packages/memory/test/edge-functions/*.test.ts`. Per-EF probe-and-skip; `[E2E ef-...]` prefix on any created data; self-cleaning purge in afterAll. Delete the Python file. | All EF e2e tests run via `bun test`. `pytest -m e2e` no longer collects EF tests (verify via `pytest --collect-only`). | DELETE `tests/e2e/test_edge_functions_e2e.py`. NEW `packages/memory/test/edge-functions/*.test.ts`. |
| **26H** | **Test cutover: MCP-remote.** Port `tests/e2e/test_mcp_e2e.py` (560 lines) → `packages/memory/test/mcp-remote/*.test.ts`. HTTP MCP handshake → tools/list → sample tool call. Delete the Python file. | Remote MCP e2e tests run via `bun test`. | DELETE `tests/e2e/test_mcp_e2e.py`. NEW `packages/memory/test/mcp-remote/*.test.ts`. |
| **26I** | **Test cutover: UI Playwright TS.** Add `@playwright/test` to `frontend/package.json` (dev dep). New `frontend/playwright.config.ts` (base URL `http://127.0.0.1:8000`, single Chromium project). Port `tests/e2e/test_ui_e2e.py` (247 lines, 14 tests) → `frontend/tests/e2e/*.spec.ts`. Update `frontend/package.json` scripts: `bun run test:e2e`. **Chromium install required** — `bunx playwright install chromium` (~150 MB download); add to CONTRIBUTING.md "One-time contributor setup". Delete the Python file. **Order with 26G/26H**: 26I deletes UI test file; if `tests/e2e/conftest.py` is shared with EF/MCP tests, defer its deletion until 26G + 26H are done (last-of-the-three deletes conftest.py if no remaining consumers). | All 14 UI tests run via `bun run test:e2e` (frontend dir). `bunx playwright install chromium` documented in CONTRIBUTING. | DELETE `tests/e2e/test_ui_e2e.py`. DELETE `tests/e2e/conftest.py` only after 26G+26H (verify no remaining consumers). NEW `frontend/tests/e2e/*.spec.ts`. |
| **26J** | **Python CLI deprecation banner.** Add `_print_deprecation_banner()` to `src/cerefox/cli.py` that fires on every subcommand (yellow ⚠ on TTY, plain on non-TTY). Banner text: "⚠ Python `uv run cerefox <subcommand>` is deprecated. Install the TS CLI with `npm install -g @cerefox/memory` for the canonical experience. This Python CLI keeps working through v0.9." | Every `uv run cerefox <subcommand>` prints the banner before running. `uv run cerefox mcp` does NOT print the banner (per locked decision #12). | NEW `tests/test_python_cli_deprecation_banner.py` — Python (lives until v0.9 cutover per §19). |
| **26K** | **v0.7.x carryovers.** (a) `write-commands.test.ts` beforeAll purges `[E2E v0.5-test]`-prefixed leftover docs + the `_e2e-v0.5` project via direct Supabase REST (the `delete-project` CLI did NOT ship in v0.7.2 — second commit on PR #61 was not merged). (b) Swap `resolveSpaDist` candidate order in `packages/memory/src/web/static.ts` so source `<repo>/frontend/dist/` wins over bundled `packages/memory/dist/frontend/`. Verify the existing `static.ts` doc comment still matches. (c) Port `scripts/backup_create.py` → `scripts/backup_create.ts` and `scripts/backup_restore.py` → `scripts/backup_restore.ts` (+ a `_shared/backup/` module since `cerefox.backup.fs_backup` ports too). Python originals become husks. **Round-trip acceptance**: TS write → TS restore reproduces the same document set (content_hash + project assignments + audit log entries) — not byte-identical (backup files include timestamps). | The two write-commands flakes pass cleanly across consecutive runs. Source-mode dev sees fresh frontend changes without manually deleting `dist/frontend/`. `bun scripts/backup_create.ts` + `backup_restore.ts` smoke-tested live; round-trip identity verified on a fixture-sized backup. | NEW `_shared/__tests__/backup.test.ts`. NEW `_shared/__tests__/scripts-smoke.test.ts` extensions for the backup scripts. DELETE `src/cerefox/backup/fs_backup.py` after TS port. NEW `packages/memory/test/web-static-resolution.test.ts` for the resolveSpaDist swap. |
| **26L** | **GPT Actions OpenAPI fix + RELEASING.md playbook + CLAUDE.md rule.** **Fix phase**: apply the 17 drift fixes from `docs/research/gpt-actions-drift-audit-2026-05-29.md` (3 HIGH priority, 5 MEDIUM, 2 LOW); add the `/version` routes added in 26B to the OpenAPI block; bump `info.version` 1.7.0 → 1.8.0 (additive changes only). **RELEASING.md**: new doc at repo root. Maintainer-facing release-checklist that happens to live in the public repo — must NOT include internal collaboration details, sensitive info, env-specific paths, or anything that could reveal vulnerabilities. Generic public-safe steps: pre-release checks (CHANGELOG, compat matrix, OpenAPI block currency, all tests green), the `cut_release.ts` invocation, post-release verification (npm publish landed, GH release marked latest, smoke `npx --package=@cerefox/memory cerefox --version`), and the rollback procedure (force-move-tag from v0.6 lessons). **CLAUDE.md rule**: one-liner under project conventions: "When changing an EF's request/response shape, update the OpenAPI block in `docs/guides/connect-agents.md` in the same PR. Bump `info.version` per SemVer." | All 17 drift items resolved per the audit doc. `info.version` bumped. `RELEASING.md` exists, public-repo-safe, references the bump-policy from CONTRIBUTING. CLAUDE.md rule added under "Edge Functions & MCP Architecture". | None. No Python tests affected. |
| **26M** | **`cerefox_export.ts` — document export script.** New `scripts/cerefox_export.ts` (per Fotis-21 in iter-26 brainstorm; tracked as a feature add). Usage: `bun scripts/cerefox_export.ts <target-folder>` (required positional arg) exports ALL documents. Layout: `<target>/<slugified-project-name>/<slugified-doc-title>.md` for each doc; docs with no project at `<target>/<slugified-doc-title>.md`. Docs in multiple projects → multiple copies (one per project subfolder). `--project <name>` flag limits to a single project. Slugification: lowercase, replace spaces + special chars with `-`, max 80 chars. Collision suffix: `-2.md`, `-3.md`. Content-only (markdown straight from `cerefox_documents.content`); no metadata sidecar. **No import** — `backup_create.ts`/`backup_restore.ts` remain the round-trip path. | `bun scripts/cerefox_export.ts /tmp/dump && find /tmp/dump -name '*.md' \| wc -l` matches expected count (with multi-project membership counted). `--project foo` limits to that project. Refuses to overwrite a non-empty target unless `--force`. | New `_shared/__tests__/cerefox-export.test.ts` (smoke `--help`, dry-run path on a fixture). No Python tests affected. |
| **26N** | **Closeout.** CHANGELOG v0.8.0 entry with explicit "after upgrading client, you must redeploy EFs and (if RPCs changed) the schema" steps and the actual `cerefox deploy-server` commands (NOT buried in a sub-section). Decision Log entry (Cerefox Decision Log Q2 Part 5 → likely Q3 Part 6 depending on Part 5 size at iter-26 cut). Update `docs/guides/migration-v0.5.md` with v0.8 section ("v0.8 completes the production-ready install arc") — same explicit redeploy-required call-out at the top. Update `docs/research/v0.7-manual-test-plan.md` § 14 with daemon-mode + deploy-server + compat-matrix tests. **Staging-Supabase validation**: maintainer + Claude have stood up a fresh side-by-side Supabase project during iter-26 (set up at start of 26A, not at closeout time); end-to-end install validated against it; `docs/guides/setup-supabase.md` updated based on what surfaced. Existing maintainer Supabase install is NOT touched during iter-26 development (schema bump risk). | All five artifacts present (CHANGELOG, Decision Log, migration guide, manual test plan, setup-supabase.md update). Staging Supabase end-to-end install passes. Redeploy steps prominent in CHANGELOG + migration guide. | Closeout-only Part; no test-migration delta. |

**Out of scope (deferred to v0.8.1+ or v1.0)**:

| Item | Where it lands |
|---|---|
| Compat-matrix auto-generation from CHANGELOG | Manual hand-edit is fine for v0.8; revisit at v1.0 if release cadence demands automation. |
| Daemon-mode on Windows (launchd / systemd integration) | v0.8.x patch or v0.9 follow-up. Unix-first. |
| Standalone `cerefox-versions` EF | Aggregator on cerefox-mcp covers the use case. New EF only if peer-call latency becomes a real problem. |
| Automatic EF version bump in `cut_release.ts` for non-EF-changing releases | Only bump `EF_VERSION` when the EF source actually changed. Add a guard in `cut_release.ts`: if `supabase/functions/cerefox-*/index.ts` had no changes since the previous tag, leave `EF_VERSION` alone. Folded into Part 26B. |
| Removing the OPENAI fallback / Fireworks support | Out of v0.8 scope; tracked in TODO.md. |
| `cerefox deploy-server --link` (interactive `npx supabase link` wrapper) | v0.8.x if user feedback requests it. v0.8 ships the "user must `npx supabase login` + `link` first" UX. |

**Critical files / directories created in iter-26**:

```
_shared/ef-meta/                                    # NEW (Part 26B)
├── index.ts                                        # EF_VERSION constant + respondVersion() helper
└── peers.ts                                        # Peer-EF list for the aggregator

_shared/compatibility/                              # NEW (Part 26C)
├── index.ts                                        # COMPATIBILITY constant + checkServerCompatibility()
└── types.ts                                        # ServerVersionResponse, CompatLevel

_shared/server-assets/                              # NEW (Part 26A)
└── index.ts                                        # bundledServerAssetsDir() helper (folder-as-parameter pattern)

_shared/backup/                                     # NEW (Part 26K)
├── fs-backup.ts                                    # port of cerefox.backup.fs_backup
└── types.ts                                        # BackupManifest, BackupOptions

packages/memory/src/cli/commands/                   # 1 new file (Part 26D)
└── deploy-server.ts

packages/memory/test/edge-functions/                # NEW (Parts 26B + 26G)
├── version.test.ts                                 # /version + aggregator (26B)
├── search.test.ts                                  # migrated from test_edge_functions_e2e.py (26G)
├── ingest.test.ts
├── metadata.test.ts
├── get-document.test.ts
├── list-versions.test.ts
├── get-audit-log.test.ts
├── metadata-search.test.ts
└── list-projects.test.ts

packages/memory/test/mcp-remote/                    # NEW (Part 26H)
├── handshake.test.ts                               # MCP initialize + tools/list
├── tool-calls.test.ts                              # sample tool calls
└── error-handling.test.ts

frontend/tests/e2e/                                 # NEW (Part 26I)
├── dashboard.spec.ts
├── ingest.spec.ts
├── search.spec.ts
├── projects.spec.ts
├── document-detail.spec.ts
├── metadata-search.spec.ts
├── analytics.spec.ts
└── audit-log.spec.ts

frontend/playwright.config.ts                       # NEW (Part 26I)

scripts/backup_create.ts                            # NEW (Part 26K)
scripts/backup_restore.ts                           # NEW (Part 26K)
scripts/cerefox_export.ts                           # NEW (Part 26N)

docs/research/gpt-actions-drift-audit-2026-05-29.md # DONE during design pass (Part 26L applies fixes)
RELEASING.md                                        # NEW at repo root (Part 26L)
```

**Files modified**:

- `packages/memory/package.json` — `prepublishOnly` extended with `bundle-server-assets`; `@playwright/test` dep added (Parts 26A, 26I)
- Each of 9 `supabase/functions/cerefox-*/index.ts` — `GET /version` handler added (Part 26B)
- `supabase/functions/cerefox-mcp/index.ts` — aggregator `GET /version?peers=true` (Part 26B)
- `_shared/db-status/index.ts` — already covers schema version; verify no changes needed
- `packages/memory/src/cli/commands/doctor.ts` — new `checkEdgeFunctionsCompat()` (Part 26C)
- `packages/memory/src/cli/commands/init.ts` — `deploy-server` integration on 404 (Part 26E)
- `packages/memory/src/cli/commands/web.ts` — daemon-mode flag handling (Part 26F)
- `packages/memory/src/web/server.ts` — boot-time `checkServerCompatibility()` (Part 26C)
- `packages/memory/src/web/static.ts` — `resolveSpaDist` candidate order swap (Part 26K)
- `frontend/src/components/SchemaVersionBanner.tsx` — two-tier color logic (Part 26C)
- `scripts/cut_release.ts` — `EF_VERSION` bump alongside `PKG_VERSION` (guarded by "did EFs change since last tag"); OpenAPI `info.version` bump nudge (Parts 26B, 26L)
- `src/cerefox/cli.py` — `_print_deprecation_banner()` (Part 26J)
- `docs/guides/connect-agents.md` — OpenAPI block updates per audit results + `/version` route additions; `info.version` 1.7.0 → 1.8.0 (Part 26L)
- `CONTRIBUTING.md` — SemVer-bump policy section (Part 26C)
- `CLAUDE.md` — Edge Functions & MCP Architecture section: add one-liner "When changing an EF's request/response shape, update the OpenAPI block in `docs/guides/connect-agents.md` in the same PR. Bump `info.version` per SemVer." (Part 26L)
- `docs/guides/migration-v0.5.md` — v0.8 section with EXPLICIT redeploy steps at the top (Part 26M)
- `docs/guides/setup-supabase.md` — updated based on what surfaces during staging-Supabase walk (Part 26M)
- `docs/research/v0.7-manual-test-plan.md` — § 14 (Part 26M)
- `CHANGELOG.md` — v0.8.0 entry under `[Unreleased]` with explicit "after upgrading client, you must redeploy EFs and (if RPCs changed) the schema" callout (Part 26M)

**Files deleted**:

- `tests/e2e/test_edge_functions_e2e.py` (Part 26G)
- `tests/e2e/test_mcp_e2e.py` (Part 26H)
- `tests/e2e/test_ui_e2e.py` (Part 26I)
- `tests/e2e/conftest.py` — only if it's exclusively for the UI tests (verify in 26I)
- `src/cerefox/backup/fs_backup.py` — after TS port lands (Part 26K)
- `scripts/backup_create.py` — becomes husk (Part 26K)
- `scripts/backup_restore.py` — becomes husk (Part 26K)

**Known risks / questions that need resolution DURING the build** (raised in the iter-26 design pass on 2026-05-29):

| # | Risk / open question | Resolves in | Default plan |
|---|---|---|---|
| **R1** | **Supabase CLI absence on user machine.** `cerefox deploy-server` needs `npx supabase` to exist; the `npx` part requires Node ≥ 20. End-users on Bun-only machines will hit it. | Part 26D | Probe `npx supabase --version` up-front. If absent: print clear remediation ("Install Node 20+ from nodejs.org; npx ships with it. Then re-run `cerefox deploy-server`.") and exit 1. Document in `cerefox deploy-server --help`. |
| **R2** | **EF aggregator round-trip latency.** `cerefox-mcp`'s `/version?peers=true` calls 8 peer EFs. Cold starts can be 500ms each — sequential worst case ~4s. **Critical context**: this is a one-off probe (doctor + web boot + init), NOT every command. 4s with a spinner is acceptable. | Part 26B | **Sequential** (not parallel `Promise.all`). 5s overall budget; spinner during the wait. Failed peers reported as `{name, error: "<reason>"}` in a separate `errors` field; partial success still returns. Doctor surfaces partial results. Cache aggregator result for 60s in the calling client so repeat `cerefox doctor` invocations in a session are fast. |
| **R3** | **Daemon-mode race conditions.** Two simultaneous `cerefox web --daemon` invocations could both read empty pidfile and both spawn. cfcf accepts this risk in practice. | Part 26F | Accept low-probability race; the second daemon will fail at port-bind anyway and exit. Don't over-engineer with file locks for a personal-use tool. |
| **R4** | **Playwright TS migration parity.** Python's Playwright tests use specific selectors + page-object patterns. TS `@playwright/test` uses similar but not identical idioms. | Part 26I | Port mechanically test-by-test; run live. Time-box each test to ≤30 min porting effort. If any test takes longer, escalate (likely indicates a real UX selector to replace). |
| **R5** | **GPT Actions OpenAPI drift scope unknown.** Audit may surface anything from 0 to 20 drift points across 9 EFs × ~5 endpoints each. | Part 26L | Time-box audit to 2 hours; document everything found in `gpt-actions-drift-audit-2026-05.md`. Fix all in same Part if drift is small (≤5 endpoints affected). If drift is large (>5 endpoints), split 26L into 26L1 (audit + doc) + 26L2 (fixes) and consider the fixes a separate v0.8.x patch. |
| **R6** | **Bundled `db_deploy.ts` runtime resolution.** When called from `cerefox deploy-server` after `npm install -g`, the script must resolve schema.sql + rpcs.sql + migrations/ from `dist/server-assets/`, not from `src/cerefox/db/`. | Parts 26A + 26D | **Folder-as-parameter** (simpler than a candidate-walker). `runDbDeploy({ assetsDir })` accepts the assets folder as a function argument. Default: `src/cerefox/db/` (repo-relative). `cerefox deploy-server` calls `runDbDeploy({ assetsDir: bundledServerAssetsDir() })`. Direct `bun scripts/db_deploy.ts` still uses the default. Two-line change vs the resolver. |
| **R7** | **Test cutover surfacing live-data dependencies.** `test_edge_functions_e2e.py` may have hidden deps on the maintainer's specific Supabase state (project rows, doc counts). | Parts 26G + 26H | Port verbatim first; surface as flakes; clean up via probe-and-purge in beforeAll using `[E2E ef-...]` / `[E2E mcp-...]` prefixes. |
| **R8** | **`supabase functions deploy` requires linked project state.** Without `npx supabase link` having been run, deploys fail with a non-obvious error. Also need to detect login state, `npx`/Node version, env vars, and Supabase secrets. | Part 26D | **Comprehensive pre-flight**: detect EVERY dep up-front (Node 20+, npx, supabase CLI installable, supabase logged in, supabase linked, all required env vars, OPENAI_API_KEY set as Supabase secret). Print a single all-or-nothing remediation list with the exact command for each failed check + link to setup-supabase.md. User fixes everything, re-runs. Idempotent. |
| **R9** | **`cerefox init` flow change is user-visible.** Adding a "Deploy server now?" prompt changes interactive UX. Existing users in fresh terminal sessions could see unexpected behavior. | Part 26E | Probe `cerefox_schema_version()` BEFORE prompting; only ask when 404. Existing-install users see zero prompt. Default answer is N (safety) — destructive operations are opt-in. |
| **R10** | **Compat matrix initial values (`minSchema`, `minEdgeFunctions`).** Choosing the wrong anchors could either break existing installs (too aggressive) or fail to catch incompatibility (too lenient). | Part 26C | Default plan: `minSchema: "0.3.1"` (current schema marker — every install since v0.4 has this), `minEdgeFunctions: "0.6.0"` (the first version where EFs match the v0.6 TS web). Test by running doctor against a fresh deploy and against a v0.5-vintage deploy. Adjust the v0.6.0 anchor if testing reveals a different boundary. |
| **R11** | **Daemon-mode platform compatibility.** Node's `child_process.spawn({ detached: true })` behaves differently on Windows than Unix. | Part 26F | Implement for Unix; document Windows as "not yet supported — use foreground `cerefox web` or set up a service manually." Add a platform check at the top of `--daemon` that exits 1 on Windows with a clear pointer. |
| **R12** | **Three-tier vs two-tier `SchemaVersionBanner`.** Today: any-difference → yellow. Design pass: red below-min, yellow above-min-but-old. Open question: what about `deployed > bundled` (server is ahead of client)? | Part 26C | Default: stay two-tier; treat `deployed > bundled` as "no banner" (this is fine — newer server has features client doesn't use but won't break). If user feedback later reveals this state surprises them, add a blue/info tier in a v0.8.x patch. |
| **R13** | **`backup_create.ts` / `backup_restore.ts` may surface state-shape divergence.** Python's `fs_backup.py` writes a specific JSON shape; TS port must read/write the same shape so existing backup files restore correctly. | Part 26K | Capture a sample backup from the maintainer's Supabase as a fixture before porting. Port. Test round-trip: TS write → TS restore = identity; Python write (existing fixture) → TS restore = identity. |
| **R14** | **`info.version` bump in OpenAPI doc — semver semantics.** OpenAPI doc uses 1.7.0 today; bumping to 1.8.0 implies "minor change". The `/version` additions are additive (new routes, no breaking changes), so 1.8.0 is correct. But if the audit uncovers a breaking change in the existing OpenAPI block (e.g., a field rename), 2.0.0 is correct. | Part 26L | Default to 1.8.0; if the audit surfaces a breaking change to an existing endpoint, bump to 2.0.0 and document in the migration guide. |

**Design-pass discussion items (resolved during 2026-05-29 maintainer review)**:

The initial draft had 10 discussion items (D1–D10). Maintainer review resolved all of them on 2026-05-29; this table captures the final answers for the implementation build. **No remaining items need maintainer input before code starts.**

| # | Item | Final answer | Notes |
|---|---|---|---|
| **D1** | EF `/version` surface | Dedicated `GET /version` path (locked decision #4) | Locked. |
| **D2** | Aggregator location | `cerefox-mcp` `/version?peers=true` (locked decision #5) | Confirmed by maintainer (Fotis-15): agree, not a 10th EF. |
| **D3** | ~~`cerefox init` auto-deploy prompt~~ | Collapsed into Part 26E flow per Fotis-18 + Fotis-21 | `cerefox init` always prompts before triggering `deploy-server`. `deploy-server` itself also prompts before real run. `--dry-run` skips both prompts (preview only). Per maintainer Q: init triggers deploy-server on 404 AND on schema below `COMPATIBILITY.minSchema` (upgrade path uses `--reset`). |
| **D4** | Carryover backups in v0.8 | `backup_create.ts` + `backup_restore.ts` ported in Part 26K (locked decision #13) | Confirmed. Closes out scripts-port theme from v0.7. |
| **D5** | `resolveSpaDist` candidate-order swap | Swap so source `<repo>/frontend/dist/` wins over bundled `dist/frontend/` | Confirmed. Dev-UX fix; npm publish path unaffected. |
| **D6** | Python web v0.9 fate AND Python MCP timeline | **Python web: deleted at v0.9** (TS web canonical from v0.6). **Python MCP: stays through v1.x** (per Fotis-13). Removal considered post-v1.0; probably v2.0 or "never" — accept the long-tail to avoid breaking repo-clone users who `git pull` without reading docs. | Maintainer call (Fotis-13) extends Python MCP retention beyond the original v0.9 plan. Update §13/§19 of design doc and Iteration 27 scope accordingly. |
| **D7** | ~~OpenAPI audit + fix split~~ | Done. Audit completed during this design pass; results in `docs/research/gpt-actions-drift-audit-2026-05-29.md`. 17 drift items, ~1-2 hours to fix → single Part 26L. | No CI gate (per Fotis-4); `RELEASING.md` + CLAUDE.md rule replace it. |
| **D8** | Compat matrix initial anchors | `minSchema: "0.3.1"`, `minEdgeFunctions: "0.6.0"` | Maintainer signoff: per Fotis-14 + Fotis-10, the bump cadence lives in the new `RELEASING.md` playbook; initial values are reasonable defaults adjusted per release. |
| **D9** | Daemon-mode surface | **Subcommand-based** `cerefox web start/stop/status` (per Fotis-17) | Cleaner. v0.9 redesigns all CLI verbs anyway (Iteration 27); subcommands now mean zero rework later. Locked decision #8 updated. |
| **D10** | ~~Python deprecation banner opt-out~~ | Dropped (per Fotis-19) | No env-var opt-out. Banner prints unconditionally on every Python CLI subcommand. |

**Local testing during the build**:

```bash
# Mode 1 — Full source-tree (chunker + EF + bundled deploy parity)
cd /Users/fotis/src/cerefox
bun scripts/db_deploy.ts --dry-run       # source path still works
bun scripts/db_deploy.ts                 # apply to a test Supabase

# Mode 2 — Bundled-install simulation
cd packages/memory && bun run build && bun run bundle-server-assets
node dist/bin/cerefox.js deploy-server --dry-run    # bundled path

# Mode 3 — Daemon-mode walk
cerefox web --daemon                     # spawn detached
cerefox web --status                     # confirm running
curl http://127.0.0.1:8000/api/v1/version
cerefox web --stop                       # graceful shutdown

# Mode 4 — Compatibility matrix simulated mismatch
# Edit _shared/compatibility/index.ts: COMPATIBILITY.minEdgeFunctions = "99.0.0"
cerefox doctor                           # expect ✗ on edge-functions row
cerefox web                              # expect refusal at boot

# Mode 5 — Document export (Part 26N)
bun scripts/cerefox_export.ts /tmp/cerefox-dump          # all docs, foldered by project
bun scripts/cerefox_export.ts /tmp/cerefox-dump --project Personal   # one project only
find /tmp/cerefox-dump -name '*.md' | wc -l              # sanity count
```

**For a fresh-session pickup**: this iter-26 design is self-contained and **ready for implementation as of 2026-05-29**. Read this section + the v0.7.0 closing entry in Cerefox Decision Log Q2 Part 5 + the v0.7.1 "anti-pattern" entry (Part 5) + design doc §13 v0.8.0/v0.9.0 + §19 (test migration policy) + `docs/research/gpt-actions-drift-audit-2026-05-29.md`. All locked decisions are documented above; the 14 risks have default plans; all 10 design-pass discussion items (D1–D10) were resolved during the 2026-05-29 maintainer review — **no blocking questions remain**. Headline items are ordered roughly in the dependency sequence (server-assets first, then EF /version, then compat matrix, then deploy-server CLI, then init integration, then daemon-mode, then test cutovers + Python banner + carryovers + OpenAPI fixes + export script + closeout). A single autonomous build can execute Parts 26A through 26N in order; mid-Part check-ins only on real surprises.

**Staging Supabase strategy** (locked at design review): set up a fresh side-by-side Supabase project at the start of 26A. Run iter-26 implementation against it. The existing maintainer Supabase install is NOT touched during the build (schema bumps + EF redeploys would risk it). At 26M closeout, the staging install is the validation surface for the end-to-end install path; setup-supabase.md is updated based on what surfaces. Optional fallback if a fresh Supabase project isn't practical: test on the maintainer's existing install AFTER running `bun scripts/backup_create.ts` (json round-trip) AND `bun scripts/cerefox_export.ts` (file dump) for belt-and-suspenders local copies.

---

## Iteration 26.1: v0.8.1 — "deploy-server handles updates"

**Goal**: Close a gap found right after v0.8.0 published: `cerefox deploy-server` only ever did a *fresh* deploy (apply schema + RPCs, then **stamp** every migration as applied without running it). Re-run against a database that already has a Cerefox schema, it never applied pending migrations and never refreshed RPCs — so a release that ships a new migration or changed RPCs wasn't actually deployed by re-running the catch-all command. v0.8.1 makes `deploy-server` the true catch-all for standing up **and updating** the server side.

**Status: Done.** Shipped in **v0.8.1** (2026-05-29), with follow-ups in **v0.8.2** and **v0.8.3** (see the Iteration 26 status block above for the full breakdown). The existing-DB *RPC-refresh* path was validated live (`deploy-server --schema-only` → "0 pending migrations + refresh RPCs"); the *migration-apply* path (`runDbMigrate` actually applying a pending file) remains unexercised because the maintainer's DB is fully migrated — folded into the clean-Supabase validation task in Iteration 27.

| Part | Description | Acceptance |
|------|-------------|-----------|
| **26.1-A** | Extract `runDbMigrate`, `migrationStatus`, `detectExistingSchema`, `applyRpcs` into `_shared/db-deploy/`. Refactor `scripts/db_migrate.ts` into a thin wrapper over the shared logic; add `--status`. | `_shared` + scripts-smoke green; `db_migrate.ts --status` lists applied/pending live. |
| **26.1-B** | `deploy-server` detects fresh vs. existing DB (`detectExistingSchema`). Fresh → `runDbDeploy` (unchanged). Existing → `runDbMigrate` (apply pending, each in its own txn) + `applyRpcs` (refresh RPCs). Dry-run plan shows the chosen path + pending list. **Remove `--reset`** from the user-facing command (stays in `scripts/db_deploy.ts --reset`). `cerefox init`'s below-min-schema path now runs plain `deploy-server` (in-place update) instead of `--reset`. | `deploy-server --schema-only --dry-run` against a live existing DB reports "apply N pending migration(s) + refresh RPCs"; `--help` no longer advertises `--reset`; `cli-deploy-server.test.ts` green. |
| **26.1-C** | `doctor` relabels `schema` → `schema + RPCs`; classifies deployed schema/RPC version against `COMPATIBILITY.minSchema` (error) + bundled `@version` (warn). Consolidated remediation footer: both stale → `deploy-server`; one stale → `--schema-only` / `--functions-only`. | `doctor` renders the new label + footer; full package suite green. |
| **26.1-D** | Closeout: CHANGELOG [Unreleased] entry, RELEASING.md + CLAUDE.md note deploy-server as the migration-aware catch-all, this plan section, PR. Cut deferred to the clone-env walk. | Artifacts present; PR opened. |

**Out of scope**: cutting/publishing the tag (deferred to the clone-env validation walk); any new migration files (none added in v0.8.1).

---

## Iteration 27: v0.9.0 — "CLI Verb Redesign + Python Surface Retirement + Docs Overhaul"

**Status: Implemented (2026-05-30) on `feat/iter-27-v0.9-design`, pending review + a docs-sweep follow-up + the V1/V2 validation walks.** Done: 27A (parity audit doc + rename-only taxonomy), 27B (resource-verb groups via `moveInto`), 27C (husks for old verbs + completion + `_stub.ts` removed), 27D (audit found no must-fix gaps — all map to v0.9.1), 27E (Python web → husk; `routes_api.py`/`deps.py` deleted; FastAPI/uvicorn dropped), 27F (Python CLI → husks except `mcp`; banner opt-out removed), 27G (all `tests/**/*.py` deleted; pytest dropped; CI Python job removed), 27I-partial (design doc §13 rewritten; this status). **27H is a FIRST PASS** — `migration-v0.9.md`, CHANGELOG v0.9.0, CLAUDE.md verb-conventions + tech-stack fixes, README "Choose your path" split are done; the **full sweep of the remaining ~10 guides + the CLAUDE.md structure tree is deferred to a post-first-pass discussion** with the maintainer (per their instruction). **Decision Log** entry → maintainer to add in the live Cerefox KB (not written autonomously). Cut deferred until docs sweep + validation.

**Goal**: Four themes for **v0.9.0** — the contract-hardening lead-in to v1.0. Scope decisions locked with the maintainer 2026-05-30 (see "Locked decisions" below).

1. **CLI verb normalization — RENAME-ONLY — + CLI ↔ web parity.** Redesign the CLI to a resource-verb shape (`cerefox <resource> <verb> [args]`) matching cfcf's convention. **This is a pure rename of the *existing* command surface — no new commands.** Every old top-level verb (`get-doc`, `list-docs`, `delete-doc`, …) becomes a husk that prints "use `cerefox <resource> <verb>` instead" and exits non-zero. Genuinely new commands (`document edit`, `document restore`/undelete, `version archive`, `audit tail/search`) are **deferred to v0.9.1** as deliberate feature adds — captured in the v0.9.1 scope block at the end of this iteration. Also run a CLI↔web parity audit and close a *capped* set of small gaps. v0.9.0 is the last release with the old verbs reachable (as husks).
2. **Retire the Python surfaces to husks.** (a) **Python web** (`src/cerefox/api/app.py`, `routes_api.py`) collapses to an **almost-empty husk** that prints "the Python web is removed; use `cerefox web` (TypeScript, from `@cerefox/memory`)" and exits — no FastAPI app, no routes. (b) **Python CLI subcommands** all become husks that redirect to the TS CLI equivalent — **except `cerefox mcp`**, which stays functional (it's how git-pull users launch the surviving Python MCP server). (c) The **Python MCP server** (`src/cerefox/mcp_server.py`) + the modules it imports (`embeddings`, `ingestion`, `chunking`, `config`, `db`) stay in the repo **as-is, unmaintained**, purely so `git pull && uv run cerefox mcp` keeps working for people mid-migration. We do **not** maintain or test it going forward.
3. **Delete ALL Python tests; retire pytest as a test runner.** Per the maintainer (2026-05-30): since the Python side is no longer maintained, delete `tests/**/*.py` wholesale (no subprocess-pattern port). After v0.9: **zero `.py` in `tests/`**, one test runner (`bun test`), `pytest` removed from `pyproject.toml`'s dev deps. `pyproject.toml` / `uv.lock` / `.python-version` STAY (the Python runtime stays for the MCP server). **Accepted tradeoff:** the surviving Python code ships untested — acceptable because it's a frozen, unmaintained fallback, fully superseded by the TS implementation.
4. **Comprehensive documentation overhaul** (Fotis, 2026-05-29/30). A **major cleanup of every document, everywhere** — not just README/quickstart. Restructure all user-facing docs around **two paths, both kept and clearly labelled**: **(a) End user (no repo checkout)** — install script + `cerefox` CLI (`init` → `deploy-server` → `configure-agent`); **(b) Contributor / "play with the code"** — repo-clone flow (uv, bun, repo scripts). Audit the full `docs/` tree + root markdown for stale Python-CLI/Python-web references, the old verb names, and repo-clone-only assumptions. Detailed scope to be finalized with the maintainer after a first implementation pass.

**Locked decisions (2026-05-30 maintainer review):**

| # | Decision | Rationale |
|---|---|---|
| L1 | **Verb redesign is rename-only.** No new commands in v0.9.0. | v0.9.0 hardens the surface before the 1.0 contract; renames are the breaking part — do them once, now. New verbs are additive/non-breaking, so they slot into **v0.9.1** (see the scope block at the end of this iteration) without waiting for v1.0. |
| L2 | **Drop the subprocess-pattern Python tests entirely.** Delete all `.py` tests. | The Python side is an unmaintained fallback; testing it is wasted effort. Simplifies scope (no `python-runtime/` TS test dir). |
| L3 | **Python web → husk, not full file deletion.** | A husk that names the TS replacement is friendlier than an import error and avoids touching every `cerefox.api` importer; `cli.py`'s `web` subcommand redirects too. |
| L4 | **Python CLI → husks, except `mcp`.** | `uv run cerefox mcp` must keep launching the surviving Python MCP server; everything else redirects to the TS CLI. |
| L5 | **No `server reset`; backup keeps its own resource.** | Honors the v0.8.1 removal of the user-facing `--reset`; `cerefox backup {create,restore}` avoids colliding with a future `document restore`. |

**Python MCP retention** (per Fotis-13): the Python MCP server stays **through v1.x at minimum**, frozen/unmaintained. Removal considered post-v1.0. The long-tail Python footprint is accepted.

**Design**: [`docs/specs/polish-and-distribution-design.md` §13 v0.9.0](specs/polish-and-distribution-design.md). The §13 v0.9.0 entry is **stale** (says "python-legacy/ deleted; pyproject.toml deleted; all tests in vitest") — superseded by "Python minimization, not removal" (2026-05-28), the v1.x retention extension (2026-05-29), and these L1–L5 decisions. Rewritten in 27J closeout.

**Size**: **M–L** (T-shirt) — the rename-only scope + delete-don't-port test decision shrink this below the original L estimate. ~9 Parts (27A–27I) + 2 validation walks, single PR, one cut.

**Headline items**:

- **CLI ↔ web parity audit** (`docs/research/cli-web-parity-audit.md`): for every web UI page/action, list the equivalent CLI command; for every CLI command, the equivalent web surface. Document gaps; decide close vs leave-web-only (analytics charts) vs leave-CLI-only (backup/deploy-server). Time-boxed; gap-closure capped (see R2).
- **CLI verb normalization (rename-only)**: map the *existing* commands into a resource-verb taxonomy (cfcf-style). Proposed mapping of today's surface:
  - `get-doc → document get` · `list-docs → document list` · `delete-doc → document delete` · `ingest → document ingest` · `ingest-dir → document ingest-dir`
  - `list-projects → project list` · `delete-project → project delete`
  - `list-versions → version list`
  - `get-audit-log → audit log` (or `audit list`)
  - `list-metadata-keys → metadata keys` · `metadata-search → metadata search`
  - `search` stays top-level (primary verb) — or `document search`; decide in 27A
  - `config-get → config get` · `config-set → config set`
  - `backup → backup create` · `restore → backup restore` (frees `document restore` for a future undelete; honors L5)
  - `deploy-server → server deploy` · (no `server reset` — L5)
  - `reindex → server reindex` (or stays flat; decide in 27A)
  - Flat lifecycle (unchanged): `init`, `doctor`, `status`, `configure-agent`, `self-update`, `upgrade`, `mcp`, `web`, `docs`, `completion`, `sync-docs`, `sync-self-docs`
  - **No new commands** (`document edit`, `document restore`, `version archive/unarchive`, `audit tail/search` → **v0.9.1**, see the scope block at the end of this iteration; L1).
- **Husk-on-rename pattern**: every old top-level verb stays registered as a husk that exits non-zero + names the new shape ("`get-doc` is renamed — use `cerefox document get`"). Bash/zsh completion keeps the husks with a "renamed — use …" hint. Husks removed entirely in v1.0.
- **Python web → husk** (L3): reduce `src/cerefox/api/app.py` + `routes_api.py` to an almost-empty husk — no FastAPI app, no routes; any entry point prints "the Python web is removed; use `cerefox web` (TypeScript) — `npm install -g @cerefox/memory`" and exits non-zero. `cli.py`'s `web` subcommand redirects the same way. Drop FastAPI/uvicorn from `pyproject.toml` deps. (Files kept as husks, not deleted, to avoid touching every importer.)
- **Python CLI → husks except `mcp`** (L4): every Python `cerefox <subcommand>` except `mcp` becomes a husk that prints the TS-CLI equivalent and exits non-zero. `cerefox mcp` stays fully functional (launches the surviving Python MCP server). Remove the `CEREFOX_NO_DEPRECATION_BANNER` opt-out (the banner's job is now done by the husks).
- **Delete ALL Python tests** (L2): remove `tests/**/*.py` wholesale (including the already-dead `test_mcp_soft_wrapper.py` — soft-wrapper removed v0.5.2). No subprocess-pattern port. Remove `pytest` (+ plugins) from `pyproject.toml` dev deps. CI test job runs only `bun test` (+ `cd _shared && bun test`). `pyproject.toml`/`uv.lock`/`.python-version` stay (runtime).
- **Comprehensive documentation overhaul** (full `docs/` + root audit): two clearly-labelled paths — **end user** (install script + `cerefox` CLI: `init → deploy-server → configure-agent`, no clone) and **contributor** (repo clone, uv/bun, repo scripts). README "Choose your path" split; reframe `quickstart.md` as the contributor flow; sweep every doc for stale Python-CLI/Python-web references and old verb names; cross-link `setup-supabase.md` + `connect-agents.md`. Final scope confirmed with the maintainer after a first pass.
- **CHANGELOG v0.9.0** with an old→new verb table + the Python-web/Python-CLI husk transitions + the `CEREFOX_NO_DEPRECATION_BANNER` removal.
- **Migration guide**: new `docs/guides/migration-v0.9.md` (largest user-impact change since v0.5) — verb rename table, Python-surface husks, what still works (`uv run cerefox mcp`).
- **CLAUDE.md**: a `CLI verb conventions` section codifying the resource-verb pattern + dead-code cleanup (`_stub.ts` and any remaining `stubAction` callers).
- **Dead-code cleanup**: remove `packages/memory/src/cli/commands/_stub.ts` once no command uses `stubAction` (its own comment says "don't leave past iter-23").

**Parts breakdown (27A–27I)**:

| Part | Scope |
|---|---|
| **27A** | CLI ↔ web parity audit doc (`docs/research/cli-web-parity-audit.md`); finalize the **rename-only** resource-verb taxonomy (resolve the open `search`/`reindex` placements). No new commands. |
| **27B** | New resource-verb CLI command files — each is a thin wrapper that **delegates to the existing handler** (no logic moves). `commander` subcommand groups (`document`, `project`, `version`, `metadata`, `config`, `backup`, `server`, `audit`). |
| **27C** | Husk-on-rename for every old top-level verb (exit non-zero + name the new shape). Bash/zsh completion updated with "renamed" hints. Remove `_stub.ts` + any `stubAction` callers. |
| **27D** | CLI↔web parity gap closures (capped at ~3 small fills from 27A; larger gaps → v0.9.x). |
| **27E** | **Python web → husk**: collapse `api/app.py` + `routes_api.py` to a redirect husk; husk `cli.py`'s `web` subcommand; drop FastAPI/uvicorn from `pyproject.toml`. Verify no surviving Python module needs the removed routes. |
| **27F** | **Python CLI → husks except `mcp`**: every Python subcommand redirects to its TS equivalent; `mcp` stays functional. Remove the `CEREFOX_NO_DEPRECATION_BANNER` opt-out. |
| **27G** | **Delete all Python tests**: `rm tests/**/*.py`; remove `pytest` (+ plugins) from `pyproject.toml`; update CI to run `bun test` only. Confirm `uv run cerefox mcp` still boots (manual smoke, not a test). |
| **27H** | **Documentation overhaul** (the big one): README "Choose your path" split; reframe `quickstart.md` (contributor) + add the end-user CLI path; full `docs/` sweep for stale Python/verb references; CHANGELOG v0.9.0 (verb table); new `migration-v0.9.md`; CLAUDE.md verb-conventions section. |
| **27I** | Closeout: rewrite design doc §13 v0.9.0 (L1–L5); Decision Log entry; manual test plan update. |

**Carried-over validation tasks (deferred from iter-26 / v0.8.x — do side-by-side with the maintainer):**

| Task | Scope | Why deferred |
|---|---|---|
| **V1 — Clean Supabase install** | Stand up a **fresh** Supabase project (separate account or a `cerefox`-identical second env) and run the full end-to-end install against it: `cerefox init` → `cerefox deploy-server` (the **fresh-deploy** path: schema + RPCs + stamp migrations + 9 EFs) → `cerefox doctor` all-green → ingest/search smoke. Critically, this is the **only** way to exercise (a) the fresh-deploy branch of `deploy-server` and (b) the **migration-apply** path (`runDbMigrate` actually applying a pending file) — the maintainer's primary DB is fully migrated (0 pending), so that path is still unexercised in production. Refresh `docs/guides/setup-supabase.md` with whatever surfaces. | v0.8 shipped against the maintainer's existing (already-migrated) Supabase; a fresh project was never stood up. 26N's "staging-Supabase validation" acceptance was deferred. |
| **V2 — Clean machine install** | On a machine with **no prior Cerefox install** (or a fully reset `~/.cerefox` + uninstalled global), run the one-line install script → `cerefox init` → wire an agent → first ingest/search. Confirms the end-user (no-repo-clone) path works cold, and that `install.sh`'s `@latest` pin behaves on a first install (not just an upgrade). | All install testing so far was on the maintainer's primary machine, which already had Cerefox + `.env` + linked Supabase. The cold-start path is unverified. |

> These two validations gate confidence for **v1.0**, not v0.9.0 functionality. Per the maintainer (2026-05-29): schedule them **after** the 0.9.0 code work, side-by-side. They may surface doc fixes (setup-supabase, quickstart, the two-install-path docs in 27H) and possibly small `deploy-server`/`init` fixes — budget a v0.9.x patch slot for anything found.

**Risks**:

| # | Risk | Default plan |
|---|---|---|
| R1 | **Husk-on-rename surprises automation scripts** in the wild. Users with `cerefox get-doc <id>` in cron jobs/CI will hit exit code 1. | Accept. Banner is the point. v0.8 ships v0.9 nudge in CHANGELOG ("verbs renaming next minor"); v0.9 ships the renames; v1.0 removes husks entirely. Three-release deprecation window matches Python deprecation cadence. |
| R2 | **CLI ↔ web parity audit surfaces large gaps** that swell v0.9 scope. | Time-box audit to a half-day; cap gap-closure work in 27D at 3 small fills. Anything bigger gets deferred to v0.9.x. |
| R3 | **Verb taxonomy bikeshedding.** Subjective choices (e.g., `cerefox version archive` vs `cerefox archive version`). | Lock the cfcf-style `<resource> <verb>` shape in 27A. Decisions get rationale comments in `CLAUDE.md`. No second-pass redesign in same iteration. |
| R4 | **Deleting all Python tests strips coverage from the surviving Python MCP server + its modules.** | **Accepted** (L2). The Python side is a frozen, unmaintained fallback fully superseded by the TS implementation; the TS suites + the post-release clean-Supabase walk (V1) cover the real surfaces. The only safety net kept is a manual `uv run cerefox mcp` boot smoke in 27G. |
| R5 | **Python web husk or CLI husks break `uv run cerefox mcp`** (the one Python path that must keep working). | `mcp` is explicitly excluded from the CLI husking (L4) and doesn't import `cerefox.api`. Verify with a grep (`mcp_server.py` imports only `embeddings`/`ingestion`/`config`/`db`) + a manual boot smoke in 27G. |
| R6 | **Doc overhaul scope creep** — "review every document everywhere" is open-ended. | Time-box a first pass (README + the `docs/guides/` install/setup/connect files + CHANGELOG/migration), present to the maintainer, then iterate. Lower-traffic docs (research/specs) get a lighter stale-reference sweep, not a rewrite. |

### v0.9.1 — new CLI verbs

Originally deferred from v0.9.0's rename-only scope. On 2026-05-30 the
maintainer asked to **fold them into v0.9.0** ("no need to wait"). Outcome:

| New command | Status | Notes |
|---|---|---|
| `cerefox document restore <id>` | **✅ Folded into v0.9.0** | Thin wrapper over `cerefox_restore_document`. `document-restore.ts`. |
| `cerefox version archive <version-id>` / `unarchive` | **✅ Folded into v0.9.0** | Flip `cerefox_document_versions.archived` + audit entry (mirrors the web). `version-archive.ts`. |
| `cerefox document edit <id>` | **Remains v0.9.1** | Content edits already work via `cerefox document ingest --document-id <id> --update`. A dedicated `edit` adds title/metadata-only editing, which has a **title-boosting re-embed nuance** (a title change must re-embed per the title-boost design) worth a short design pass with the maintainer before it joins the v1.0 contract. Don't ship it hastily into the contract-lead-in. |
| `cerefox audit tail` / `audit search` | **Remains v0.9.1 (likely dropped)** | `audit list` already covers filtering (`--author/--operation/--since/--until`) + recency (`--limit`). `search` would be a pure alias; `tail` (live-follow) is the only non-redundant bit. Revisit only if a real streaming need appears — otherwise drop from scope. |

#### v0.9.1 broader scope (gathered 2026-05-30 from v0.9.0 dogfooding)

Accumulating on `fix/v0.9.1` (draft PR #68). Status as of 2026-05-30:

| Item | Status | Notes |
|---|---|---|
| **`cut_release.ts` confirm-first** | ✅ done | Prompt moved before any mutation; a declined cut leaves the tree pristine + re-runnable. (Found cutting v0.9.0 — an accidental `N` stranded the cut.) |
| **`cerefox search` rendering bugs** | ✅ done | Was `partial (N of M chars)` — `N` is chunk_count, mislabeled as chars, and only shown for `is_partial` results (full docs showed nothing). Now every result shows `· score X · N chunks · M chars · partial\|full`. Inter-result separator changed from `---` (collides with markdown content) to a distinctive rule. |
| **`cerefox search --only-metadata`** | ✅ done | Collapsed "which docs matched" list (id/score/chunks/chars/partial-full), no body — the web UI's collapsed view; great for "grab the id, then `document get`". Works in text + `--json`. |
| **`project create` / `project edit`** | ✅ done | Parity with web/API (`POST`/`PUT /api/v1/projects`). `project-create.ts` / `project-edit.ts`. (Implicit create via `--project-name` on ingest still works.) Live round-trip validated. |
| **Full docs sweep / sanity pass** | ⬜ open (big) | Every guide is stale, made worse by the verb rename. Includes: rewrite `cli.md` for the new surface, sweep all `docs/guides/*`, the CLAUDE.md structure tree (still lists `api/routes_api.py`, `deps.py`, `tests/`, `cli.py`), README. **Add a manual-config appendix to `connect-agents.md`** (keep the hand-config + "what configure-agent does" for users who want to debug if the CLI breaks). |
| **`ingest --update` REPLACES metadata (footgun)** | ⬜ decide/fix | `cerefox_ingest_document` does `metadata = p_metadata` (replace, not merge/COALESCE), and the pipeline passes `metadata ?? {}`. So `document ingest --document-id X --update` **without** `--metadata` WIPES the doc's metadata to `{}`. The web isn't bitten because its edit form pre-fills + resubmits the full set. This means `ingest --update` is **not** true non-destructive edit for metadata. Options: (a) make the ingest RPC `COALESCE`/merge metadata on update when omitted (server change → deploy); (b) make `document edit` fetch→patch→save (CLI-side, non-destructive by default). Informs the `document edit` design. |
| **`document edit`** | ✅ done | `document edit <id> [--title] [--set-meta k=v]… [--unset-meta k]…` — **non-destructive** title/metadata patch (mirrors Clio's `docs edit`): fetches current metadata, applies sets/unsets, preserves the rest (the thing `ingest --update` does NOT). Title change refreshes FTS via `cerefox_update_chunk_fts`; semantic embeddings update on next `server reindex`. `--set-meta` values are JSON-parsed when possible. Content edits stay on `ingest --update`. Live round-trip validated. (`ingest --update` metadata-replace footgun left as-is; revisit whether to COALESCE it.) |
| **`config list`** | ✅ done | New `cerefox config list` — prints the allowed `cerefox_config` keys (+ descriptions), `--json`. Lists keys, not values. |
| **`audit` scope** | ✅ decided (drop tail/search) | `audit list` IS web parity — immutable/read-only log, already filterable by `--document-id/--author/--operation/--since/--until` + `--limit` (default 50, max 200). Date-range retrieval already supported. `audit tail/search` dropped. (Future: cursor pagination if >200-entry ranges become common.) |
| **`search` deeper parity** | ✅ done | `cerefox_search_docs` already returned `best_chunk_heading_path` + `doc_updated_at`; the CLI now surfaces them — each result shows a `best match: <breadcrumb> · updated <date>` line. No RPC change. (Best-chunk full *text* still needs a new RPC field — deferred.) |
| **`completion install` (cfcf pattern)** | ✅ done | `cerefox completion install [--shell] [--yes]` writes `~/.cerefox-completion.<shell>` + idempotently appends a sentinel block (`# >>> cerefox shell completion >>>` … `<<<`) to the rc; re-runs regenerate the script (new commands appear). Wired into `install.sh` (best-effort, `--yes`, non-interactive). Interactive runs prompt before the rc edit. Sandbox-validated (idempotent). Raw `completion <shell>` emit still works. |

**Clio (`cfcf clio`) CLI comparison** (per maintainer, 2026-05-30 — `../cfcf/docs/guides/cli-usage.md`). Clio is the TS/SQLite port of cerefox; its CLI was normalized. Findings (flagged, **not changing now** — v0.9.0 just shipped; revisit at the v1.0 contract):
- **Adopted**: Clio's `docs edit --set-meta k=v / --unset-meta k` non-destructive patch → used verbatim for `document edit`.
- **Discrepancy — singular vs plural nouns**: Clio uses `docs`, `projects`, `metadata` (plural); cerefox uses `document`, `project` (singular). Another rename now = churn right after 0.9.0's rename; singular reads fine. **Revisit at v1.0** (the contract release) if we want to align.
- **`versions` placement — ✅ ALIGNED (v0.9.1)**: moved the top-level `version` group under `document` → `cerefox document version {list|archive|unarchive}` (Clio's "versions belong to a document" shape). No husk for the top-level `version` (it was live for hours in v0.9.0; nobody adopted it); the v0.8 flat `list-versions` husk now points at `document version list`.
- **✅ Tests added for the new commands (v0.9.1)**: cli-smoke `--help` smoke for `document edit/restore/version`, `project create/edit`, `config list`, `search --only-metadata`, `completion install`, `guides` (+ `docs`/`sync-docs` husks); plus a deterministic sandbox-HOME behavior test for `completion install`. Full suite 121 pass. (Live write-command round-trips validated by hand; folding them into `write-commands.test.ts` is a follow-up.)
- **✅ Docs commands reorg (v0.9.1)**: flat `docs` → **`cerefox guides {list|open|show}`** (disambiguates from `document`; `open` = browser, `show` = stdout, replacing `docs <topic> --print`). `sync-self-docs` → **`guides ingest`**. **`sync-docs` removed from the CLI** (repo-clone contributor op; `scripts/sync_docs.ts` stays). Husks: `docs`→`guides`, `sync-self-docs`→`guides ingest`, `sync-docs`→pointer to the script. Deleted the `docs.ts`/`sync-docs.ts` CLI command files.
- **✅ CHANGELOG v0.9.1** written under `[Unreleased]` — ready to cut.
- **Discrepancy — flat vs grouped**: Clio's `reindex`/`audit`/`stats` are top-level; cerefox uses `server reindex` / `audit list` and has no CLI `stats` (analytics web-only by design). Leave.
- **Naming nits**: Clio `docs ingest --stdin` vs our `document ingest --paste`. Leave.

> **Engineering note (2026-05-30, Claude):** I folded the two **clean, verified,
> low-risk** wrappers (restore, version archive/unarchive) into v0.9.0 and held
> `document edit` + `audit tail/search` because they need a design decision
> (edit) or are redundant surface (audit) — and v0.9.0 is the lead-in to the
> v1.0 *contract freeze*, so adding a subtly-wrong or redundant verb now is the
> expensive mistake. Both held items are documented above for the maintainer to
> green-light/redesign.

---

## Iteration 28: v1.0.0 — OAuth MCP (Claude.ai + mobile) + "Stability Commitment" + Security Audit

**Re-scoped 2026-07-08**: the OAuth-protected remote MCP server (Claude.ai / Claude
mobile / other cloud agents) is folded INTO this iteration as 28A (maintainer decision).
Rationale: the feature and the stability commitment travel together so the one-time
security audit (28B) covers the new OAuth auth surface in the same pass — the audit's
"every public endpoint requires auth" headline item must anyway be re-stated around the
two deliberately-public routes 28A introduces. v1.0.0 is thus a feature + contract
release. Work lands on `feat/oauth-mcp`.

**Goal**: (28A) any OAuth-discovering MCP client — claude.ai web, the Claude mobile app,
potentially ChatGPT connectors — can use the full 10-tool Cerefox surface; (28B) one-time
security audit over the final surface; (28C) the contract: strict SemVer policy from §11
of the polish design doc becomes binding.

**Trigger** (for 28B/28C; 28A can start immediately): ~2-3 months of v0.10/v0.11 in the
wild without breaking changes + at least one outside user installing without help.

### v1.0.0 release scope + remaining steps (updated 2026-07-10)

v1.0.0 grew into a large, multi-workstream release. **Branch strategy:** keep the
workstreams on separate branches, merge each into `main`, then cut `1.0.0-beta` from
`main` (each is independently reviewable/testable; squash-merge collapses history).

**Only two substantive workstreams remain for 1.0.0: (a) the full-codebase security
audit (28B ③) and (c) the chunking fix (28D Phase 0/1).** Everything else is done or a
cut-time step (28C contract; the Supabase "disable legacy API keys" toggle; recovering
the 4 chunker-corrupted docs, which rides on 28D).

| Workstream | Branch | Status | Remaining |
|---|---|---|---|
| **28A — OAuth MCP** (claude.ai + mobile) | merged to `main` (PR #91) | ✅ built + live-working | Phase 5 regression matrix (minor) |
| **28B — Security** (OAuth surface + RPC lockdown) | merged to `main` (PR #91) | ✅ deployed | ③ **full-codebase audit** (8 primitive EFs, GPT Actions, web app, backup/restore) — **(a), the main open item** |
| **28E — EF auth → Cerefox token** | `feat/ef-auth-token` (PR #92) | ✅ done + **validated in prod** (all 9 EFs redeployed, doctor green, live 45/45, OAuth confirmed) | in review — closes 28B ① (anon-key) + ② (secret cleanup) |
| **28F — Documentation sweep** | `feat/ef-auth-token` (PR #92) | ✅ done (exhaustive) | in review |
| **28D — Chunk reconstruction fix** | `fix/chunk-reconstruction` | 🔨 in progress | **Phase 0 embed cap + Phase 1 blind-stitch + doctor check — (c), the other open item** |
| **28G — Python retirement** | (new branch) | decided 2026-07-10, not started | deprecation notices (README / CLAUDE.md / migration guide / CHANGELOG) + Discord announce (maintainer) + husk/remove the Python code |
| **28C — Stability contract** | (at cut) | pending | strict SemVer becomes binding; `security-model.md` + threat model finalized |

**Held priority TODOs (do NOT lose these):**
1. **Neutralize the exposed anon key** — ✅ **effectively done via 28E** (all EFs reject it now).
   One residual step, deferred to just before the public release: flip **"Disable legacy API
   keys"** in the Supabase dashboard to close the Data-API surface (the maintainer chose to
   leave it enabled-but-unused for now; migration-1.0.md step 5). `CEREFOX_MCP_STATIC_BEARER`
   removed.
2. **Supabase/CF secret cleanup** — ✅ **done in 28E**: `CEREFOX_ACCESS_TOKENS` set via
   `cerefox token generate`; `CEREFOX_MCP_STATIC_BEARER` gone; `CEREFOX_SUPABASE_ANON_KEY`
   removed from the maintainer's `.env`; `cerefox-oauth-consent` EF **deleted** from the
   project (`supabase functions delete`). Keep `CEREFOX_OAUTH_OWNER_ID`, `CEREFOX_SUPABASE_PUBLISHABLE_KEY`.
3. **(a) Full-codebase security audit** — a main open item for 1.0 (8 primitive EFs, GPT
   Actions, web app, backup/restore); 28B extends with any new mitigations.
4. **Retire Python completely at v1.0 — DECIDED (2026-07-10), workstream 28G.** The last live
   Python path (`uv run cerefox mcp`) is retired; users who still rely on it stay on their
   current version until they migrate to the npm package. Deliverables: prominent deprecation
   notices (README, CLAUDE.md, migration guide, CHANGELOG) + Discord announcement (maintainer;
   agent drafts) + husk/remove the Python code. Unblocks 28D (no chunker parity).
5. **Fix `cerefox server deploy` from a repo checkout** — supabase `--use-api` git-root
   confusion (see the deploy-gotcha note below); end users unaffected. Low priority.

> **Note:** recovery of any chunker-corrupted documents is a private maintainer data task,
> intentionally **not tracked in this OSS repo** (it involves personal KB content).

**Release sequencing (decided 2026-07-09) — stay in `0.x` until all breaking changes land, then freeze 1.0:**
1. **`1.0.0-beta`** — finish **28E** (EF-auth migration, done *very carefully/defensively*) +
   **28F** (full documentation sanity sweep) + secret cleanup (②) → merge `feat/oauth-mcp` →
   `main` → cut the beta → **test extensively on the maintainer laptop** → *soft* Discord
   (beta testers only).
2. **`1.0.0-beta.N` betas** — the **full-codebase security audit** (③, + any mitigations) then
   **28D Phase 1** (proper chunker: `content_format` schema + blind-stitch).
3. **`1.0.0-rc` → `1.0.0`** once every breaking/schema change is in, audited, and soaked —
   the stability commitment (28C).
*Why not `1.0.0-RC` now:* RC implies "no more breaking changes," but 28E (client creds),
28D Phase 1 (schema), and audit mitigations are still breaking/schema-affecting. Under strict
SemVer they must land BEFORE the 1.0 freeze, or they'd force a 2.0.0. **Discord:** soft-launch
to testers on the beta; hold the broad public announce until after the full audit (③) — it's a
security-sensitive release, don't publicize new public surfaces before auditing them.

**Known deploy gotcha (2026-07-10, needs a follow-up fix).** `cerefox server deploy` FAILS when
the built bin is run *from inside the repo checkout* (`node packages/memory/dist/bin/cerefox.js
server deploy`): `supabase functions deploy --use-api` computes the entrypoint relative to the
detected project root and, with no `config.toml`, walks up to the **git root**, producing a
bogus `packages/memory/supabase/functions/<ef>/index.ts` path → `400 Entrypoint path does not
exist`. Adding a `config.toml` to the bundle did NOT fix it. **End users are unaffected** (they
run from an installed package outside any git tree). **Workaround used for the 28E cutover:**
`cp -R packages/memory/dist/server-assets /tmp/cfx-deploy && cd /tmp/cfx-deploy && for ef in …;
do npx supabase functions deploy $ef --use-api --no-verify-jwt --project-ref <ref>; done`.
**Proper fix (follow-up, separate branch):** have `cerefox server deploy` stage the resolved
`supabase/` + `_shared/` to an `os.tmpdir()` dir outside the git tree and deploy from there
(matches the installed-package layout; robust from any cwd). Also fixes local-e2e.

**Local e2e without a published release (decided 2026-07-10).** No registry publish is needed
to validate 28E end-to-end: `cd packages/memory && bun run build && npm link` (or `npm install
-g .`) makes the global `cerefox` the working-tree build (doctor/token/web/mcp), and `cerefox
server deploy` bundles the EFs from local `dist/server-assets/` (deploys the new token-gated
EFs, no publish — modulo the in-repo deploy gotcha above; deploy from the staged temp copy). MCP clients point at the linked local `cerefox mcp` bin (not the `npx
@cerefox/memory` form, which fetches the published version). So we **hold the first published
beta** until the batch (28E + audit + 28D) is soak-tested locally, rather than cutting a beta
just to test. **Deploy + e2e is a supervised step** (cutover order is lock-out-sensitive; touches
prod + EF quota) — not run unattended. **Back up prod first** (no staging env): `cerefox backup
create` (restorable JSON) + `bun scripts/cerefox_export.ts <folder>` (readable markdown); both
read via the Data API (secret key), unaffected by 28E.

**28E credential decision (2026-07-09): a Cerefox-managed token, NOT `sb_publishable_`.**
The publishable key is *public by design* (it's embedded in the consent Worker HTML, shipped
to clients), so gating the EFs on it = **no access control** (anyone who reads it gets full KB
access, since the EFs use `service_role` internally with no RLS). It only looks lower-friction
— it isn't (you'd still paste it into every client config), and it removes all security. The
Cerefox-managed token is the same paste-a-credential friction as today's anon key, but secret +
rotatable; friction is minimized by automating it (`cerefox token generate` creates + stores
the Function secret and prints the token to paste into the two remote paths). Note the token
touches only **GPT Actions** and the **remote HTTP MCP** — `configure-agent` writes a *local*
stdio MCP entry (Data API via the local server's own `.env`), so it needs no token and is
unaffected by 28E.

### 28A: OAuth 2.1 on `cerefox-mcp` — cloud/mobile Claude connectivity

**Design of record**: [`docs/specs/oauth-mcp-server-design.md`](specs/oauth-mcp-server-design.md)
— read it first. Derived from the maintainer's 2026-07-07 research handoff (KB doc
`92996524-…`). The unblock: Supabase shipped a native **OAuth 2.1 Server** (beta
2025-11-26), dissolving the GoTrue `/.well-known` conflict that forced the 2026-03-15
deferral (`docs/research/oauth-mcp-auth.md`).

- Supabase-native OAuth 2.1 (authorization code + PKCE + DCR); no new infrastructure.
- `cerefox-mcp` becomes an RFC 9728 protected resource: serves its own
  `.well-known/oauth-protected-resource`, returns 401 + `WWW-Authenticate`, validates
  OAuth JWTs against the project JWKS in-function (new unit-tested `_shared/mcp-auth/`),
  deployed `--no-verify-jwt`.
- **Back-compat invariant**: legacy static-Bearer (anon JWT) keeps working for Claude
  Code / Cursor / Codex / Gemini / Desktop bridges — validated in-function by
  constant-time compare against an explicitly-set Function secret.
- New public consent-page EF (`cerefox-oauth-consent`); owner user in GoTrue; per-EF
  deploy-flag map in `deploy-server.ts` (only these two EFs skip gateway JWT).
- No schema/RPC changes (no `schema_version` bump); GPT Actions block untouched.
- Phases 0–6 in the design doc (preflight → Supabase config → consent page → resource
  server → connect Claude → regression → docs). Fallback if the native path fails:
  Cloudflare Worker OAuth proxy (design §12).
- **Quick win tested in Phase 0 — NOT available** (2026-07-08): the claude.ai beta
  "Request headers" static-auth rollout hasn't reached the maintainer's account (dialog
  shows only OAuth Client ID/Secret advanced fields). OAuth build confirmed as the only
  path. Silver lining: the dialog confirms pre-registered-client credentials are
  supported → the DCR fallback (design §4.2-D) is a verified UI affordance. Connector
  name will be **CerefoxMCP** (design §4.4 outcome note).
- **Phase 0 ✅ COMPLETE (2026-07-08)**: OAuth Server available on the maintainer plan;
  signing keys **already ES256/P-256** (migration prerequisite moot); Site URL was the
  unused `localhost:3000` default.
- **Phases 2–3 code ✅ BUILT (2026-07-08), not yet deployed.** Commit on `feat/oauth-mcp`.
  Shipped: `_shared/mcp-auth/` (dependency-free token validation — static constant-time
  compare + OAuth JWT via SubtleCrypto against the project JWKS, ES256/RS256 allowlist,
  iss/aud/exp/owner-sub, fail-closed, isolate JWKS cache; **20 unit tests green**, runs
  under both Deno and Bun); `cerefox-mcp` auth-first dispatch + RFC 9728 metadata route +
  401/`WWW-Authenticate` (405-for-GET and `/version` preserved); new public
  `cerefox-oauth-consent` EF (client-side sign-in + approve/deny, `location.assign`
  redirects so no 307 per #250, graceful consumed-`authorization_id` per #562);
  `deploy-server` `NO_VERIFY_JWT_EFS` map (only the two EFs skip the gateway) + secret
  reminder; `bundle_server_assets` ships `_shared/mcp-auth`. Docs updated:
  setup-supabase Step 7 (OAuth config) + connect-agents Cloud Claude (OAuth).
- **Phase 1 dashboard (maintainer, 2026-07-08)**: OAuth Server **enabled**, DCR left
  **disabled** (pre-registered client instead), Site URL repointed to the consent EF,
  owner user created (UUID `0b850e27-…`). **Remaining before Phase 4**: set the two
  Function secrets (`CEREFOX_MCP_STATIC_BEARER`, `CEREFOX_OAUTH_OWNER_ID`), register the
  Claude OAuth App (redirect `https://claude.ai/api/mcp/auth_callback`), then
  `cerefox server deploy --functions-only`.
- **Phase 2/3 deployed + live-verified (2026-07-08).** `cerefox-mcp` + secrets
  (`CEREFOX_OAUTH_OWNER_ID`, `CEREFOX_MCP_STATIC_BEARER`) deployed. Live curls pass:
  RFC 9728 metadata (https, exact `resource` match), 401+`WWW-Authenticate` on
  unauthenticated POST, `tools/list` with the anon key → 10 tools. Two live fixes: the
  `http→https` metadata scheme bug, and the injected `SUPABASE_ANON_KEY` not
  authenticating (→ explicit `CEREFOX_MCP_STATIC_BEARER` required). **Consent page
  moved to a Cloudflare Worker** (Supabase EFs rewrite html→text/plain on the default
  domain) — deployed to `https://cerefox-consent.f-stamatelopoulos.workers.dev`,
  verified serving real `text/html` with the project URL + anon key injected.
- **Phase 4 ✅ DONE (2026-07-08) — claude.ai web + mobile connected over OAuth, all 10
  tools, verified live (tools/list + a hybrid search from claude.ai).** Two live-only
  gotchas resolved: (R1) the consent page must redirect immediately when consent was
  already granted (`getAuthorizationDetails` returns only a `redirect_url`; approving an
  already-resolved request 400s "no longer pending"); (R2) the Supabase OAuth app must use
  **`client_secret_post`** (request body), not `client_secret_basic` — Claude sends the
  secret in the body, and the basic default failed the token exchange with an opaque
  `ofid_` error. Debugging lesson: the token-exchange failure is invisible in the Edge
  Function logs (only `no_token` discovery probes reach the function) — it lives in the
  Supabase **Auth** logs. Full write-up: Decision Log Q3 Part 1 (KB) "Resolution".
- **Next: Phase 5** — regression matrix for the static-Bearer clients (Claude Code /
  Cursor / Codex / Gemini / local MCP) confirming the OAuth work didn't disturb them
  (`tools/list` with the anon key already re-verified → 10 tools). Then **28B** (security
  audit over the OAuth surface, Fable 5) and **28C** (v1.0 stability commitment).
- All platform claims re-verified against live Supabase/Anthropic docs 2026-07-08
  (design §14 has the verification table; re-check before each phase).
- **Beta caveat**: Supabase's OAuth server is beta. If Phase 4 shows instability, soak
  the feature in a 1.0.0-beta pre-release and stamp v1.0.0 after it settles.

### 28B: Security audit

**Security audit headline items** (added 2026-05-29 per Fotis-24; extended 2026-07-08
for 28A — audit runs on the **Fable 5** model per maintainer):

- Every public-facing endpoint (Edge Functions including the new `/version` aggregator, GPT Actions OpenAPI block) requires Bearer JWT auth — verify none accidentally allow anon access. Cerefox treats every byte as personal/sensitive. **Re-stated for 28A**: the only deliberately-unauthenticated surfaces are `cerefox-mcp`'s RFC 9728 metadata route + 401 challenge and the `cerefox-oauth-consent` page; everything else on the two `--no-verify-jwt` functions is gated in-function (auth-first dispatch, fail-closed, constant-time compare, JWT alg allowlist — full invariant list in the design doc §6).
- Threat-model review: write-access paths (`cerefox-ingest`, MCP `cerefox_ingest`/`cerefox_set_document_projects`), audit-log integrity (immutability guarantees), backup file handling, `~/.cerefox/.env` mode 0600 enforcement, **plus the OAuth token-validation paths and the consent flow (28A)**.
- Dependency audit (`bun audit`, `npm audit`) — clean tree at v1.0 cut.
- Secrets scanner (`gitleaks` or similar) on the repo history — verify no credentials ever committed.
- Document the threat model + audit findings in `docs/specs/security-model.md` (new) — part of the v1.0 deliverable.

### 28B (extended 2026-07-09): deployed OAuth-surface fixes

The OAuth-surface audit ran 2026-07-09 and **shipped fixes** (schema 0.7.0 + EF/Worker
redeploys, live-verified): closed a Data-API RPC execute-privilege gap (SECURITY DEFINER
RPCs now `service_role`-only); the OAuth consent page uses the public-safe publishable key
(not the anon JWT); issuer/JWKS derive from `SUPABASE_URL`; the OAuth path fails closed
when the owner isn't pinned. Full technical record: Decision Log Q3 Part 1 (KB, private —
exploit specifics kept out of public docs). Public reference: `docs/specs/security-model.md`.
**Still owed (see the held-TODOs table above): anon-key rotation, secret cleanup, and the
FULL-codebase audit** of the 8 primitive EFs, GPT Actions, web app, and backup/restore.

### 28D: Chunk-reconstruction fix (data-corruption bug)

> 🔨 **IN PROGRESS (2026-07-10) on `fix/chunk-reconstruction`.** Interim keep-whole fix already
> on `main`; now building the proper fix: Phase 0 (embedding-input cap) + Phase 1 (exact-partition
> chunker + `content_format` column + branch all **5** reconstruction sites + schema 0.7.0→0.8.0
> + doctor migration check). **Python chunker parity dropped** (Python retired at v1.0, 28G).
> One open item **(c)** for 1.0.

**Design**: [`docs/specs/chunk-reconstruction-design.md`](specs/chunk-reconstruction-design.md).
Branch `fix/chunk-reconstruction`. A serious data-corruption bug: `cerefox_reconstruct_doc`
re-synthesizes a `\n\n` separator it never stored, so any chunk split not on a paragraph
boundary corrupts on read (duplication via a 50%-overlap hard-split, or a blank line
mid-word/mid-row). 4 KB docs were corrupted.

- **Interim fix (SHIPPED on `feat/oauth-mcp`)**: keep oversized single paragraphs whole →
  lossless for realistic docs; regression test asserts `reconstruct(chunk(doc)) === doc`.
- **Phase 0**: cap the embedding input to the model token limit (+ warn) so a huge whole
  chunk never fails ingest.
- **Phase 1**: exact-partition chunker + heading context moved to the embedding input +
  a `content_format` marker on `cerefox_documents` (schema 0.7.0 → 0.8.0) + versioned
  reconstruction (blind-stitch for new docs, `\n\n`-join for legacy) + **lazy migration**
  (docs convert on next edit; no forced re-embed) + a `cerefox doctor` legacy-format count.
- **Data recovery**: restore the 4 corrupted docs from their last clean version.

### 28E: Migrate Edge Function auth off the unrotatable legacy anon JWT

> ✅ **DONE + validated in prod, merged to `main` via PR #92 (2026-07-10).** All 9 EFs
> `--no-verify-jwt` + token gate; `cerefox token` command; doctor/tests on the token; consent
> EF removed. `cerefox doctor` green, live e2e 45/45, OAuth confirmed. Details below are the
> as-built record.

**Design-of-record**: [`docs/specs/ef-auth-migration-design.md`](specs/ef-auth-migration-design.md)
(the full, self-contained design + defensive rollout order — start there).

**Problem (surfaced by the 2026-07-09 rotation attempt).** Supabase's Edge Function gateway
is JWT-only — it rejects the new `sb_publishable_`/`sb_secret_` keys (verified 2026-05-18:
the gateway returns `UNAUTHORIZED_INVALID_JWT_FORMAT` for non-JWT keys). So the 8 primitive
EFs (ChatGPT GPT Actions + direct HTTP) and `cerefox-mcp`'s static-Bearer path require the
**legacy anon JWT**. On a project migrated to asymmetric
(ES256) signing keys — Supabase's default direction — the legacy anon key **can only be
revoked, not rotated** (revoking kills the whole EF path). So **any Cerefox user whose anon
key leaks is stuck**: they can't cycle it without disabling GPT Actions / remote MCP. A real
security gap for every user on the anon-key/EF path (not just the maintainer).

**Fix — full design in [`docs/specs/ef-auth-migration-design.md`](specs/ef-auth-migration-design.md).**
Deploy the 8 primitive EFs with `--no-verify-jwt` and validate the caller's credential
**in-function**, using a **rotatable, appropriately-scoped Cerefox-managed access token** —
NOT a Supabase key:
- **Why not the Supabase keys:** `sb_secret_` is full-DB (service_role) — handing it to a
  ChatGPT GPT Action / remote client config means a client compromise = full DB access via
  the Data API (worse than the anon key). `sb_publishable_` is public by design — accepting
  it in-function is no auth at all. So the credential is a **random Cerefox-owned token**
  stored as a Function secret (the expected value), given to clients, constant-time-compared
  in-function; the EF still uses its own `service_role` internally (never leaves the server).
  Rotatable = regenerate the secret + re-issue to clients.
- Reuse/extend the in-function auth pattern from `_shared/mcp-auth/` (iter-28A) — a shared
  constant-time token check for the primitive EFs AND `cerefox-mcp`'s (removed) static path.
- **Retire the legacy anon JWT for all EF paths — hard cutover, no back-compat window.**
  Single-user project, so each deployer updates their own clients then flips to token-only (a
  clean breaking change at the `1.0.0-beta` boundary). Migration docs for the two affected
  client classes: **old remote static-Bearer MCP** and **ChatGPT GPT Actions**.
- Update the GPT Actions OpenAPI block (auth scheme → the token in a header; `info.version`
  bump) + the remote-MCP client + connect-agents docs.
- **Priority: implement next** (maintainer 2026-07-09) — it's the enabler for fully retiring
  the legacy JWT + closing the maintainer's own residual anon-key risk. Overlaps 28B.
  Interim already done: `CEREFOX_MCP_STATIC_BEARER` removed on the maintainer project.

### 28F: Documentation sanity sweep

> ✅ **DONE (2026-07-10), merged to `main` via PR #92.** Exhaustive whole-repo sweep — every
> guide, spec, README, CLAUDE.md, `.env.example`, `SECURITY.md`, `docs/examples/mcp-configs/`,
> and code comments aligned to the token narrative; consent-EF refs removed; EF count reconciled
> (9); `cerefox token generate` added to the install flows; **functional** stale refs fixed
> (`scripts/sync_docs.ts`, `check_ef_parity.ts`, web-integration `_helpers.ts` would have 401'd).
> The checklist below is the as-built record.

The access-path narrative shifted materially across 28A (OAuth), 28B (security), and 28E
(token + legacy-JWT retirement). Before the beta cut, do **one full documentation pass** to
make every guide tell the *same* new story. This is broader than 28E §8's targeted edits — it's
a whole-repo consistency check. Target: v1.0.0-beta (part of step 1 in the sequencing block).

**The single narrative every doc must reflect:**
- **Local agents** (Claude Code, Cursor, Codex, Gemini, Desktop) → **local MCP** via
  `cerefox configure-agent` (stdio, Data API, no EF token). *Preferred.*
- **Cloud Claude** (web/mobile) → **OAuth** connector to `cerefox-mcp`.
- **Custom GPT** → **GPT Actions** + the **Cerefox token**.
- **Remote HTTP MCP** → token (Advanced/fallback only; not the headline).
- **Legacy anon JWT is retired** for all EF paths (hard cutover, 28E). `CEREFOX_MCP_STATIC_BEARER`
  is gone. New `cerefox token generate/rotate/list` + `CEREFOX_ACCESS_TOKENS` Function secret.

**Docs to review (checklist):** `docs/guides/{connect-agents,access-paths,setup-supabase,
quickstart,configuration,setup-local,setup-cloud-run}.md`, `CLAUDE.md` (Layer-1 auth note +
Client-Compatibility table + EF inventory), `docs/solution-design.md` (auth layers),
`docs/specs/security-model.md` (new invariant: all data EFs in-function-auth'd on a rotatable
token), `README.md`, `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`, and the `CHANGELOG.md` beta
entry. Sync the GPT Actions OpenAPI block (`info.version` bump) per the CLAUDE.md rule.

**Migration guide + `.env`/secrets cleanup (upgrade path for existing deployers).** Add/refresh
the versioned migration guide (`docs/guides/migration-*.md`) with a **".env / secrets changes"**
section:
- **Remove** (now obsolete): `CEREFOX_MCP_STATIC_BEARER`; any anon-key var used *only* for the
  remote-MCP/EF static path.
- **Add** (server-side Function secret, set by `cerefox token generate`): `CEREFOX_ACCESS_TOKENS`.
- **Unchanged**: the local MCP's `CEREFOX_SUPABASE_URL` + secret key (Data API path) — 28E does
  not touch it.
- **Client cutover steps**: re-point GPT Actions + remote HTTP MCP to the token, then **revoke
  the legacy anon key** in Supabase (the per-deployer order from 28E §6/§11).
- Confirm `configuration.md` documents `CEREFOX_ACCESS_TOKENS` and drops any retired var.
  (Maintainer also cleans their own local `.env` per this section.)

**EF-count reconciliation.** Authoritative count after 28E = **9 Edge Functions = 8 primitive
+ `cerefox-mcp`** (the consent EF is deleted). Note the "9 Edge Functions" *deploy* references
(README, `cli.md`, `upgrading.md`, `setup-supabase.md`, `ops-scripts.md`, `connect-agents.md`,
`solution-design.md`, `requirements-and-specs.md`, `bundle_server_assets.ts`) are **correct
again** — they predated the consent EF; leave the number, just make sure none *enumerates*
`cerefox-oauth-consent` within the nine. Real fixes: `access-paths.md:28` ("The nine Edge
Functions" list — must be the 8 primitive + `cerefox-mcp`, no consent) and **`CLAUDE.md:259`**,
whose auth text is now stale on two counts — it says the primitive EFs "keep Layer-1 gateway
validation" (now `--no-verify-jwt` + in-function token) and that `cerefox-mcp` accepts the
legacy anon JWT (retired; it's OAuth or the Cerefox token). Also refresh the CLAUDE.md
Client-Compatibility table + EF inventory + the "OAuth path" paragraph accordingly.

**Consent-EF removal (done in code on `feat/ef-auth-token`; docs pending in the sweep).**
`cerefox-oauth-consent` was deleted in iter-28E (the Cloudflare Worker is the one consent
path; `_shared/consent-page` is retained — the Worker still imports it). Purge/adjust the
doc references: `docs/specs/oauth-mcp-server-design.md` (L157/164/341/359/361/405 — mark the
EF as removed, not "retained template/alternative"), `docs/specs/security-model.md` (L74/78),
`docs/guides/access-paths.md` (L92), `docs/guides/setup-supabase.md` (L248 custom-domain
alternative), `cloudflare/cerefox-consent/README.md` (L66), `CLAUDE.md` (L259), and the
`docs/plan.md` iter-28A notes (L3244/3265/3309). Operator step (server-side, maintainer runs
it): `npx supabase functions delete cerefox-oauth-consent`.

**Grep gates (must return nothing stale after the sweep):** any lingering `CEREFOX_MCP_STATIC_BEARER`;
any "anon JWT"/"legacy anon"/`Bearer eyJ` shown as the *current* way to connect an EF/GPT-Action
client (historical/iteration-log mentions are fine); any doc still pointing local agents at the
remote MCP as the default. Do the grep, fix or annotate each hit.

### 28G: Python retirement (v1.0.0)

> Decided 2026-07-10. Not started; own branch (after/alongside 28D).

Cerefox's Python side is already husked to a single live path — the frozen MCP fallback
`uv run cerefox mcp` (CLI + web app retired to husks in v0.9.0). **v1.0.0 retires Python
entirely.** Users who still rely on the Python MCP stay on their current version until they
migrate to the `@cerefox/memory` npm package; they do not need to upgrade to 1.0.0.

Deliverables:
- **Prominent deprecation notices**: README, `CLAUDE.md`, the migration guide, and CHANGELOG —
  "Python is retired at v1.0; if you use `uv run cerefox mcp`, migrate to the npm package or
  stay on ≤0.11.x." Draft the **Discord announcement** (maintainer posts it).
- **Husk / remove the Python code**: `src/cerefox/` (mcp_server.py + the frozen chunking /
  ingestion / embeddings / db modules), `pyproject.toml`, the `uv` tooling. Decide husk-with-
  pointer vs. hard-delete (husk is friendlier for a major-version cut).
- Removes the chunker parity requirement (unblocks 28D §4.2) and the `python-parity` fixtures.

### 28C: The contract

Strict SemVer becomes binding. **Design**: [`docs/specs/polish-and-distribution-design.md` §13 v1.0.0](specs/polish-and-distribution-design.md).

---

## Iteration 29: Document Relations & Semantic Graph (post-v1.0, target v1.1+)

**Goal**: Add explicit document-to-document relations (`related_to`, `references`,
`supersedes`, etc.) on top of Cerefox's existing many-to-many `cerefox_documents` ↔
`cerefox_projects` model. Enables semantic-graph traversal, "what links here" navigation,
high-fan-in truncation, and explicit cross-document context propagation. The web-UI
link-resolver shipped in v0.1.19 is a sister piece — same problem domain (cross-doc
references) at the rendering layer; this iteration adds it at the data-model layer.

**Status**: independent of the polish & migration arc (Iterations 19-28). The polish arc
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

## Iteration 30: Local / Self-Hosted Cerefox Backend (D1) — target v0.10.0

**Status: Designed, not started.** Design of record:
[`docs/research/local-cerefox-design.md`](research/local-cerefox-design.md) — **read
it first**: topology, the data-access audit, the D1 decision, the supabase-js↔PostgREST
version-coupling caveat, and the phase breakdown. Work lands on `feat/local-cerefox`.

**Goal**: a fully local / self-hosted Cerefox backend so a single user (and their
agents) can run Cerefox with no cloud dependency — **Postgres+pgvector + PostgREST +
the existing cerefox-server**, shipped as one container.

**Core decision (locked): D1 — ship PostgREST in the container.** The local backend
exposes the same Data API (PostgREST) as the cloud, so the **CLI, local MCP server,
and web app are unchanged** (only `.env` URL+key differ). No CLI/MCP fork, no new
data-access code; PostgREST is a stock OSS component we configure. A pg-driver shim
that drops PostgREST is a captured **future option**, not in scope.

**Version target — maintainer decision (recommend v0.10.0).** This is a substantial
*additive* feature (a new deployment mode) → a **minor** bump, **not** a v0.9.x patch.
Two sequencing options:
- **v0.10.0 (recommended): ship before v1.0** — land + stabilize local in 0.x (breaking
  changes still allowed) so the v1.0 stability commitment (Iteration 28) covers *both*
  cloud and local. Pushes v1.0 out by this work.
- **Post-v1.0 (v1.1): ship cloud-first 1.0, add local after** — mirrors the Iteration-29
  rationale (keep v1.0 focused). Local is contract-light either way (same schema / RPCs /
  tools — only packaging + a config switch), so risk to the v1.0 contract is low.

### Phases (map 1:1 to design doc §12)

- **P0 — spike: ✅ DONE (2026-06-02).** `docker/local/` (pgvector + pinned PostgREST
  `v14.12` + Caddy gateway) + first-boot `db_deploy.ts` + roles; the **unmodified** CLI
  + web validated end-to-end (project create/list, ingest w/ 768-dim embeddings, hybrid
  + FTS search, web UI). Surfaced 3 findings (design §5.6) — corrected the earlier
  anon-localhost assumption to **JWT-always + a `/rest/v1` gateway**.
- **P1 — all-in-one image + hardening:** *(status 2026-06-04: ✅ **DONE + validated** —
  `docker/local/Dockerfile` + `docker/local/s6/` build a single-container local
  Cerefox; one `docker run` → `/app/` + project CRUD + ingest (OpenAI→pgvector) +
  hybrid search all work, data in a named volume. The `/rest/v1` proxy is in
  cerefox-server (`registerPostgrestProxy`); the stack is **supervised by s6-overlay**
  (auto-respawn of a killed service validated). The **ghcr publish** workflow
  (`.github/workflows/local-image.yml`) and the **version-coupling** workflow
  (`.github/workflows/version-coupling.yml`, runs `smoke.sh` vs the pinned PostgREST)
  are drafted + locally validated; they need a CI run + (ghcr) the package set Public.
  **Remaining: those CI runs, install.sh/init integration, and a
  `schema-version.bundled=null` cosmetic.**)*
  Dockerfile (`pgvector` base + PostgREST +
  cerefox-server + s6-overlay; **app code as the top layer**); mounted **PGDATA volume**;
  entrypoint creates **roles BEFORE PostgREST starts** (ordering — design §5.6) →
  first-boot deploy → serve; healthchecks; `OPENAI_API_KEY` env. **New code: a
  config-gated, local-only `/rest/v1` reverse-proxy route in cerefox-server → PostgREST**
  (no separate Caddy; inert in cloud — design §5.2).
  **Version-coupling CI suite**: run read/write/MCP tests against the
  **pinned local PostgREST** (not just cloud); pin PostgREST next to `postgrest-js`; a
  `supabase-js` bump must run it; add a `RELEASING.md` line; optionally extend
  `_shared/compatibility` + `cerefox doctor`. Test on laptop + workstation + a 4 GB NAS.
  **Acceptance:** `docker run` + volume → working local Cerefox that survives container
  recreate; CI compat suite green.
- **P2 — distribution + installer + init:** *(status 2026-06-05: the first-cut
  installer is ✅ validated — `docker/local/install-local.sh`, Model B: per-install
  openssl secret → inject (`-e PGRST_JWT_SECRET`) → mint `service_role` JWT → SEPARATE
  `~/.cerefox/local` client config. **SUPERSEDED by the "P2 finalized" subsection below
  (2026-06-05): host-side JWT minting is dropped — the JWT never leaves the container —
  and the local world gets its own `cerefox-local` host script instead of reusing the
  npm CLI.** ghcr.io multi-arch publish is ✅ done + validated.)*
  multi-arch (`amd64`+`arm64`) build + push to
  **ghcr.io** via `release.yml` (`docker buildx`); 2-service split compose (official
  pgvector + app image) for independent app updates; **thin installer wrapper** (extend
  `install.sh`/`cerefox init` to optionally set up the Local Server — pull image, wire
  volume + port, never build). **Installer JWT logic (design §5.2):** generate a
  per-install `PGRST_JWT_SECRET`, inject into the container, mint a `service_role` JWT,
  and write it into the clients' env (`CEREFOX_SUPABASE_KEY`); rotate + re-write clients
  on reinstall. `cerefox init` "local server" mode (host `server.env` + client URL);
  `docs/guides/setup-local-server.md`. **Acceptance:** one-command install on a fresh
  machine → working local Cerefox; ghcr.io image for amd64+arm64.
- **P3 (roadmap) — local embedder:** transformers.js/ONNX, 768-dim (e.g.
  `nomic-embed-text`), opt-in behind the `Embedder` protocol; reindex-on-change docs →
  fully offline. Separate sub-iteration.
- **Later (v2 of this feature) — remote HTTP-MCP** in cerefox-server (mount the
  `cerefox-mcp` handlers over HTTP) for LAN/remote agents. Deferred per "build/test
  everything else first."

### P2 finalized (2026-06-05): two parallel install "worlds" — design locked

**Framing (maintainer):** cloud (Supabase) and local are **mutually exclusive worlds** —
practically nobody runs both. Don't blend them: two separate installers, two separate
command names, so they can't collide *even if* one person runs both (e.g. local for
opencaw/nemo/hermes, cloud for other work).

- **World A — cloud/Supabase (UNCHANGED):** existing `install.sh` one-liner → npm
  `@cerefox/memory` → `cerefox` (CLI + local web + local MCP) → talks to Supabase.
- **World B — local/self-hosted (NEW):** a *separate* one-liner installs the all-in-one
  container **plus a host `cerefox-local` script**. **Docker-only — no Node/Bun on the
  host** (the image already bundles the `cerefox` binary at `/usr/local/bin/cerefox`).

**Key simplification vs. the first-cut Model-B installer — the JWT never leaves the
container.** Every JWT consumer (web server, CLI, MCP) runs *inside* the container, so:
- db-init **self-generates** `PGRST_JWT_SECRET` on boot and mints the `service_role`
  JWT into `/run/cerefox-runtime.env` (tmpfs). No host openssl mint, no
  `-e PGRST_JWT_SECRET`, no JWT persisted anywhere — regenerated + re-consumed
  in-container each boot.
- The **only** host-side secret is `OPENAI_API_KEY`, kept in a minimal
  `~/.cerefox/local/.env` (OPENAI-only) so `upgrade` can re-pass it on container recreate.

**`cerefox-local` — one host script; handles host concerns, proxies KB verbs into the
container** (the host-vs-in-container split):
- **Host-handled verbs:** `start|up`, `stop|down`, `restart`, `upgrade` (pull + recreate,
  re-pass OPENAI), `uninstall` (`rm -f`; `--purge` for the volume), `status`, `logs [-f]`,
  and **`configure-agent`** (must write the *host's* MCP client config — the in-container
  CLI can't reach `~/.claude.json`).
- **Proxied (everything KB-touching):**
  `docker exec -i <container> sh -c '. /run/cerefox-runtime.env; exec cerefox "$@"'` — so
  `cerefox-local search/ingest/document/project/.../mcp` run the in-container binary
  against the local server, JWT sourced at exec time. MCP stdio passes through
  `docker exec -i`.

**Program name:** the bin reads `CEREFOX_PROG_NAME` →
`program.name(process.env.CEREFOX_PROG_NAME ?? "cerefox")`; the shim sets
`-e CEREFOX_PROG_NAME=cerefox-local` so help/usage/completion read `cerefox-local`. **One
binary, no fork.** Gap: host-only verbs aren't in the container's commander → the shim
prints a short preamble for them and delegates the rest of `--help` to the container.
Completion = deferred polish.

**Installer (path-2; replaces host-mint Model B):** (1) `docker pull` + `docker run` the
image (`-e OPENAI_API_KEY`, `-p PORT:8000`, named volume) — container self-gens the JWT;
(2) write `~/.cerefox/local/{.env (OPENAI only), cerefox-local}` + put the script on PATH
(symlink into `~/.local/bin`); (3) optional `cerefox-local configure-agent`; (4) ships as
a Release asset → `curl -fsSL …/releases/latest/download/install-local.sh | sh`.

**`cut_release.ts`:** uploads `install-local.sh` as a Release asset (mirrors `install.sh`)
and gates the ghcr image build+push behind **`--docker-publish`** (off by default,
mirroring `--npm-publish`) — it dispatches `local-image.yml` (`publish_latest=true` for a
stable version). `local-image.yml` is **dispatch-only** (no `release: published` trigger):
a GitHub Release is a milestone; shipping npm/ghcr artifacts is a uniform opt-in. So a
full v0.10.0 cut is `bun scripts/cut_release.ts 0.10.0 --npm-publish --docker-publish`.

**Docs:** rewrite `docs/guides/setup-local.md` around World B (one-liner + `cerefox-local`
lifecycle + MCP wiring); pointer from `quickstart.md`; include in the **bundled** guides
(so `cerefox guides` + the Help page show it).

**Scope + validation:** all of the above is **in v0.10.0** (decision 2026-06-05).
Validation requires cutting v0.10.0 and publishing to **both** npm + ghcr, then running
**both** one-liners on a clean machine.

**Open micro-decisions (resolve during build):** `--help` preamble vs. accept-partial
help; whether `configure-agent` gets a first-class in-bin `--local` (docker-exec) mode or
stays installer-written; PATH mechanism (`~/.local/bin` symlink vs. shell-rc export).

**Status 2026-06-05: World-B core BUILT + validated end-to-end** (against an isolated
test container: install → `cerefox-local` proxy KB round-trip with real embeddings → MCP
handshake 10 tools → lifecycle verbs). Commits on `feat/local-cerefox`. Shipped:
`CEREFOX_PROG_NAME`, the `cerefox-local` host script (bundled + `docker cp`'d out,
self-refreshing on `upgrade`), simplified `install-local.sh` (no host JWT minting;
`--restart unless-stopped` + readiness wait), `cut_release.ts` asset upload, rewritten
`setup-local.md` + quickstart pointer.

**Added to v0.10.0 after the build (real gaps, not polish):**
- [x] **`cerefox-local init`** — post-install OpenAI-key setup (the `curl | sh` installer
  can't prompt; stdin is the piped script). Prompts or `--openai-key`/`--port`, persists to
  `~/.cerefox/local/.env`, recreates to apply. Also key rotation / port change.
- [x] **Gate cloud-`.env` messaging** — neutral host-config comment; only mention
  `~/.cerefox/.env` when it exists and we borrowed its OpenAI key (a pure-local user never
  had a Supabase install). Dropped the old "your cloud .env is untouched" line.
- ~~Fold `install-local.sh` into `install.sh` / `cerefox init`~~ — **dropped**: contradicts
  the two-separate-worlds framing (World B is Docker-only; there is no host `cerefox init`).

**Shipped in v0.10.1** (PR #82, released 2026-06-05): the resource-verb min-search-score
regression + the full `.env`-override restoration (min-search-score, max-response-bytes,
chunking, versioning, backup-dir, OpenAI embedding base-url/model/dims), the phantom-config
guard test, port auto-select, Docker detect-and-guide, the World-B config passthrough, and
the doc quick-fixes.

**Shipped in v0.10.2** (PR #83, on `feat/local-cerefox`): CLI `--max-bytes` honors
`CEREFOX_MAX_RESPONSE_BYTES`; web docs-mode `min_score` fix (the v0.10.1 fix missed the
default mode); **local container binds `127.0.0.1` by default** (LAN opt-in via
`CEREFOX_LOCAL_BIND`); **`cerefox-local` runtime port re-check + auto-step**; World-B doc
sections; **program-name-aware shell completion** (`cerefox-local completion` works,
non-clashing); **`cerefox-local configure-agent --tool X` for all clients** (bin `--local`
flag + one-shot `docker run --entrypoint` writer reuse); and a **comprehensive doc sanity
sweep** (killed Fireworks-as-working claims, de-Pythonized CONTRIBUTING, cloud-vs-local
correctness across the guides).

**Done (were deferred polish, now completed attended in v0.10.2):**
- [x] `cerefox-local` shell completion — parameterized off the program name; cloud output
  byte-identical, `cerefox-local` namespaced. (`completion.ts`)
- [x] `configure-agent --local` — bin flag + host auto-wire for Claude Desktop / Cursor /
  Codex / Gemini via `docker run --entrypoint` (Claude Code via host `claude mcp add`).
- [~] `cerefox-local --help` "merge" — left as the two-section output (host verbs + the
  in-container KB `--help`); it works and reads clearly, so not worth a fragile merge.

**Still deferred (lower-value / heavier):**
- [ ] Local live-test wiring: point the read/write suites at the local container (extract
  its in-container JWT for the test) so the same suite runs against cloud **and** local.
- [ ] `schema-version.bundled=null` image cosmetic (doctor shows a null bundled-schema in
  the container context). Cosmetic only.

**Testing convention (local):** use the **single** default local container
(`cerefox-local` / volume `cerefox_local_pgdata`) — the local analogue of the maintainer's
"production" cloud install. Treat it as carefully as cloud; **do not** spin up a second
DB; self-clean `[E2E …]`-prefixed artifacts after each run (same discipline as the cloud
live suites).

**Captured risk — transient PostgREST first-boot segfault.** PostgREST (Haskell/GHC) can
crash with signal 11 once on a *fresh* first boot; `S6_BEHAVIOUR_IF_STAGE2_FAILS=2` makes
that fatal to the container. Mitigated by `--restart unless-stopped` (Docker re-runs it;
the 2nd boot is clean) — intermittent, not deterministic, in local testing. If it proves
more frequent, revisit: a postgrest run-script retry/backoff or `S6_…FAILS=1` (warn +
in-place supervise-restart) instead of relying on the Docker restart cycle.

### Risks / build-time decisions
- **Version coupling** (supabase-js ↔ pinned PostgREST) — CI compat suite is the
  mitigation (design §6-coupling). **Note:** World B mitigates this *by construction* —
  CLI/web/server/PostgREST/schema all ship in one versioned image, so they can't drift.
- **Untested `docker-compose.yml`** — P0 replaces/validates it.
- **Security** — localhost-bound by default; `PGRST_JWT_SECRET` + token (and/or reverse
  proxy) for LAN; least-privilege PostgREST DB role.
- **Open (resolve during build)**: exact PostgREST version pin; anon-vs-JWT for localhost;
  ship the 2-service split day one?; `cerefox init` local-server UX (design §11).

**Detailed P0 task breakdown to be created when the iteration starts.**

---

## Current Focus

**Update (2026-07-11, end of session — 28D Phase 0 + Phase 1 CODE-COMPLETE on
`fix/chunk-reconstruction`, pushed, NOT deployed).** Everything is built + unit-tested; the only
thing left is the **supervised deploy of schema 0.8.0 + live round-trip validation** (per the
agreed plan). What landed:
- **Chunker**: exact-partition `chunkMarkdown` (invariant `blindStitch(chunk(doc))===doc.trim()`,
  structural + 27 cases / 1178 assertions incl. adversarial); the 3 duplicate TS chunkers
  consolidated into `_shared/ingest/chunker.ts` (verified content_hash is doc-level → dedup safe;
  callers field-compatible).
- **DB (schema 0.7.0→0.8.0)**: `content_format` on **`cerefox_chunks`** (migration 0012;
  chunks-level so archived versions keep their format); ingest RPC `p_content_format`; all 5
  reconstruction sites branch on `MAX(content_format)>=2`; `cerefox_content_format_stats()`.
- **Callers**: mcp-tools/ingest, pipeline (via client-bridge `contentFormat`), and the
  cerefox-ingest EF all pass `content_format=2` + build embedding input with the heading
  breadcrumb (`embeddingInputFor`).
- **Doctor**: ℹ "N of M docs use the legacy format" → points to `cerefox guides show content-format`.
- **Docs**: bundled `docs/guides/content-format.md`; CHANGELOG proper-fix entry.

**Expected until deploy:** the default `packages/memory` `bun test` now shows **16 LIVE failures**
— all "Could not find the function … p_content_format" — because the code passes `p_content_format`
but prod is still on schema 0.7.0. These are NOT bugs; they confirm the wiring and clear the moment
schema 0.8.0 is deployed. `_shared` (274) + all non-live package tests pass.

**NEXT — via a published `1.0.0-beta.1` (decided 2026-07-11), to dogfood the whole install →
migrate → test UX instead of an `npm link` shortcut:**
1. **Merge the 28D PR → `main`** (`fix/chunk-reconstruction`). RELEASING.md pre-release checklist
   first — with one nuance for a *schema-changing* beta: the 16 live failures stay red until the
   0.8.0 schema is deployed (which happens in step 4, via the beta), so "tests green" here means
   the `_shared` (274) + non-live package suites; the live suites go green during the migrate.
2. **Cut `1.0.0-beta.1`:** `bun scripts/cut_release.ts 1.0.0-beta.1 --npm-publish`. The release
   workflow publishes it under the **`beta`** npm dist-tag (release.yml computes the channel from
   the pre-release suffix), so `latest` — and any plain `self-update`/`install.sh` — stays on
   0.11.x. Each beta gets its own CHANGELOG section; breaking changes are allowed between betas.
3. **Install the beta:** `VERSION=beta sh install.sh` (or `npm i -g @cerefox/memory@beta`).
4. **Migrate** (supervised together, per `docs/guides/migration-1.0.md`): `cerefox token generate`
   → `cerefox server deploy` (schema 0.8.0 + token-gated EFs — an *installed* package deploys with
   no repo-checkout gotcha) → `cerefox doctor` (edge-functions ✓, content-format ℹ) → revoke the
   legacy anon key → `supabase functions delete cerefox-oauth-consent` (if still present).
5. **Validate:** agent ingests a dummy table doc via local + remote MCP and verifies byte-exact
   format-2 reconstruction AND that a pre-existing doc still reads correctly (format-1); then Fotis
   validates via the web UI + manually fixes the file that surfaced the bug.
6. More betas as the audit (③) + 28G (Python retirement) land → `1.0.0-rc.1` (freeze) → `1.0.0`.

**Update (2026-07-11, later — 28D Phase 1 wiring in progress on `fix/chunk-reconstruction`).**
Done + pushed since the overnight note below:
- **Chunker swap + consolidation (Stages A/B/C): DONE + verified.** `chunkMarkdown` is now the
  exact-partition algorithm; the two duplicate copies (`_shared/mcp-tools/_chunker.ts`, the
  `cerefox-ingest` EF inline) now import the single shared chunker. Verified rigorously: the
  invariant is structural (not just tested) + **24 cases / 1174 assertions** incl. adversarial
  (code-fence false headings, all-astral, CRLF, closing hashes, huge soft-wrapped lines);
  **`content_hash` is doc-level so dedup is chunker-independent**; all 3 callers are
  field-compatible with `ChunkData`.
- **DB (Stage D): PAUSED on a design decision — needs a quick confirm.** Discovered that
  documents are **versioned** (chunks-anchored, `cerefox_chunks.version_id`), so an archived
  version can have a different `content_format` than the current doc. The design's original
  `content_format`-on-`cerefox_documents` would **corrupt archived versions** at reconstruction
  site #869 (`p_version_id`). **Revised recommendation (design §4.3): put `content_format` on
  `cerefox_chunks`** and branch all 5 sites on `MAX(c.content_format) >= 2` (uniform for current
  + archived). No schema files touched yet — clean state. Once confirmed: implement Stage D with
  this placement, then Stage E (callers pass `content_format=2` + embedding heading breadcrumb),
  Stage F (doctor), then the supervised deploy.

**Update (2026-07-11, overnight — 28D in progress on `fix/chunk-reconstruction`).** Done this
session (all pushed):
- **Phase 0 — embedding-input cap: COMPLETE.** `capEmbeddingInput` in `_shared/embeddings`
  (default 20000 chars, `CEREFOX_EMBED_MAX_INPUT_CHARS`) applied at every embed choke point
  (shared client + the `cerefox-ingest`/`cerefox-search` EF inline embedders). +8 tests.
- **Phase 1 — exact-partition algorithm: WRITTEN + FULLY TESTED, UNWIRED.** `chunkMarkdownExact`
  + `blindStitch` in `_shared/ingest/chunker.ts`; invariant `blindStitch(chunk(doc)) === doc.trim()`
  green across 14 cases / 823 assertions (prose, multi-heading, oversized table, blank-line-free
  paragraph, unicode/astral, CRLF, size stress). The production `chunkMarkdown` (format-1) is
  UNCHANGED, so there is **zero behavior/prod impact** yet.

**Guardrails held (unattended):** no schema deploy, no live-EF runs.

**Phase 1 REMAINING (coupled — must land together; do carefully, ideally reviewed):**
1. **Consolidate the 3 TS chunkers → 1** (design §4.2b): point `_shared/mcp-tools/_chunker.ts`
   and the `cerefox-ingest` EF inline chunker at `_shared/ingest/chunker.ts`; add `"ingest"` to
   `bundle_server_assets.ts`; delete the copies.
2. **Swap** `chunkMarkdown` → `chunkMarkdownExact` (the consolidated chunker).
3. **DB (schema 0.7.0 → 0.8.0, both literals):** add `cerefox_documents.content_format SMALLINT
   NOT NULL DEFAULT 1`; add `p_content_format SMALLINT DEFAULT 1` to `cerefox_ingest_document`
   (stamp it); branch **all 5** `STRING_AGG(content, E'\n\n')` reconstruction sites
   (rpcs.sql ~406/683/693/869/1512) on `content_format` (`>=2` → `STRING_AGG(content,'')`).
4. **Callers pass `content_format=2`** + build the embedding input as
   `# {doc_title}\n{heading_path breadcrumb}\n{content}` (pipeline.ts, mcp-tools/ingest.ts, the EF).
5. **`cerefox doctor`** migration-progress check (needs the column).
6. **Tests:** the live round-trip through the ingest RPC + a read; remove the `python-parity`
   fixtures (Python retired, 28G).
7. **Supervised deploy** of schema 0.8.0 + live round-trip validation (NOT unattended).

**Update (2026-07-10, later): 28E + 28F DONE, VALIDATED IN PROD, PR open (#92).** The full
EF-auth migration is committed on `feat/ef-auth-token`, deployed to the maintainer's Supabase
(all 9 EFs `--no-verify-jwt` + token gate), and validated end-to-end: `cerefox doctor` all
green, live e2e **45/45**, cloud-Claude OAuth confirmed, consent EF deleted, `.env` cleaned. An
**exhaustive** doc scan then caught (and fixed) files the scoped agents missed — including
functional scripts (`sync_docs.ts`, `check_ef_parity.ts`, web-integration `_helpers.ts`) that
still sent the anon key. PR #92 (`feat/ef-auth-token` → `main`, squash, **no release cut**) is
open for the maintainer to merge.

**Remaining for 1.0.0 — only two substantive workstreams** (see the scope table under Iteration
28): **(a) the full-codebase security audit** (28B ③) and **(c) the chunking fix** (28D Phase
0/1, on `fix/chunk-reconstruction`). Then cut-time steps: 28C stability contract, the Supabase
"disable legacy API keys" toggle, and recovering the 4 chunker-corrupted docs (rides on 28D).
Next session: start whichever the maintainer picks (audit or 28D).

---

**Update (2026-07-10): 28E + 28F CODE-COMPLETE on `feat/ef-auth-token`** (off `main`; not
merged, not deployed). All slices landed and are committed:
- **28E** — `_shared/ef-auth` in-function token check (`checkAccessToken`/`efAuthGate`, tests);
  all 8 primitive EFs gated (before `/version`, so version is gated too); `cerefox-mcp` accepts
  the Cerefox token (static path) OR OAuth; `cerefox-oauth-consent` EF deleted; bundler +
  `deploy-server` (`--no-verify-jwt` for all 9, cutover warning); **`cerefox token
  generate/rotate/list`** + `.env` upsert util; `doctor` + web-boot + live e2e suites switched
  from the anon key to `CEREFOX_ACCESS_TOKEN`; GPT Actions OpenAPI `info.version` 3.0.0.
- **28F** — full doc sweep (CLAUDE.md auth model, CHANGELOG, `migration-1.0.md`, connect-agents,
  access-paths, setup-supabase, configuration, cli, security-model, solution-design, README,
  oauth-mcp-server-design [historical, annotated], cloudflare README). Legacy anon JWT retired
  everywhere; consent-EF refs → removed; EF count reconciled (9 = 8 primitive + `cerefox-mcp`).

Verification done: `_shared` 255 pass, `env-file` 8 pass, package builds, live suites skip by
default (0 EF calls). **NOT yet done (guardrails held): no deploy, no live-EF run.**

**NEXT — supervised deploy + e2e (do together, not unattended):** (0) `cerefox backup create`
+ `cerefox_export.ts` snapshot of prod (no staging env); (1) `npm link` the local build; (2)
`cerefox token generate`; (3) `cerefox server deploy` (token-gated EFs from local assets); (4)
e2e — `cerefox doctor`, `CEREFOX_LIVE_E2E=1` EF + mcp-remote suites, MCP handshake, GPT Actions
re-paste, cloud-Claude OAuth; (5) revoke the legacy anon key; (6) `supabase functions delete
cerefox-oauth-consent`. Then merge to `main`. **Hold the published beta** until the batch (28E
+ audit ③ + 28D) is soak-tested locally (see the "Local e2e without a published release" +
release-sequencing notes under Iteration 28).

**Update (2026-07-09): v1.0.0 is a large multi-workstream release — see the "v1.0.0
release scope + remaining steps" table under Iteration 28.** On `feat/oauth-mcp`:
28A OAuth MCP (working) + 28B security fixes (deployed, OAuth surface) + the interim
chunker keep-whole fix. Newly scoped as design-of-record: **28D chunk-reconstruction**
([`docs/specs/chunk-reconstruction-design.md`](specs/chunk-reconstruction-design.md),
branch `fix/chunk-reconstruction`). **Held priority TODOs** (in the scope table): anon-key
rotation, secret cleanup, full-codebase security audit, recovery of the 4 chunker-corrupted
docs, and (maybe) retiring the Python MCP fallback at v1.0. Branch strategy: separate
branches → `main` → cut `v1.0.0-beta`.

**Update (2026-07-08, `main` at v0.11.1): Iteration 28A (OAuth MCP) is BUILT and WORKING
end-to-end on `feat/oauth-mcp`.** claude.ai web + Claude mobile now connect to
`cerefox-mcp` over OAuth with the full 10-tool surface (verified live). Supabase's native
OAuth 2.1 Server (beta 2025-11-26) unblocked what was deferred 2026-03-15. Shipped: the
`_shared/mcp-auth/` in-function validator (OAuth JWT + legacy static Bearer, Web-Crypto,
20 tests), `cerefox-mcp` as an RFC 9728 protected resource (`--no-verify-jwt`), the
`_shared/consent-page/` markup rendered by a free **Cloudflare Worker** (Supabase EFs
can't serve HTML on the default domain), and the per-EF deploy-flag map. Design of record:
[`docs/specs/oauth-mcp-server-design.md`](specs/oauth-mcp-server-design.md). Full decision
history + the R1/R2 live gotchas: Decision Log Q3 Part 1 (KB). Remaining in iter-28:
Phase 5 regression matrix, then 28B (security audit, Fable 5) + 28C (v1.0 contract).
**Not yet merged to `main` or released** — still on `feat/oauth-mcp`.

**Update (2026-06-09, `main` at v0.10.3):** Iteration 30 (Local / Self-Hosted Cerefox,
World B) shipped across v0.10.0–v0.10.2; v0.10.3 fixed the `cerefox server deploy` Edge
Function bundler (`--use-api`, issue #84). Two active branches:
- **`feat/local-embedder`** — design for a local ONNX embedder (fully-offline World B),
  target **v0.11.0**. Design committed; implementation pending review.
- **`feat/mcp-list-documents`** — closes the CLI↔MCP parity gap where
  `cerefox document list --project` had no MCP form. `cerefox_metadata_search` now accepts
  an empty `metadata_filter` when another scope (`project_name` / time) is supplied, so it
  lists a project's documents. Handler + EF twin + GPT Actions OpenAPI (v1.9.0) relaxed in
  lockstep; **no `schema_version` bump** (the RPC's `metadata @> '{}'` already match-alls,
  so no `rpcs.sql` change). Added a CLI↔MCP parity matrix to `docs/guides/cli.md` that
  surfaced two further gaps: `cerefox_set_document_projects` had no CLI verb (**now
  closed** — added `cerefox document set-projects`, sharing a `replaceDocumentProjects`
  core with the MCP tool), and metadata-only `document edit` has no MCP tool (left as an
  intentional non-gap — a human/web convenience; agents use `cerefox_ingest`).

**Baseline:** the resource-verb CLI shipped; Python is a husk (`uv run cerefox mcp`
only); the entire runtime is TypeScript in `@cerefox/memory`. **Iteration 30 —
Local / Self-Hosted Cerefox Backend (World B) is ✅ DONE and shipped** across
v0.10.0–v0.10.2: the all-in-one s6 image, the `/rest/v1` proxy, ghcr multi-arch
publish, the `cerefox-local` host script (lifecycle + KB-proxy via `docker exec`),
container self-generated JWT, `install-local.sh` as a Release asset, completion +
`configure-agent` for both bins, port auto-selection, and the World-B guide rewrite
all landed and were validated. v0.10.3 then fixed the `cerefox server deploy` EF
bundler (`--use-api`, issue #84). Design of record:
[`docs/research/local-cerefox-design.md`](research/local-cerefox-design.md).

**Near-term tracks** (iteration numbers are planning IDs, not ship order):
1. **Iteration 32 — Optimistic concurrency control**: ✅ **SHIPPED v0.11.0**
   (2026-06-12; schema 0.5.0; deployed + live-validated on the maintainer cloud).
   Content updates require `expected_content_hash` (compare-and-swap on the existing
   `content_hash`, atomic in the ingest RPC via `FOR UPDATE`) or an explicit
   `last_write_wins`. Design of record:
   [`docs/specs/concurrency-control-design.md`](specs/concurrency-control-design.md).
   **v0.11.1 follow-up** (on `fix/metadata-preserve-on-update`, schema 0.6.0):
   content updates without metadata no longer wipe a document's tags
   (`p_metadata` NULL = keep existing), plus CLI `metadata search` parity (filter
   optional with another scope). The wipe incident also spawned the
   **metadata-versioning** backlog proposal:
   [`docs/research/metadata-versioning.md`](research/metadata-versioning.md).
2. **Iteration 31 — Local ONNX embedder** (fully-offline World B), target **v1.1+ (post-1.0)**
   (slid from v0.11.0 to make room for iter-32), on `feat/local-embedder`.
   Design committed; P0 implementation pending review. See iter-31 in the log above.
3. **Iteration 28 — v1.0**: ⏳ **ACTIVE (28A) as of 2026-07-08** on `feat/oauth-mcp`.
   Re-scoped to fold in the **OAuth-protected remote MCP server** (28A: claude.ai +
   Claude mobile via Supabase's native OAuth 2.1 Server — design of record:
   [`docs/specs/oauth-mcp-server-design.md`](specs/oauth-mcp-server-design.md)),
   then the security audit (28B, on the Fable 5 model, covering the new OAuth
   surface) and the stability contract (28C: strict SemVer becomes binding).
   28B/28C trigger: ~2–3 months of v0.10/v0.11 in the wild + an outside user
   installing unaided.
4. **Iteration 29 — Document Relations & Semantic Graph** (post-v1.0, target **v1.1+**),
   pending — design only. Design of record:
   [`docs/research/document-relations-and-semantic-graph.md`](research/document-relations-and-semantic-graph.md).
   (The early semantic-graph exploration branch was already merged to main;
   implementation is future work.)

Release history lives in [`CHANGELOG.md`](../CHANGELOG.md); the design-of-record
for the polish arc is [`docs/specs/polish-and-distribution-design.md`](specs/polish-and-distribution-design.md).
The dated iteration log above this section remains the high-level progress record.
