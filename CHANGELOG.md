# Changelog

All notable changes to Cerefox are documented in this file.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — all `v0.x` releases may include breaking changes.

---

## [v0.1.12] -- 2026-03-30

Fix excessive Edge Function invocations from MCP SSE polling.

### Fixed
- **`cerefox-mcp` GET endpoint returns 405** instead of 200. Per MCP spec (2025-03-26), servers that don't support SSE notifications MUST return 405 Method Not Allowed for GET requests. Our server was returning 200, which MCP clients interpreted as "SSE supported" and maintained persistent polling at ~1 GET/sec (~86K invocations/day per client). The 405 response tells clients this server is POST-only, eliminating all idle polling.

### Added
- **MCP config templates** in `examples/mcp-configs/`: copy-pasteable `.mcp.json` files for Claude Code (`mcp-remote`), Claude Desktop (`supergateway`), Cursor (native HTTP), and local stdio. Contributed by @tdebasis (PR #19, resolves #17).
- **`mcp-remote` recommended** for Claude Code remote MCP: `mcp-remote --header` works with Supabase Edge Functions, bypassing the GoTrue OAuth discovery conflict. Updated in `docs/guides/connect-agents.md` with SSE polling warning.

---

## [v0.1.11.1] -- 2026-03-29

Soft delete with trash bin, restore, and purge.

### Added
- **Soft delete**: "Delete" now sets `deleted_at` instead of CASCADE DELETE. Documents remain in the database (with all chunks and versions) but are excluded from search.
- **Trash page** (`/app/trash`): lists soft-deleted documents with Restore and Purge buttons. Purge has two-step confirmation.
- **Restore**: `cerefox_restore_document` RPC clears `deleted_at`. Document returns to search and dashboard immediately.
- **Purge**: `cerefox_purge_document` RPC does permanent CASCADE DELETE. Only works on already soft-deleted docs.
- **Document detail banner**: red "Deleted" indicator with Restore and Permanently Delete buttons when viewing a soft-deleted document.
- **`'restore'` audit operation**: new operation type in the audit log CHECK constraint. Existing entries that incorrectly used `'unarchive'` for restore are auto-corrected by migration 0009.
- Database migrations `0008_soft_delete.sql` and `0009_audit_log_restore_operation.sql`.

### Changed
- `cerefox_delete_document` RPC now soft-deletes (was CASCADE DELETE).
- All search RPCs (hybrid, fts, semantic) filter `d.deleted_at IS NULL`.
- `list_documents()` in Python client excludes soft-deleted docs.
- REST API: new endpoints `POST /documents/{id}/restore`, `DELETE /documents/{id}/purge`, `GET /documents/trash`.

---

## [v0.1.11] -- 2026-03-29

Usage tracking, analytics dashboard, requestor attribution, and UX refinements (16C/16D).

### Added
- **Usage tracking**: opt-in logging of all operations (reads and writes) across all access paths. `cerefox_usage_log` table with `requestor`, `access_path`, `operation`, `query_text`, and `result_count`. Controlled via `cerefox_config` table -- no redeploy needed to toggle.
- **Analytics dashboard** at `/app/analytics`: 8 interactive visualizations (Nivo bar/pie charts, D3.js HEB charts, CSS word cloud). On-demand analysis with date range, project, and access path filters. Usage tracking toggle. CSV export.
- **Requestor attribution**: optional `requestor` parameter on all MCP read tools and all primitive Edge Functions. MCP writes use the existing `author` parameter. Multi-agent analytics now show which agent accessed which documents through which operations.
- **`cerefox-list-projects` Edge Function**: new primitive EF for GPT Actions and direct HTTP callers.
- **CLI**: `cerefox config-get` and `cerefox config-set` commands for runtime config management.
- **REST API**: 5 new endpoints (`/usage-log`, `/usage-log/export.csv`, `/usage-log/summary`, `/config/{key}` GET/PUT).
- **Metadata Search UX**: expand/collapse result cards with full metadata, content viewer (Raw/Rendered toggle), and "View Document Details" link (new tab).
- Database migrations `0006_usage_log.sql` and `0007_usage_log_requestor.sql`.
- 2 new Playwright UI tests (analytics page).
- GPT Actions OpenAPI schema v1.7.0 (9 endpoints, requestor param).

### Changed
- **Charting library**: replaced `@mantine/charts` (Recharts wrapper) with Nivo (`@nivo/bar`, `@nivo/pie`). Better dark mode, tooltips, and React 19 support.
- **Word cloud**: replaced `react-d3-cloud` with CSS flex-wrap implementation (React 19 peer dep conflict).
- **`reader` renamed to `requestor`** throughout: DB column, RPCs, Python client, TypeScript, frontend. Migration 0007 handles the column rename non-destructively.
- **Usage log tracks writes**: ingest operations now logged alongside reads.
- **Local MCP server**: no longer labelled "legacy fallback" -- described as local alternative with zero Edge Function usage.
- Edge Functions: 8 -> 9 (added `cerefox-list-projects`).

---

## [v0.1.10] -- 2026-03-28

MCP consolidation (16A), metadata search, project name standardisation, and project discovery (16B). Resolves [#9](https://github.com/fstamatelopoulos/cerefox/issues/9). Inspired by [#10](https://github.com/fstamatelopoulos/cerefox/pull/10) (h/t @tdebasis).

### Added
- **`cerefox_metadata_search` RPC and MCP tool**: query documents by metadata key-value criteria without a text search term. JSONB containment filter with AND semantics, project/date filters, optional content inclusion with byte budget.
- **`cerefox_list_projects` RPC and MCP tool**: agents can discover available projects by name before filtering in other tools.
- **`cerefox-metadata-search` Edge Function**: new primitive Edge Function for GPT Actions and direct HTTP callers.
- **`project_names TEXT[]`** added to all search/retrieve RPCs: all document results now include human-readable project names alongside UUIDs.
- **Metadata Search web UI page** (`/app/metadata-search`): filter builder with key suggestions, project dropdown, date filters, include-content toggle, result cards with metadata and project name badges.
- **Project name badges** on search result cards in the existing Search page.
- **`cerefox metadata-search` CLI command** with `--filter`, `--project`, `--updated-since`, `--created-since`, `--limit`, `--include-content` options.
- **`POST /api/v1/documents/metadata-search`** REST API endpoint for the web UI.
- Database migration `0005_metadata_search.sql`.
- 10 new MCP e2e tests, 4 new Edge Function e2e tests, 6 new API e2e tests, 4 new unit tests, 2 new Playwright UI tests.

### Changed
- **`cerefox-mcp` refactored to call RPCs directly** (16A): each tool handler calls Postgres RPCs via the service-role key instead of delegating to primitive Edge Functions via `fetch()`. Halves billable Supabase Edge Function invocations per MCP tool call. Multi-file structure: `shared.ts`, `embeddings.ts`, `tools/*.ts`.
- **MCP tools: 6 -> 8** (added `cerefox_list_projects` and `cerefox_metadata_search`).
- **Edge Functions: 7 -> 8** (added `cerefox-metadata-search`).
- **Local MCP server reframed**: no longer labelled "legacy fallback". It is a local alternative with zero Edge Function usage (relevant for Supabase free-tier limits), lower latency, and offline support.
- `connect-agents.md` updated with all 8 tools, corrected architecture description, Edge Function usage comparison.
- `upgrading.md` updated with v0.1.10 breaking change notice.

### Breaking (MCP remote path only)
- **`project_id` removed from MCP tool inputs**: `cerefox_search`, `cerefox_ingest`, and `cerefox_metadata_search` now accept `project_name` (human-readable string) instead of `project_id` (UUID). Name-to-UUID resolution happens inside the tool handler. Agents passing `project_id` in MCP calls must switch to `project_name`. **Primitive Edge Functions are unchanged** -- they continue to accept `project_id UUID` for GPT Actions and direct HTTP callers.

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
