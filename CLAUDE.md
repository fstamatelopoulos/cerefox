# Cerefox - Project Guide

## What Is This

Cerefox is a user-owned knowledge memory layer for AI agents. It stores curated Markdown documents in Supabase (Postgres + pgvector), supports hybrid search (FTS + semantic), and exposes everything via MCP and REST so any AI agent can read and write.

Cerefox is **asynchronous shared memory, not a message bus**. It solves the persistent context problem: knowledge written in one context is findable in any other, dissolving boundaries between agents, sessions, human and machine, and across time. It does not handle real-time agent-to-agent communication; protocols like A2A handle that. Cerefox handles persistent memory.

Single-user, open-source (Apache 2.0), designed to be cheap/free to operate. See `docs/research/vision.md` for the full project vision.

## Tech Stack

- **Language**: Python 3.11+
- **Database**: PostgreSQL 16+ with pgvector (Supabase free tier or local Docker)
- **Embeddings**: OpenAI `text-embedding-3-small` (768-dim, cloud API); Fireworks AI as alternative; Edge Functions handle embedding server-side for agents
- **Web framework**: FastAPI (JSON API backend)
- **Web UI**: React + TypeScript SPA (Mantine UI, TanStack Query, Vite); served at `/app/`
- **CLI**: Click
- **Package management**: uv (pyproject.toml)
- **Testing**: pytest
- **Linting**: ruff

## Project Structure

```
cerefox/
├── CLAUDE.md                  # This file
├── pyproject.toml
├── docs/
│   ├── requirements-and-specs.md  # Source of truth for requirements
│   ├── solution-design.md         # Architecture and design decisions
│   ├── plan.md                    # Implementation plan with progress
│   └── TODO.md                    # Backlog and future ideas
├── src/
│   └── cerefox/
│       ├── __init__.py
│       ├── config.py              # Settings via pydantic-settings
│       ├── db/
│       │   ├── schema.sql         # Database schema
│       │   ├── rpcs.sql           # Search RPC functions
│       │   └── client.py          # Supabase/Postgres client wrapper
│       ├── chunking/
│       │   ├── markdown.py        # Heading-aware MD splitter
│       │   └── converters.py      # PDF/DOCX → MD (future)
│       ├── embeddings/
│       │   ├── base.py            # Embedder protocol/interface
│       │   └── cloud.py           # OpenAI/Fireworks REST API embedder
│       ├── ingestion/
│       │   └── pipeline.py        # Ingest documents → chunks → DB
│       ├── retrieval/
│       │   └── search.py          # Search + small-to-big assembly
│       ├── backup/
│       │   └── fs_backup.py       # File system / git backup
│       ├── api/
│       │   ├── app.py             # FastAPI application factory
│       │   ├── routes_api.py      # JSON API endpoints (/api/v1/)
│       │   └── deps.py            # Shared dependency injection
│       ├── mcp_server.py          # MCP stdio server (cerefox mcp)
│       └── cli.py                 # CLI entry point
├── frontend/                      # React + TypeScript SPA
│   ├── src/                       # Components, pages, hooks, API client
│   ├── vite.config.ts             # Vite build config (base: /app/)
│   └── package.json
├── web/
│   └── static/                    # Static assets (logo, favicon)
├── scripts/
│   ├── db_deploy.py           # Deploy schema to Supabase/Postgres
│   ├── db_migrate.py          # Apply schema migrations
│   ├── backup_create.py       # Take a local backup of the knowledge base
│   └── backup_restore.py      # Restore from a backup
├── tests/
│   ├── chunking/
│   ├── embeddings/
│   ├── ingestion/
│   ├── retrieval/
│   └── conftest.py
├── docker-compose.yml
└── Dockerfile
```

## Development Conventions

### Code Style
- Use ruff for linting and formatting (line length 100)
- Type hints on all public functions
- Docstrings only where the purpose isn't obvious from the name/signature
- Prefer simple, flat code over abstractions — don't create a helper for something used once

