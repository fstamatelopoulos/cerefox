# Cerefox: Requirements & Specifications

> **Source of truth** for what Cerefox does and how it behaves.
> Updated as requirements evolve. See `solution-design.md` for architecture
> and `plan.md` for implementation status.

---

## 1. Product Overview

Cerefox is a **user-owned knowledge memory layer** — it stores, indexes, and serves curated knowledge to AI agents via MCP, while also accepting agent write-back. It is designed to be:

- **Owned**: all data lives in infrastructure the user controls (Supabase or self-hosted Postgres)
- **Agent-accessible**: any AI agent (Claude, ChatGPT, Cursor, custom agents, OpenClaw) can search and retrieve from Cerefox via MCP, from anywhere
- **Cheap**: operates on Supabase free tier with low ongoing cost (cloud embeddings are the only variable expense)
- **Open source**: Apache 2.0 license, designed for personal use but shareable

### 1.0 What Cerefox Is — and Is Not

**Cerefox is a user-owned knowledge memory layer.** It is the persistent, curated substrate that sits between the user and the AI tools they use — making knowledge searchable and writable by any AI agent, from anywhere, at any time.

The primary use case is **shared memory across AI agents**: knowledge written by one tool (Claude, ChatGPT, Cursor, or a custom agent) becomes immediately available to all others. This prevents context fragmentation and enables continuously evolving, agent-accessible knowledge.

**Cerefox is not a note-taking app.** It has no rich editor, no backlinking UI, no graph view, and no mobile app for capture. Those problems are already solved by excellent tools (Obsidian, Bear, Notion, etc.). Cerefox is designed to work *alongside* them, not replace them.

**Knowledge flows:**
```
Human writes/curates → Cerefox (via CLI, web UI, or file ingest)
         ↓ and ↑
AI agents read and write → Cerefox (via MCP or Edge Functions)
         ↓
Knowledge lives in Supabase — indexed, embedded, searchable by any agent
```

**Cerefox's unique position** in the ecosystem:
- The only *open source*, *self-hosted*, *MCP-native* knowledge memory layer
- Agent-first design: agents read and write as first-class citizens; humans curate and validate
- Low per-query cost (Supabase free tier + low-cost cloud embedding API)
- Owner-controlled: no vendor reads your data, no subscription required

### 1.1 Content Domains

The knowledge base supports organizing content into projects/categories. These are entirely user-defined — Cerefox ships with no hard-coded categories. The following are illustrative examples of the kinds of projects a user might create:

- **Creative Projects**: worldbuilding, fiction, publications, community content
- **Work**: professional ideas, technical notes, meeting summaries
- **Research**: topics under active investigation (AI, domain knowledge, etc.)
- **Side Projects**: ideas and projects to pick up later
- **Personal**: general thoughts, brainstorming, analysis, journaling

Projects and categories are created, renamed, and deleted by the user at any time through the web UI or CLI. There is no predefined taxonomy.

---

## 2. Functional Requirements

### FR-1: Content Ingestion

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | Ingest Markdown files (.md) | P0 |
| FR-1.2 | Ingest pasted text (treated as markdown) | P0 |
| FR-1.3 | Convert PDF to markdown before ingestion | P1 |
| FR-1.4 | Convert DOCX to markdown before ingestion | P1 |
| FR-1.5 | Deduplicate content by hash (skip re-ingestion of identical files) | P0 |
| FR-1.6 | Associate ingested content with a project | P0 |
| FR-1.7 | Attach metadata (tags, importance, custom fields) on ingest | P0 |
| FR-1.8 | Batch ingest (directory of files) | P1 |
| FR-1.9 | Ingestion is fire-and-forget (async, non-blocking) | P0 |
| FR-1.10 | Report ingestion failures via UI event/log | P0 |

### FR-2: Content Chunking

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | Parse markdown into H1/H2/H3 sections and greedily accumulate into chunks up to MAX_CHUNK_CHARS | P0 |
| FR-2.2 | All heading levels (H1–H3) treated equally — size alone controls chunk boundaries | P0 |
| FR-2.3 | Oversized single sections (> MAX_CHUNK_CHARS) split at paragraph boundaries | P0 |
| FR-2.4 | Resulting paragraph pieces below MIN_CHUNK_CHARS merged into preceding piece | P1 |
| FR-2.5 | Preserve heading hierarchy path for each chunk | P0 |
| FR-2.6 | Maintain chunk ordering (chunk_index) for document reconstruction | P0 |

