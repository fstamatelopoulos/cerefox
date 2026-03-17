# Cerefox - Project Guide

## What Is This

Cerefox is a personal "second brain" knowledge base. It stores markdown notes, thoughts, and ideas in Supabase (Postgres + pgvector), supports hybrid search (FTS + semantic), and exposes everything via MCP so any AI agent can query it.

Single-user, open-source (Apache 2.0), designed to be cheap/free to operate.

## Tech Stack

- **Language**: Python 3.11+
- **Database**: PostgreSQL 16+ with pgvector (Supabase free tier or local Docker)
- **Embeddings**: OpenAI `text-embedding-3-small` (768-dim, cloud API); Fireworks AI as alternative; Edge Functions handle embedding server-side for agents
- **Web framework**: FastAPI (API + web UI backend)
- **Web UI**: Jinja2 templates + HTMX (lightweight, no JS build step)
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
│       │   ├── app.py             # FastAPI application
│       │   └── routes.py          # API endpoints
│       ├── mcp_server.py          # MCP stdio server (cerefox mcp)
│       └── cli.py                 # CLI entry point
├── web/
│   └── templates/                 # Jinja2 templates for web UI
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

## Key Design Decisions

1. **Two-table schema** (documents + chunks) instead of single flat table — enables clean document lifecycle management and small-to-big retrieval
2. **768-dim vectors** standardized across all embedders — choose models that output 768 dims or use dimensionality reduction
3. **JSONB metadata** on both documents and chunks — evolvable without schema changes
4. **Greedy section accumulation** — sections (H1/H2/H3) are accumulated into a buffer until adding the next would exceed `max_chunk_chars`; no hard heading-level boundaries
5. **Cloud-only embeddings** (OpenAI / Fireworks) — local models (mpnet, Ollama) removed; they caused platform-specific failures and added install complexity
6. **Supabase Edge Functions** (`cerefox-search`, `cerefox-ingest`, `cerefox-mcp`) — embed server-side so agents never need a local embedding model; `cerefox-mcp` is the recommended MCP endpoint for all Claude/Cursor clients (via Streamable HTTP); Claude Desktop uses `supergateway` as a stdio-to-HTTP bridge; `mcp-remote` does NOT work with Supabase (GoTrue OAuth conflict)

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
| `connect-agents.md` | MCP setup for Claude, Cursor, and generic clients |
| `configuration.md` | All `CEREFOX_` environment variables with defaults |
| `ops-scripts.md` | All `scripts/` — deploy, migrate, backup, restore |
| `operational-cost.md` | Embedding and hosting cost estimates |
| `contributing.md` | How to add embedders, converters, CLI commands |

**Rule**: a setup guide must be written before (or alongside) the feature it documents — not after the fact.

## Quick Reference

- **Docs**: `docs/plan.md` for current status, `docs/TODO.md` for backlog
- **Schema**: `src/cerefox/db/schema.sql`
- **Config**: `.env` file or environment variables (see `src/cerefox/config.py`)
- **Max response size**: defaults to 65000 bytes (practical ceiling; configurable via `CEREFOX_MAX_RESPONSE_BYTES`)
