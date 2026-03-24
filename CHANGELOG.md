# Changelog

All notable changes to Cerefox are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — all `v0.x` releases may include breaking changes.

---

## [v0.1.9.1] -- 2026-03-23

Bug fixes reported by user testing MCP integration with Claude Code.

### Fixed
- **document_id missing from MCP search results** -- `cerefox-mcp` was dropping `document_id` when formatting search results as text, making `cerefox_get_document` and `cerefox_list_versions` unreachable through MCP since agents never received the UUID
- **Intermittent embedding API failures** -- added retry with exponential backoff (3 attempts, 500ms/1s/2s) to all three embedding paths: Python `CloudEmbedder`, `cerefox-search` Edge Function, and `cerefox-ingest` Edge Function. Only transient errors (5xx, timeouts) are retried; client errors (4xx) fail immediately

---

## [v0.1.9] -- 2026-03-23

Single implementation principle consolidation, audit trail completion, and UI refinements.

### Added
- **`cerefox_ingest_document` RPC**: single atomic transaction for all ingestion writes (insert/update document, insert chunks, snapshot version, set review_status, create audit entry). Both Python pipeline and Edge Function now call this RPC instead of doing direct table inserts.
- **`cerefox_delete_document` RPC**: creates audit entry (preserving document title and size) before cascade-deleting the document.
- **`cerefox_get_audit_log` tool** on the local Python MCP server (was missing; already existed on remote Edge Function MCP).
- **Audit Trail section** on Document Detail page: lazy-loaded accordion showing all audit entries for the document with color-coded operation badges, author attribution, and size deltas.
- **`author` parameter** on `cerefox_ingest` MCP tool: agents can identify themselves (e.g., "Claude Code", "Cursor") instead of the default "mcp-agent".
- **Review status filter** on Search page (docs mode): filter by All / Approved / Pending Review.
- **Upgrading guide** (`docs/guides/upgrading.md`): idempotent migration checklist for users upgrading from any previous version.
- `CONTRIBUTING.md` moved to repo root (GitHub community standards compliance).
- `SECURITY.md` for private vulnerability reporting.
- GPT Actions OpenAPI spec bumped to v1.5.0 (new audit log endpoint, author parameter on ingest).

### Changed
- **Single implementation principle enforced**: ingestion write path consolidated into `cerefox_ingest_document` RPC. CLAUDE.md updated with clear guidance that all new write logic goes in RPCs, not callers.
- **Review status** correctly set on new agent-created documents (`pending_review`) -- was defaulting to `approved` due to missing logic in the create path.
- Dashboard "Updated" column shows date and time (was date only).
- Quickstart guide updated for React SPA (Node.js prerequisite, frontend build step, correct URLs).

### Fixed
- **Double JSON encoding** in `ingest_document_rpc` parameters causing "cannot get array length of a scalar" error on local MCP path.
- **Stale project badges** showing raw UUIDs after project deletion -- dashboard cache now invalidated on project delete and document edit; unknown project IDs filtered from badge display.
- **Dark mode inline code** contrast -- `light-dark()` CSS function for code/pre/th backgrounds.

---

## [v0.1.8] -- 2026-03-23

Trust and governance layer: audit log, review status, version archival, and version diff viewer.

### Added
- **Immutable audit log** (`cerefox_audit_log` table) recording all write operations with author attribution (`author_type`: user or agent), size delta, description, and version references
- **`cerefox_create_audit_entry`** and **`cerefox_list_audit_entries`** RPCs (single implementation principle)
- **`cerefox-get-audit-log`** Edge Function + **`cerefox_get_audit_log`** MCP tool (7 Edge Functions, 7 MCP tools total)
- **Review status** (`approved` / `pending_review`) on documents with auto-transition: agent writes set `pending_review`, human writes set `approved`
- **Review status filter** on search page (docs mode: All / Approved / Pending Review)
- **Review status indicators** (green/yellow badges) on dashboard, search results, project documents, and document detail
- **Version archival**: `archived` flag protects individual versions from retention cleanup. Clickable toggle in version history with tooltips and unarchive confirmation
- **Version diff viewer** (unified mode) comparing any archived version against current content
- **`CEREFOX_VERSION_CLEANUP_ENABLED`** config setting (default: true). Set to false for immutable version retention
- **Author pass-through** on MCP ingest: agents can set their name via optional `author` parameter
- **Audit log browser page** (`/app/audit-log`) with operation and author filters, document titles (SQL join), color-coded badges
- `docs/guides/upgrading.md` -- idempotent migration checklist for upgrading between versions
- Database migration `0004_add_audit_log_review_status_archived.sql`

### Changed
- `cerefox_snapshot_version` RPC respects `archived` flag (skips archived versions) and `p_cleanup_enabled` parameter
- `cerefox_list_document_versions` RPC returns `archived` boolean
- `cerefox-ingest` Edge Function accepts `author` and `author_type`, creates audit entries via RPC
- `cerefox-mcp` Edge Function passes author (agent-provided or default "mcp-agent") and `author_type="agent"`
- `list_documents()` query updated to include `review_status`
- Diff viewer simplified to unified mode only (side-by-side removed due to alignment issues)