### FR-3: Embeddings

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | Compute primary embeddings via cloud API (OpenAI) | P0 |
| FR-3.2 | Support pluggable embedder interface | P0 |
| FR-3.3 | Default embedder: OpenAI text-embedding-3-small (768-dim) | P0 |
| FR-3.4 | Support Fireworks AI as alternative cloud embedder | P0 |
| FR-3.5 | Support optional "upgrade" embedding field per chunk | P1 |
| FR-3.6 | Track which embedder produced each embedding | P0 |
| FR-3.7 | Standardize on 768-dim vectors | P0 |
| FR-3.8 | Support Vertex AI embedder (future, parameterized) | P2 |

### FR-4: Search & Retrieval

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | Hybrid search: combine FTS and vector similarity | P0 |
| FR-4.2 | FTS-only search (keyword, exact match) | P0 |
| FR-4.3 | Semantic-only search (conceptual similarity) | P0 |
| FR-4.4 | Configurable semantic weight (alpha) for hybrid search | P0 |
| FR-4.5 | Document reconstruction from chunks | P0 |
| FR-4.6 | Response size limit (parameterized, default 65000 bytes) | P0 |
| FR-4.7 | Small-to-big context expansion (return sibling chunks) — see FR-4.10–4.14 | P1 |
| FR-4.8 | Truncation metadata (indicate when results are cut off) | P1 |
| FR-4.9 | Filter search by project/tags/metadata | P1 |
| FR-4.10 | For documents above `CEREFOX_SMALL_TO_BIG_THRESHOLD` chars, search returns matched chunks + N neighbor chunks instead of the full document | P1 |
| FR-4.11 | Neighbor window size is configurable via `CEREFOX_CONTEXT_WINDOW` (default: 1) | P1 |
| FR-4.12 | Assembled chunks are sorted by chunk_index and deduplicated — overlapping neighbor windows produce each chunk only once | P1 |
| FR-4.13 | Documents below the threshold retain current behavior: return full reconstructed document | P1 |
| FR-4.14 | Full document retrieval API — retrieve the complete text of a specific document by ID, regardless of size, bypassing small-to-big logic. See FR-11 | P1 |

### FR-5: MCP Integration

Cerefox exposes both **read** (search/retrieve) and **write** (ingest) capabilities via MCP. This means AI agents are first-class citizens on both sides: they can query the knowledge base, and they can contribute to it.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | Expose search functions as Supabase MCP tools | P0 |
| FR-5.2 | Expose document reconstruction as MCP tool | P0 |
| FR-5.3 | Expose an ingest tool (`cerefox_save_note`) so agents can write content into the knowledge base | P1 |
| FR-5.4 | Agent-authored content is tagged with standardized metadata distinguishing it from human-authored content | P1 |
| FR-5.5 | Agents can query without needing to compute embeddings server-side | P2 |
| FR-5.6 | Custom MCP server for enhanced capabilities (embedding on server, smarter context assembly) | P2 |

#### Agent Write Metadata Convention

When an agent calls `cerefox_save_note`, the following metadata fields are set automatically or by the agent:

| Field | Set by | Example |
|-------|--------|---------|
| `source` | System | `"agent"` |
| `agent_name` | Agent (required) | `"claude-3-7-sonnet"`, `"custom-research-bot"` |
| `agent_session_id` | Agent (optional) | Session or task identifier |
| `created_by` | System | `"ai-agent"` |
| `tags` | Agent (optional) | `["summary", "research"]` |
| `confidence` | Agent (optional) | `0.9` — agent's self-assessed confidence |

This makes it easy to filter, audit, or exclude agent-authored content from searches, and to trace which agent contributed what.

### FR-6: Web Application

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-6.1 | Dashboard with document counts and recent activity | P1 |
| FR-6.2 | Knowledge browser: search, filter, navigate stored content | P1 |
| FR-6.3 | Document viewer: view full document with chunk boundaries | P1 |
| FR-6.4 | Ingest interface: upload files or paste content | P1 |
| FR-6.5 | Project management: create, edit, delete projects | P1 |
| FR-6.6 | Metadata management: view and edit metadata on documents | P1 |
| FR-6.7 | Ingestion status panel: track async jobs, view errors | P1 |