### Naming
- Database tables: `cerefox_` prefix (e.g., `cerefox_documents`, `cerefox_chunks`)
- Database RPCs: `cerefox_` prefix (e.g., `cerefox_hybrid_search`)
- Python modules: snake_case, short names
- Config: environment variables with `CEREFOX_` prefix

### Architecture Principles
- **Pluggable embedders**: all embedders implement the `Embedder` protocol (see `embeddings/base.py`)
- **Markdown-first**: all content is converted to markdown before chunking/storage
- **Fire-and-forget ingestion**: ingestion can be async; failures log errors but don't block
- **Parameterized limits**: response size limits, chunk sizes, etc. are configurable via settings
- **Two-table design**: `cerefox_documents` (document-level) + `cerefox_chunks` (chunk-level) for clean separation
- **Usage tracking**: `cerefox_usage_log` logs all operations (reads and writes); `cerefox_config` stores runtime config (e.g., `usage_tracking_enabled`). Opt-in; controlled via RPC, not env vars. `cerefox_log_usage` RPC checks config on every call and returns immediately when disabled. Each entry records `requestor` (who: agent name or "user") and `access_path` (where: remote-mcp, local-mcp, edge-function, webapp, cli).

### Configuration
- Use pydantic-settings with `.env` file support
- All config has sensible defaults for local development
- Key settings: `CEREFOX_SUPABASE_URL`, `CEREFOX_SUPABASE_KEY`, `OPENAI_API_KEY`, `CEREFOX_EMBEDDER`, `CEREFOX_MAX_RESPONSE_BYTES`

### Testing
- **Write tests alongside code, not after** — every module added to `src/cerefox/` gets a corresponding test module in `tests/`
- Tests go in `tests/` mirroring `src/cerefox/` structure (e.g., `tests/chunking/test_markdown.py`)
- Use fixtures for DB client mocking — never hit a real database in unit tests
- Test at least: happy path, edge cases (empty input, max size, malformed input), error conditions

**Test suites and how to run them:**

| Suite | Command | What it does |
|-------|---------|-------------|
| Unit tests | `uv run pytest` | Fast, mocked, no network (default) |
| API e2e | `uv run pytest -m e2e` | Hits live Supabase (REST API + Edge Functions) |
| UI e2e | `uv run pytest -m ui` | Playwright browser tests against local web app |
| All e2e | `uv run pytest -m "e2e or ui"` | Both API and UI e2e |

- **API e2e** (`tests/e2e/test_api_e2e.py`): Uses credentials from `.env`. Edge Function tests need `CEREFOX_SUPABASE_ANON_KEY` (JWT). Cleans up `[E2E]`-prefixed test data automatically.
- **UI e2e** (`tests/e2e/test_ui_e2e.py`): Requires web app running at `http://127.0.0.1:8000/`. Uses Playwright + Chromium. Install browsers: `uv run playwright install chromium`.
- See `docs/e2e-use-cases.md` for the full use-case matrix and TODO list.

### Git (Lightweight GitHub Flow)

**Branch model:**
- **`main`** is always deployable. All work lands here.
- **Feature branches** (`feat/metadata-overhaul`, `fix/search-empty-content`) for non-trivial changes — anything that touches multiple files or takes more than one session.
- **Direct commits to `main`** are fine for: typo fixes, single-file doc updates, small config tweaks, and hotfixes.
- No `develop` branch, no `release/*` branches.
- No force pushes to main.

**When to use a branch + PR:**
1. The change spans multiple files or multiple logical steps
2. The change could break something and you want a clean rollback point
3. You want a summary artifact (PR description explains *why*)

**When to commit directly to `main`:**
1. Single-file doc fix or typo
2. Small config change (`.gitignore`, version bump)
3. Hotfix for a bug you just introduced