### Fixed
- Dashboard showing all documents as "Pending" when `review_status` was missing from SELECT column list

---

## [v0.1.7] -- 2026-03-22

Major web application refactor: Jinja2 + HTMX server-rendered frontend replaced with a React + TypeScript single-page application.

### Added
- **React + TypeScript SPA** at `/app/` — Mantine UI, TanStack Query, React Router, Vite build pipeline
- **18 JSON API endpoints** under `/api/v1/` — dashboard, search, documents CRUD, ingest (paste + file), projects CRUD, metadata keys, filename check
- **Markdown viewer** with Rendered/Raw toggle on document detail, edit preview, and ingest preview
- **Dark mode** — follows OS preference with manual toggle in header
- **Toast notifications** for save, delete, and project CRUD operations
- **Dedicated project documents page** (`/app/projects/:id/documents`) — clean table listing
- **Quick search** from dashboard — input field navigates to Search with query pre-filled
- **Root redirect page** at `/` for users with old bookmarks — auto-redirects to `/app/`
- `docs/specs/ui-redesign-spa-python-api.md` — detailed design document for the migration
- `docs/guides/agent-coordination.md` — multi-agent coordination patterns via Cerefox
- `docs/research/vision.md` — comprehensive vision document for Cerefox

### Changed
- **Web UI architecture**: server-rendered Jinja2 + HTMX replaced with client-side React SPA
- **Search page** renamed from "Knowledge Browser" to "Search Knowledge Base"; requires a query (project-only browse moved to dedicated page)
- **Version history** now a collapsible table with date+time and explicit download buttons (was clickable badge row)
- **Document detail** shows Created/Updated with time, not just date
- **Dashboard** stat cards use compact horizontal layout; projects shown as table with doc counts and "List" button

### Fixed
- **Broken documents from failed embedding** — ingestion now checks actual chunk count in DB, not stored field on document record; re-embeds if chunks are missing
- **Download filename** for paste-ingested docs and Unicode titles (em dash, accents)

### Removed
- Jinja2 server-side rendering routes (`routes.py`, 850 lines)
- 83 unit tests for removed Jinja2 routes (`test_routes.py`)
- `jinja2` Python dependency
- All 15 Jinja2 template files (`web/templates/`)

---

## [v0.1.6] — 2026-03-21

Metadata-filtered search, response size redesign, UI improvements, and tooling.

### Added
- **Metadata-filtered search** across all access paths — CLI, web UI, MCP, Edge Functions, GPT Actions (Iteration 13A)
- **Collapsible document results** in web UI — `<details>`/`<summary>` panels with Full/Excerpt badges replace inline truncated content
- **"Documents (full)" is now the default** search mode in the web UI
- `scripts/sync_docs.py` — batch-upload `README.md` + all `docs/**/*.md` into a Cerefox project with `--dry-run` and `--project` flags
- `docs/guides/response-limits.md` — new guide explaining the response size model
- `docs/guides/access-paths.md` — documents all three auth/access layers

### Changed
- **Response size limits redesigned** to opt-in per call (Iteration 13C): `max_bytes=None` means no truncation (web UI, CLI); MCP/Edge Function paths enforce a server ceiling (200 KB default)
- Small-to-big retrieval threshold lowered from 40,000 → 20,000 chars
- `CEREFOX_MAX_RESPONSE_BYTES` now only applies to MCP and Edge Function paths; web UI and CLI are unlimited

### Fixed
- **Download 500 error** — `UnicodeEncodeError` when document titles contain em dashes or other non-ASCII characters; titles are now sanitized to ASCII-safe filenames
- Paste-ingested documents now use their title (not generic "document") as download filename
- Versioned downloads include `v<N> - <date>` suffix in the filename
- E2e test suite aligned with documented use cases (`e2e-use-cases.md` rewritten)

---

## [v0.1.5] — 2026-03-20

Small-to-big retrieval and access-paths documentation.

### Added
- **Small-to-big retrieval** (Iteration 12A) — Postgres RPC assembles neighbouring chunks for large documents; `is_partial` flag on results indicates whether full content or excerpts were returned
- E2e tests for small-to-big retrieval
- `docs/guides/access-paths.md` — comprehensive guide to all credential layers and integration paths

### Changed
- Response size limit raised from 65 KB to 200 KB
- Small-to-big params removed from Python config; configured exclusively via `rpcs.sql` SQL defaults
- `is_partial` documented in OpenAPI schema, Edge Function reference, and MCP tool description

---

## [v0.1.4] — 2026-03-19

Document versioning, two new Edge Functions, and GPT Actions schema update.