### FR-7: CLI

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-7.1 | `cerefox ingest <file>` — ingest a markdown file | P0 |
| FR-7.2 | `cerefox search <query>` — search the knowledge base | P0 |
| FR-7.3 | `cerefox list-docs` — list documents | P0 |
| FR-7.4 | `cerefox delete-doc <id>` — delete a document and its chunks | P0 |
| FR-7.5 | `cerefox projects` — list/manage projects | P1 |

### FR-10: Provenance & Trust

As multiple agents write to the same knowledge base, trust requires clear attribution. Every document and edit must be traceable.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10.1 | Every document tagged with its author: `source` field distinguishes `human`, `agent`, `file`, `web` | P0 (done) |
| FR-10.2 | Agent-authored documents include `agent_name` and optional `agent_session_id` in metadata | P1 |
| FR-10.3 | `created_at` and `updated_at` timestamps on all documents | P0 (done) |
| FR-10.4 | Implicit document versioning — see FR-11 for detailed spec | P1 |
| FR-10.5 | Review status flag — lightweight indicator of whether a human has validated agent-written content | P2 |

### FR-8: Backup & Export

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-8.1 | File system backup of raw markdown on ingest (local) | P0 |
| FR-8.2 | Full knowledge base backup: export all documents + metadata as markdown files | P0 |
| FR-8.3 | Restore from a file system backup (re-ingest all exported markdown files) | P0 |
| FR-8.4 | Optional git repository backup with per-ingest commits | P2 |
| FR-8.5 | Cloud storage backup (GCS/Firebase) for cloud deployments | P2 |

### FR-9: Deployment & Operations Scripts

Scripts that a developer or operator can run to set up, update, and maintain the storage system. These live in `scripts/` and are documented in the setup guide.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-9.1 | `scripts/db_deploy.py` — apply full schema (tables, indexes, RPCs) to a fresh Supabase/Postgres instance | P0 |
| FR-9.2 | `scripts/db_migrate.py` — apply incremental schema migrations (idempotent) | P0 |
| FR-9.3 | `scripts/db_status.py` — verify schema version, check extensions, report table stats | P0 |
| FR-9.4 | `scripts/backup_create.py` — export all documents and chunks to local markdown files | P0 |
| FR-9.5 | `scripts/backup_restore.py` — re-ingest a backup directory into a fresh database | P0 |
| FR-9.6 | All scripts accept `--dry-run` flag for safe verification before applying changes | P1 |
| FR-9.7 | All scripts print a clear summary of what was done / what would be done | P0 |

### FR-11: Document Versioning & Full Retrieval

#### Motivation

When a document is updated via `update_if_exists: true` (the standard agent workflow), the
previous content is permanently overwritten. This creates a risk of data loss — an agent or
user can accidentally replace a large, curated document with a shorter or incorrect version.
This risk is amplified by AI agents that may compress, summarize, or truncate content during
an update.

Additionally, once small-to-big retrieval (FR-4.10) is implemented, search results for large
documents will return only relevant chunks + neighbors, not the full document. A separate
API primitive is needed to retrieve the complete document text when needed (e.g., for backup,
export, manual review, or version comparison).

#### FR-11.1: Implicit Versioning (Retention-Based)

Every `update_if_exists` operation preserves the previous document content as a version.
Versions are managed with a lazy retention policy:

| Rule | Description |
|------|-------------|
| **Always-one-backup** | At least one previous version is always retained, regardless of age |
| **Time-window retention** | All versions created within the last `CEREFOX_VERSION_RETENTION_HOURS` hours are retained (default: 48) |
| **Lazy cleanup** | Expired versions (older than the retention window, beyond the always-one-backup) are deleted on the next update — no background batch job required |

