# Cerefox Implementation Plan

> **Approach**: Iterative and agile. Each phase delivers working functionality.
> Update this file as phases are completed and new work is planned.

---

## Phase 1: Foundation — Project Setup & Database

**Goal**: Runnable Python project with database schema deployed to Supabase.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | Initialize Python project (pyproject.toml, uv, ruff config) | Not Started | |
| 1.2 | Create project directory structure (src/cerefox/*) | Not Started | |
| 1.3 | Write config module (pydantic-settings, .env support) | Not Started | |
| 1.4 | Write database schema SQL (documents, chunks, projects tables) | Not Started | |
| 1.5 | Write search RPC SQL (hybrid, FTS, semantic, reconstruct) | Not Started | |
| 1.6 | Create DB client wrapper (Supabase Python client) | Not Started | |
| 1.7 | Write `scripts/db_deploy.py` — apply full schema to a fresh instance | Not Started | |
| 1.8 | Write `scripts/db_status.py` — verify schema and report table stats | Not Started | |
| 1.9 | Deploy schema to Supabase using db_deploy.py | Not Started | |
| 1.10 | Write tests for config module and DB client (unit, mocked) | Not Started | |
| 1.11 | Write `docs/guides/setup-supabase.md` and `docs/guides/configuration.md` | Not Started | |

**Deliverable**: Schema running on Supabase, Python project builds and imports, deploy script and Supabase setup guide complete.

---

## Phase 2: Chunking & Embeddings

**Goal**: Markdown chunking engine and pluggable embedding system.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1 | Implement heading-based markdown chunker | Not Started | H1 > H2 > H3 cascade |
| 2.2 | Add chunk size management (max/min chars, paragraph fallback) | Not Started | |
| 2.3 | Implement Embedder protocol (base.py) | Not Started | |
| 2.4 | Implement all-mpnet-base-v2 embedder | Not Started | Default, 768-dim |
| 2.5 | Implement Ollama embedder | Not Started | For upgrade embeddings |
| 2.6 | Write tests for chunking: empty doc, headings only, oversized sections, no headings | Not Started | |
| 2.7 | Write tests for embedders: mock model output, verify dimension, batch handling | Not Started | |

**Deliverable**: Can parse any markdown file into heading-aware chunks with embeddings. Tests pass.

---

## Phase 3: Ingestion Pipeline & CLI

**Goal**: End-to-end ingestion from markdown file to database, via CLI.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | Implement ingestion pipeline (parse → chunk → embed → store) | Not Started | |
| 3.2 | Add content hash deduplication | Not Started | |
| 3.3 | Build CLI with Click (ingest command) | Not Started | |
| 3.4 | Add CLI commands: list-docs, delete-doc, list-projects | Not Started | |
| 3.5 | Add file system backup on ingest | Not Started | |
| 3.6 | Write `scripts/backup_create.py` and `scripts/backup_restore.py` | Not Started | |
| 3.7 | Write tests for pipeline: dedup logic, chunk-to-DB mapping (mocked DB) | Not Started | |
| 3.8 | Integration test: ingest a real MD file into Supabase | Not Started | `@pytest.mark.integration` |

**Deliverable**: `cerefox ingest my-notes.md --project "creative projects"` works end-to-end. Backup scripts documented.

---

## Phase 4: Search & Retrieval

**Goal**: Working search RPCs and retrieval logic.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1 | Deploy search RPCs to Supabase | Not Started | |
| 4.2 | Implement Python search client (wraps RPC calls) | Not Started | |
| 4.3 | Add CLI search command | Not Started | |
| 4.4 | Implement response size management (truncation, metadata) | Not Started | |
| 4.5 | Write tests for search client: response assembly, size truncation, metadata | Not Started | |
| 4.6 | Integration test: search with real ingested content | Not Started | `@pytest.mark.integration` |
| 4.7 | Connect via Supabase MCP and verify agent access | Not Started | |
| 4.8 | Implement `cerefox_save_note` RPC (agent write tool) | Not Started | |
| 4.9 | Write `docs/guides/connect-agents.md` (Claude, Cursor, generic MCP client) | Not Started | |

**Deliverable**: Agents can search and write to Cerefox via MCP. CLI search works. Unit tests pass. Agent connection guide complete.

---

## Phase 5: Web Application (Basic)

**Goal**: Local web UI for browsing knowledge and ingesting content.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | FastAPI app skeleton with Jinja2 + HTMX | Not Started | |
| 5.2 | Dashboard page (doc count, recent docs, projects) | Not Started | |
| 5.3 | Knowledge browser page (search, filter by project/tags) | Not Started | |
| 5.4 | Document viewer page (reconstructed doc with chunk boundaries) | Not Started | |
| 5.5 | Ingest page (upload MD files, paste content) | Not Started | |
| 5.6 | Project management page (CRUD projects) | Not Started | |
| 5.7 | Write `docs/guides/setup-local.md` (local Docker setup guide) | Not Started | |
| 5.8 | Write `docs/guides/ops-scripts.md` (backup, restore, migrate) | Not Started | |

**Deliverable**: Usable web UI for managing the knowledge base locally. Local setup guide complete.

---

## Phase 6: Enhanced Features

**Goal**: Production-quality features for daily use.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | PDF → Markdown converter | Not Started | |
| 6.2 | DOCX → Markdown converter | Not Started | |
| 6.3 | Small-to-big context expansion RPC | Not Started | |
| 6.4 | Async ingestion with status tracking | Not Started | |
| 6.5 | Ingestion error UI (status panel, retry) | Not Started | |
| 6.6 | Metadata schema management (define custom fields) | Not Started | |
| 6.7 | Batch ingestion (directory of files) | Not Started | |
| 6.8 | Git backup integration | Not Started | |

**Deliverable**: Robust ingestion pipeline with multiple input formats.

---

## Phase 7: Deployment & Open Source

**Goal**: Packageable, deployable, and shareable.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 7.1 | Dockerfile for the web app | Not Started | |
| 7.2 | docker-compose.yml for full local stack | Not Started | |
| 7.3 | Cloud Run deployment config | Not Started | |
| 7.4 | README.md — project overview, quickstart, links to guides | Not Started | |
| 7.5 | `docs/guides/quickstart.md` — zero to first document in < 15 min | Not Started | |
| 7.6 | `docs/guides/setup-cloud-run.md` — GCP Cloud Run deployment | Not Started | |
| 7.7 | `docs/guides/contributing.md` — adding embedders, converters, commands | Not Started | |
| 7.8 | License file, code of conduct | Not Started | |
| 7.9 | First release (v0.1.0) | Not Started | |

**Deliverable**: Open source release. All setup guides complete. Any new user can go from zero to running Cerefox in one sitting.

---

## Progress Log

Record completed milestones here as we go.

| Date | Milestone | Notes |
|------|-----------|-------|
| 2026-03-07 | Project kickoff | Created CLAUDE.md, solution design, plan, TODO, requirements |

---

## Current Focus

**Next up**: Phase 1 — Foundation (project setup and database schema)