### Added
- **Implicit document versioning** — updating a document archives previous chunks with a `version_id`; partial indexes exclude archived chunks from search automatically (Iteration 12)
- `cerefox-get-document` Edge Function — retrieve full document content, with support for archived versions
- `cerefox-list-versions` Edge Function — list version history for a document
- `cerefox_get_document` and `cerefox_list_versions` MCP tools
- GPT Actions OpenAPI schema updated to v1.3.0 with versioning endpoints

### Changed
- Old migrations folded into `schema.sql` for cleaner fresh deployments

### Fixed
- Backup directory default path
- Test isolation issues

---

## [v0.1.3] — 2026-03-15

Metadata overhaul, e2e testing, and operational improvements.

### Added
- **Data-driven metadata discovery** — replaced static key registry with `cerefox_list_metadata_keys` RPC that introspects actual JSONB metadata across all documents
- `cerefox-metadata` Edge Function for metadata key listing
- **E2e test suite** — API tests against live Supabase + Playwright UI tests against local web app
- Inline two-step confirmation on destructive UI actions (replaces `window.confirm`)
- `cerefox-mcp` Edge Function — Streamable HTTP MCP adapter; promoted as recommended remote access path
- Local-time date display in dashboard and document detail views
- Cerefox Decision Log convention added to `CLAUDE.md`

### Changed
- License changed from MIT to Apache 2.0
- Adopted lightweight GitHub Flow (branch model documented in `CLAUDE.md`)
- Greedy section accumulation for chunking — sections accumulate until adding the next would exceed `max_chunk_chars`

### Fixed
- `cerefox-mcp` returning empty content for search results
- Supergateway auth flag in Claude Desktop config example
- Stale embedder default and removed unused `OVERLAP_CHARS` config
- H1 hard-boundary removed; cross-path content hash inconsistency resolved
- CRLF hash mismatch between Edge Function and Python chunking paths
- ChatGPT Desktop removed from local MCP path (not supported)

---

## [v0.1.2] — 2026-03-11

Ingestion improvements and test coverage.

### Added
- **Filename-based document update** — `update_existing` flag on ingestion matches by `source_path` (file-ingested) or title (paste-ingested) and updates in-place
- Consistent response size budget across MCP and Edge Function paths
- Skip heading-based chunking for documents that fit in a single chunk
- Test coverage for `update_existing`, `check-filename`, and `update-content` flows

### Fixed
- Chunking overlap issues
- Documentation alignment

---

## [v0.1.1] — 2026-03-11

Post-launch polish.

### Added
- "Last updated" date displayed in dashboard and search/browse results
- `docs/guides/operational-cost.md` — embedding and hosting cost estimates

### Removed
- Local embedder references (mpnet, Ollama) — cloud-only going forward (OpenAI, Fireworks AI)

### Fixed
- Stale mpnet/cost references in source file comments

---

## [v0.1.0] — 2026-03-11

First complete release. All core features working end-to-end.

### Added
- **Two-table schema** — `cerefox_documents` + `cerefox_chunks` with pgvector (768-dim)
- **Hybrid search** — FTS + semantic (cosine similarity), combined via RRF in Postgres RPC
- **Heading-aware markdown chunking** — H1 → H2 → H3 → paragraph fallback
- **Cloud embeddings** — OpenAI `text-embedding-3-small` (default) and Fireworks AI
- **Ingestion pipeline** — markdown documents chunked, embedded, and stored
- **CLI** (`cerefox` command) — `ingest`, `search`, `reindex`, `backup`, `restore`
- **Web UI** — FastAPI + Jinja2 + HTMX; dashboard, search, browse, document detail, ingest
- **Built-in MCP server** (`cerefox mcp`) — stdio transport for local AI agent integration
- **Edge Functions** — `cerefox-search`, `cerefox-ingest` deployed to Supabase
- **Backup/restore** — file-system backup with optional git integration
- `docs/` — requirements, solution design, implementation plan, configuration guide, quickstart, setup guides
- `scripts/db_deploy.py` and `scripts/db_migrate.py` for schema deployment

---

## Pre-release — 2026-03-07 to 2026-03-10

Initial project scaffolding, documentation structure, and phased implementation of core modules (database client, chunking, embeddings, ingestion, retrieval, CLI, web UI, backup). Not tagged.

[v0.1.9.1]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.9...v0.1.9.1
[v0.1.9]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.8...v0.1.9
[v0.1.8]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.7...v0.1.8
[v0.1.7]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.6...v0.1.7
[v0.1.6]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.5...v0.1.6
[v0.1.5]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.4...v0.1.5
[v0.1.4]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.3...v0.1.4
[v0.1.3]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.2...v0.1.3
[v0.1.2]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.1...v0.1.2
[v0.1.1]: https://github.com/fstamatelopoulos/cerefox/compare/v0.1.0...v0.1.1
[v0.1.0]: https://github.com/fstamatelopoulos/cerefox/releases/tag/v0.1.0