**Behavior examples:**
- Document updated once per day: always has exactly 1 backup (the previous day's version)
- Document updated 10 times in 2 hours: all 10 versions are retained until 48h pass, then
  reduced to 1 backup on the next update
- Document never updated: no versions (no storage cost)

**Why this design:**
- Economical: no storage cost for documents that are never updated
- Safe: always has at least one recovery point
- Scales naturally: high-frequency documents get more versions during the retention window
- Simple: no batch jobs, no cron — cleanup runs lazily on update

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-11.1 | On `update_if_exists`, preserve the previous content as a version before overwriting | P1 |
| FR-11.2 | Always retain at least one previous version per document | P1 |
| FR-11.3 | Retain all versions created within `CEREFOX_VERSION_RETENTION_HOURS` (default: 48) | P1 |
| FR-11.4 | On each update, lazily delete versions older than the retention window (except the most recent one) | P1 |
| FR-11.5 | Versions store: full content, all metadata, timestamp, and the source/agent that performed the update | P1 |

#### FR-11.2: Full Document Retrieval API

A dedicated API endpoint and MCP tool for retrieving the complete text of a specific
document, plus optionally a specific version. This is distinct from search (which may return
chunks for large documents) and serves as the primitive for:

- Backup and export of large documents
- Viewing the full text of a document that search returns only chunks from
- Retrieving a previous version for comparison or manual restore
- Agents that need the complete document (e.g., for re-ingestion, translation, analysis)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-11.6 | Retrieve full document text + metadata by document ID | P1 |
| FR-11.7 | Optionally specify a version ID to retrieve a previous version | P1 |
| FR-11.8 | List available versions for a document (ID, timestamp, size, source) | P1 |
| FR-11.9 | Expose full document retrieval via REST API, MCP tool, and CLI | P1 |
| FR-11.10 | Restoring a previous version is done outside Cerefox: retrieve old version → ingest as new version (no in-place restore API) | P1 |

#### Database Impact

Versioning requires a new table (e.g., `cerefox_document_versions`) linked to
`cerefox_documents` with cascade delete. Each version row stores the full content snapshot,
metadata snapshot, and a timestamp. Versions do NOT have chunks or embeddings — they are
plain text snapshots for recovery purposes only.

#### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `CEREFOX_VERSION_RETENTION_HOURS` | `48` | Hours to retain all versions before lazy cleanup |

---

## 3. Non-Functional Requirements

### NFR-1: Cost

| ID | Requirement |
|----|-------------|
| NFR-1.1 | Operate at low cost: Supabase free tier + cloud embedding API (see `docs/guides/operational-cost.md`) |
| NFR-1.2 | Embedding cost is the only ongoing API cost for core functionality |
| NFR-1.3 | Alternative cloud embedders (Fireworks AI) are supported as drop-in replacements |

### NFR-2: Performance

| ID | Requirement |
|----|-------------|
| NFR-2.1 | Search responses return within 2 seconds for typical queries |
| NFR-2.2 | Ingestion latency is acceptable (seconds to minutes) — async, not user-facing |
| NFR-2.3 | Support at least 10,000 documents / 100,000 chunks on free tier |

### NFR-3: Data Ownership

| ID | Requirement |
|----|-------------|
| NFR-3.1 | All data stored in user-controlled infrastructure |
| NFR-3.2 | No vendor lock-in — can migrate from Supabase to self-hosted Postgres |
| NFR-3.3 | Data is exportable in standard formats (markdown) |
| NFR-3.4 | No telemetry or data collection by Cerefox itself |

### NFR-4: Extensibility

| ID | Requirement |
|----|-------------|
| NFR-4.1 | Embedders are pluggable (implement protocol, register) |
| NFR-4.2 | Metadata schema is evolvable (JSONB, no rigid columns) |
| NFR-4.3 | Projects/categories are user-defined and manageable at runtime |
| NFR-4.4 | Content converters are pluggable (add new formats without core changes) |

### NFR-5: Simplicity

| ID | Requirement |
|----|-------------|
| NFR-5.1 | Single-user system (no auth complexity in V1) |
| NFR-5.2 | Minimal dependencies — prefer standard library when possible |
| NFR-5.3 | Web UI has no JavaScript build step (Jinja2 + HTMX) |
| NFR-5.4 | Docker Compose for full local deployment |

### NFR-7: Documentation & Onboarding

Cerefox is an open source project. Documentation is treated as a first-class deliverable, not an afterthought.

| ID | Requirement |
|----|-------------|
| NFR-7.1 | Each deployment option (Supabase, local Docker, Cloud Run) has a step-by-step setup guide |
| NFR-7.2 | A quickstart guide gets a new user from zero to first ingested document in under 15 minutes |
| NFR-7.3 | Every script in `scripts/` has inline documentation and is covered in the ops guide |
| NFR-7.4 | MCP connection setup is documented for at least: Claude, Cursor, and a generic MCP client |
| NFR-7.5 | Configuration reference documents every `CEREFOX_` environment variable with defaults and examples |
| NFR-7.6 | A contributing guide explains how to add new embedders, content converters, or CLI commands |
| NFR-7.7 | Docs are updated in the same session/commit as the code they describe |

### NFR-6: Test Coverage

| ID | Requirement |
|----|-------------|
| NFR-6.1 | Every code module has a corresponding test module |
| NFR-6.2 | Tests are written alongside code, not deferred |
| NFR-6.3 | Unit tests mock all external dependencies (DB, embedding APIs) |
| NFR-6.4 | Integration tests are clearly marked and skipped by default |
| NFR-6.5 | Tests cover: happy path, edge cases, and known error conditions |
| NFR-6.6 | CI runs the unit test suite on every commit |

---

## 4. Technical Specifications

### 4.1 Database

- **Engine**: PostgreSQL 16+ with `pgvector` and `uuid-ossp` extensions
- **Hosting**: Supabase (primary) or local Docker
- **Vector dimensions**: 768 (fixed)
- **FTS config**: English (`to_tsvector('english', ...)`)
- **Index types**: GIN for FTS, HNSW for vectors, GIN for JSONB metadata

### 4.2 Embeddings

- **Default**: OpenAI `text-embedding-3-small` (768-dim, cloud API)
- **Alternative**: Fireworks AI (same OpenAI-compatible API, different base URL + model)
- **Future**: Vertex AI (parameterized, opt-in)
- **Normalization**: all embeddings are L2-normalized before storage
- **Distance metric**: cosine similarity (via `<=>` operator)

### 4.3 Chunking

- **Input**: Markdown text
- **Strategy**: heading-based (H1 > H2 > H3 > paragraph fallback)
- **Max chunk size**: 4000 characters (configurable)
- **Min chunk size**: 100 characters (merge upward if smaller)
- **Paragraph overlap**: none (greedy section accumulation, no overlapping content between chunks)

### 4.4 API & MCP

- **Supabase MCP endpoint**: `https://mcp.supabase.com/<project-ref>`
- **Response size limit**: 65000 bytes (parameterized via `CEREFOX_MAX_RESPONSE_BYTES`)
- **RPC naming**: all prefixed with `cerefox_`

### 4.5 Tech Stack

| Component | Technology |
|-----------|------------|
| Language | Python 3.11+ |
| Package management | uv |
| Web framework | FastAPI |
| Templating | Jinja2 |
| Frontend interactivity | HTMX |
| CLI | Click |
| Database client | supabase-py |
| Embeddings | httpx, openai (cloud API) |
| Testing | pytest |
| Linting | ruff |
| Containerization | Docker |
| License | Apache 2.0 |

---

## 5. Configuration Parameters

All parameters use `CEREFOX_` prefix and can be set via environment variables or `.env` file.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `CEREFOX_SUPABASE_URL` | — | Supabase project URL |
| `CEREFOX_SUPABASE_KEY` | — | Supabase service role key |
| `OPENAI_API_KEY` | — | OpenAI API key for embeddings |
| `CEREFOX_EMBEDDER` | `openai` | Default embedder: `openai`, `fireworks` |
| `CEREFOX_MAX_RESPONSE_BYTES` | `65000` | Max response size for MCP/search |
| `CEREFOX_MAX_CHUNK_CHARS` | `4000` | Max characters per chunk |
| `CEREFOX_MIN_CHUNK_CHARS` | `100` | Min characters per chunk |
| `CEREFOX_BACKUP_DIR` | `./backups` | Directory for file system backups |
| `CEREFOX_VECTOR_DIMENSIONS` | `768` | Embedding vector dimensions |
| `CEREFOX_LOG_LEVEL` | `INFO` | Logging level |
| `CEREFOX_SMALL_TO_BIG_THRESHOLD` | `40000` | Doc size (chars) above which search returns chunks + neighbors instead of full document |
| `CEREFOX_CONTEXT_WINDOW` | `1` | Number of neighbor chunks on each side of matched chunks in small-to-big retrieval |
| `CEREFOX_VERSION_RETENTION_HOURS` | `48` | Hours to retain all document versions before lazy cleanup |