**Commit messages:**
```
<verb> <what changed>

<optional body: why, context, trade-offs>

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
- Imperative mood: "Add", "Fix", "Update", "Remove"
- First line under 72 characters
- Body explains *why*, not what — the diff shows what changed
- Co-authored-by trailer on every commit where Claude contributed
- One logical change per commit

**PR conventions:**
- Title: short, imperative, under 70 chars
- Body: Summary (bullet points) + Test plan (checklist)
- Merge style: **Squash and merge** by default

**Release tagging:**
- Tag on `main`: `v0.1.0`, `v0.2.0`
- Annotated tags: `git tag -a v0.1.0 -m "First public release"`

## Edge Functions & MCP Architecture

### The Pattern: One Edge Function Per Operation

Every Cerefox operation is implemented **once** in a Postgres RPC (SECURITY DEFINER function). Edge Functions are thin HTTP adapters over those RPCs — nothing more.

```
Agent / MCP client
      │
      ▼  (anon key, JWT validated by Supabase gateway)
cerefox-mcp  ──supabase.rpc──▶  cerefox_hybrid_search / cerefox_search_docs
             ──supabase.rpc──▶  cerefox_ingest_document
             ──supabase.rpc──▶  cerefox_list_metadata_keys
             ──supabase.rpc──▶  cerefox_get_document
             ──supabase.rpc──▶  cerefox_list_document_versions
             ──supabase.rpc──▶  cerefox_list_audit_entries
             ──supabase.rpc──▶  cerefox_list_projects
             ──supabase.rpc──▶  cerefox_metadata_search

GPT Actions (Custom GPT) ──────▶  cerefox-search           (primitive Edge Functions, direct HTTP)
                         ──────▶  cerefox-ingest
                         ──────▶  cerefox-metadata
                         ──────▶  cerefox-get-document
                         ──────▶  cerefox-list-versions
                         ──────▶  cerefox-get-audit-log
                         ──────▶  cerefox-metadata-search
                         ──────▶  cerefox-list-projects

Python CLI / Web UI ───────────▶  cerefox.db.client     ──psycopg2 / REST──▶  same RPCs
```

Note: `cerefox-mcp` calls RPCs directly (no delegation to primitive Edge Functions). This halves billable invocations for every MCP tool call. Primitive Edge Functions remain unchanged for GPT Actions and direct HTTP clients.

### Auth Pattern — Three Layers

Cerefox has three distinct access layers, each with its own credential:

1. **AI agents / Edge Functions** — callers (MCP clients, GPT Actions, curl) use the **anon key** (JWT). The Supabase gateway validates it; Edge Functions then use `SUPABASE_SERVICE_ROLE_KEY` internally to call RPCs. Callers never see the service-role key.
2. **Python web app & CLI** — `CerefoxClient` authenticates with the **service-role key** via the Supabase REST API. This bypasses RLS and gives unrestricted read/write access. Never expose this key to clients.
3. **Deployment scripts only** — `db_deploy.py` / `db_migrate.py` connect directly to Postgres via psycopg2 using the **database password** (`CEREFOX_DATABASE_URL`). No application code uses this path at runtime.

See `docs/guides/access-paths.md` for a full breakdown with credential sources and a summary table.

### Single Implementation Principle

Business logic lives **only in Postgres RPCs** wherever feasible. If you need to add logic to a tool:
1. Add or modify the RPC in `src/cerefox/db/rpcs.sql`
2. The Python client (`db/client.py`) calls the RPC via `supabase.rpc()`
3. The dedicated primitive Edge Function calls the same RPC via `supabase.rpc()`
4. The corresponding `cerefox-mcp` tool handler in `tools/*.ts` calls the same RPC directly

**Do NOT** add business logic directly in Edge Function TypeScript, Python routes, or `cerefox-mcp`. The only logic in Edge Functions is input validation, RPC call, and JSON response formatting.

**Ingestion**: The ingestion pipeline has two steps: (1) chunking + embedding (requires external HTTP calls, runs in Python or TypeScript), and (2) database writes (insert document, insert chunks, snapshot version, set review_status, create audit entry). Step 2 is handled entirely by the `cerefox_ingest_document` RPC -- a single atomic transaction. Both the Python `IngestionPipeline` and the `cerefox-ingest` Edge Function call this RPC after completing step 1. This ensures all write logic, review_status transitions, and audit entry creation happen in one place.

**Important**: when adding new write logic (e.g., a new field on documents, a new side effect of ingestion), add it to the `cerefox_ingest_document` RPC, not to the Python pipeline or Edge Function. The callers should only handle chunking, embedding, and parameter preparation.

**Simple CRUD** operations (read/list queries on documents, chunks, projects; project create/update/delete) use the Supabase REST API directly (`client.table(...)`). This is acceptable as these are pure data access with no business logic.

### Edge Function Inventory

| Edge Function | Purpose | Called By |
|---|---|---|
| `cerefox-search` | Hybrid FTS + semantic search; handles server-side embedding | GPT Actions, Python client, direct HTTP |
| `cerefox-ingest` | Ingest document; chunks, embeds, versions, stores | GPT Actions, Python client, direct HTTP |
| `cerefox-metadata` | List metadata keys with doc counts + example values | GPT Actions, direct HTTP |
| `cerefox-get-document` | Retrieve full doc content; supports archived versions | GPT Actions, direct HTTP |
| `cerefox-list-versions` | List archived version history for a document | GPT Actions, direct HTTP |
| `cerefox-get-audit-log` | Query audit log entries with filters (document, author, operation, time range) | GPT Actions, direct HTTP |
| `cerefox-metadata-search` | Query documents by metadata key-value criteria without text search | GPT Actions, direct HTTP |
| `cerefox-list-projects` | List all projects with names, IDs, and descriptions | GPT Actions, direct HTTP |
| `cerefox-mcp` | MCP Streamable HTTP server; calls RPCs directly via `tools/*.ts` | Claude Code, Cursor, Claude Desktop (via supergateway) |

### Edge Function Model Config

`OPENAI_MODEL` and `EMBEDDING_DIMENSIONS` are TypeScript constants inside each Edge Function (not Supabase secrets). They are not sensitive — they're configuration. Changing the model requires editing the constant and redeploying the function (`npx supabase functions deploy <name>`). This is by design: changing the embedding model is a breaking schema change that also requires `cerefox reindex` to re-embed all existing chunks, so a redeploy is expected.

### Client Compatibility

| Client | How to connect | Notes |
|---|---|---|
| Claude Code | `claude mcp add --transport http cerefox <url> --header "Authorization: Bearer <anon-key>"` | Direct Streamable HTTP |
| Cursor | `url` + `headers.Authorization` in mcp.json | Same as Claude Code |
| Claude Desktop | `npx -y supergateway --streamableHttp <url> --header "Authorization: Bearer <anon-key>"` | `supergateway` is required; `mcp-remote` does NOT work (GoTrue OAuth conflict) |
| ChatGPT | Custom GPT + GPT Actions (OpenAPI spec pointing at Edge Functions) | Streamable HTTP MCP not supported by ChatGPT |
| Claude.ai web | Not supported | No native Streamable HTTP MCP |

---

## Key Design Decisions

1. **Two-table schema** (documents + chunks) instead of single flat table — enables clean document lifecycle management and small-to-big retrieval
2. **768-dim vectors** standardized across all embedders — choose models that output 768 dims or use dimensionality reduction
3. **JSONB metadata** on both documents and chunks — evolvable without schema changes
4. **Greedy section accumulation** — sections (H1/H2/H3) are accumulated into a buffer until adding the next would exceed `max_chunk_chars`; no hard heading-level boundaries
5. **Cloud-only embeddings** (OpenAI / Fireworks) — local models (mpnet, Ollama) removed; they caused platform-specific failures and added install complexity
6. **Edge Function per operation** — each operation has a dedicated Edge Function that is a thin HTTP adapter over a Postgres RPC; `cerefox-mcp` delegates to dedicated Edge Functions via internal fetch; single implementation principle (see above)
7. **Chunks-anchored versioning** — `version_id IS NULL` = current version; `version_id = <uuid>` = archived; partial indexes automatically exclude archived chunks from search; no separate content table

## Documentation as Source of Truth

Documentation is a **first-class deliverable**, not an afterthought. This is an open source project — the quality of our docs determines whether anyone else can use it. Every iteration includes documentation work.

### Internal Docs (developer/agent context)

Kept accurate and current at all times:

| File | Owner | Update When |
|------|-------|-------------|
| `docs/requirements-and-specs.md` | Requirements | A requirement changes or is added/removed |
| `docs/solution-design.md` | Architecture | A design decision is made or revised |
| `docs/plan.md` | Progress | A task starts, completes, or is re-scoped |
| `docs/TODO.md` | Backlog | A new idea or future task surfaces |
| `docs/e2e-use-cases.md` | Testing | An e2e test is added, removed, or changes status |
| `CLAUDE.md` | Conventions | Project conventions or structure changes |

**Rule**: when implementing a feature, update the relevant docs in the same commit/session. Another developer or AI agent should be able to read these files at any point and have an accurate picture of what is built, what is planned, and why.

### Cerefox Decision Log (lives in Cerefox, NOT in the repo)

The **"Cerefox Decision Log"** document is stored in the Cerefox knowledge base (project: `cerefox`), not in the git repo. It contains operational details, lessons learned, and experiment outcomes that are useful as memory during future development that will not pollute the OSS project.

**Update it every session** by calling `cerefox_ingest` with `update_if_exists: true`:
- Add new architectural or process decisions (with date, context, options, decision, outcome)
- Add new experiments, failures, or platform gotchas to the "Lessons Learned" section
- Search for it first with `cerefox_search` query `"Cerefox Decision Log"` to review current content

**When to add an entry**:
- A significant technical decision is made or revised
- A platform behavior surprises us (MCP client compatibility, Supabase gotchas, etc.)
- An experiment fails and we learn something worth remembering
- A workaround is discovered for a third-party bug
- **NEVER compress or summarize** existing entries when updating — always add new entries
  and keep existing ones verbatim. Accidental compression causes data loss.
- **Splitting policy**: when the document exceeds ~50,000 characters, create a new document
  that continues the log (e.g., "Cerefox Decision Log — 2026 Q2"). Each part is a standalone
  document in Cerefox with the same project and metadata tags. Do NOT try to split at an
  exact boundary — finish the current entry, then start a new document for subsequent entries.
- **Rolling summary** (future): a separate "Cerefox Decision Log — Current Summary" that's
  a compressed digest of all active decisions and top lessons. Agents load this instead of
  the full history.
- The full log stays searchable even when split: `cerefox_search` finds entries by content
  across all documents.

### User-Facing Docs (setup guides, how-tos)

These live in `docs/guides/` and are written for someone who has never seen the codebase:

| Guide | Covers |
|-------|--------|
| `quickstart.md` | Zero to first ingested document in < 15 minutes |
| `setup-supabase.md` | Full Supabase deployment (schema, MCP, config) |
| `setup-local.md` | Full local Docker deployment |
| `setup-cloud-run.md` | GCP Cloud Run deployment |
| `access-paths.md` | All access layers, credentials, and integration paths |
| `connect-agents.md` | MCP setup for Claude, Cursor, and generic clients |
| `configuration.md` | All `CEREFOX_` environment variables with defaults |
| `ops-scripts.md` | All `scripts/` — deploy, migrate, backup, restore |
| `operational-cost.md` | Embedding and hosting cost estimates |
| `CONTRIBUTING.md` (repo root) | How to contribute to Cerefox |

**Rule**: a setup guide must be written before (or alongside) the feature it documents — not after the fact.

## Quick Reference

- **Docs**: `docs/plan.md` for current status, `docs/TODO.md` for backlog
- **Schema**: `src/cerefox/db/schema.sql`
- **Config**: `.env` file or environment variables (see `src/cerefox/config.py`)
- **Max response size**: defaults to 200000 bytes (MCP/Edge Function paths only; web UI and CLI are unlimited; configurable via `CEREFOX_MAX_RESPONSE_BYTES`)
