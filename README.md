<p align="center">
  <img src="web/static/cerefox_logo.jpg" alt="Cerefox" width="160">
</p>

# Cerefox

**User-owned shared memory for AI agents.** A persistent, curated knowledge layer that multiple AI tools can read and write, backed by Postgres + pgvector.

[![Apache 2.0 License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://python.org)
[![Node 20+](https://img.shields.io/badge/node-20+-green.svg)](https://nodejs.org)

---

## What is Cerefox?

Cerefox is a **user-owned knowledge memory layer**: a persistent, curated knowledge base that sits between you and the AI tools you use.

The primary use case is **shared memory across AI agents**: knowledge written by one tool (Claude, ChatGPT, Cursor, or a custom agent) becomes immediately available to all others. This prevents context fragmentation, so the same information doesn't have to be re-explained in every session.

Cerefox is **asynchronous shared memory, not a message bus**. It solves the persistent context problem: knowledge written in one context is findable in any other. A user curates project documents and an AI agent discovers them through search without being told they exist. An agent writes a decision during a coding session and a different agent, on a different machine, running a different model, finds it days later. A user switches from one AI tool to another and the accumulated knowledge carries over without manual transfer. The boundaries that Cerefox dissolves are between agents, between sessions, between human and machine, and across time.

> For the full project vision, principles, and roadmap direction, see [`docs/research/vision.md`](docs/research/vision.md).

- **Agent-first, not human-first**: AI agents are first-class citizens on both sides: they read *and* write; humans curate and validate
- **Own your data**: everything lives in a Postgres database you control (Supabase free tier or self-hosted)
- **Cross-agent coordination**: agents on separate machines and runtimes coordinate through persistent shared context (see `docs/guides/agent-coordination.md`)
- **Not a note-taking app**: Cerefox is knowledge *infrastructure*, not a replacement for Obsidian, Notion, or Bear; those tools handle authoring, Cerefox handles indexing and agent access
- **Hybrid search**: full-text + semantic search finds relevant knowledge even with fuzzy or conceptual queries
- **Any agent, anywhere**: remote MCP via Supabase Edge Functions; ChatGPT via Custom GPT + GPT Actions
- **Keep it cheap**: Supabase free tier + low-cost cloud embeddings; see `docs/guides/operational-cost.md`

---

## Features

| Feature | Details |
|---------|---------|
| **Hybrid search** | Combines full-text (BM25) + semantic (vector) search with a configurable alpha weight |
| **Metadata-filtered search** | JSONB containment filter (`@>`) on document metadata; server-side, GIN-indexed; composable with project filter and all search modes; available across all access paths (MCP, CLI, web UI, GPT Actions) |
| **Metadata search** | Standalone metadata-only search (no text query needed); find documents by key-value criteria, project, and date range; optional content inclusion with byte budget; dedicated MCP tool, CLI command, and web UI page |
| **Project discovery** | `cerefox_list_projects` MCP tool for agents to discover available projects; all search results include human-readable `project_names` alongside UUIDs |
| **Heading-aware chunking** | Greedy section accumulation — H1/H2/H3 sections accumulate until MAX_CHUNK_CHARS; heading breadcrumb preserved per chunk |
| **Cloud embeddings** | OpenAI `text-embedding-3-small` (768-dim) via API — or swap to Fireworks AI |
| **Remote MCP endpoint** | `cerefox-mcp` Supabase Edge Function — MCP Streamable HTTP; connect Claude Desktop, Claude Code, or Cursor with just a URL and anon key; no Python install needed |
| **Local MCP server** | `cerefox mcp` stdio server -- local alternative with zero Edge Function usage, lower latency, and offline support; requires Python + uv + local clone |
| **Web UI** | React + TypeScript SPA (Mantine UI) at `/app/`; FastAPI JSON API backend; Markdown viewer, search with 4 modes, document editing, project management |
| **Multi-format ingest** | `.md`, `.txt`, `.pdf` (pypdf), `.docx` (python-docx) |
| **Batch ingest** | `cerefox ingest-dir` recurses directories |
| **Deduplication** | SHA-256 content hash; re-ingesting the same file is a no-op |
| **Backup and restore** | JSON snapshots, optional git commit |
| **Small-to-big retrieval** | `cerefox_context_expand` RPC returns chunk neighbours for richer context |
| **Audit log** | Immutable, append-only log of all write operations (create, update, delete, status change). Author attribution with `author_type` ('user' or 'agent'). Browsable via web UI, queryable via MCP tool and Edge Function |
| **Review status** | Schema-level `review_status` on documents (`approved` / `pending_review`). Auto-transitions based on author_type. Filterable on search |
| **Version governance** | Version archival (protect specific versions from cleanup), configurable retention (`CEREFOX_VERSION_CLEANUP_ENABLED`), version diff viewer |
| **Usage tracking** | Opt-in logging of all operations (reads and writes) across all access paths. Tracks operation type, access path (remote-mcp, local-mcp, edge-function, webapp, cli), requestor identity, query text, and result count. Controlled via `cerefox config-set usage_tracking_enabled true/false` -- no redeploy needed |
| **Analytics dashboard** | `/app/analytics` -- 7 interactive charts: calls per day, access path breakdown, top documents, top readers, operations donut, reader word cloud, and reader-to-document access pattern visualization (HEB). Date range + project + path filters. CSV export. |

---

## Project status

Cerefox is a single-maintainer open-source project, currently at **v0.5.0** and in
its **"Polish & Distribution" arc** — the work that takes it from "runnable from a
git clone" to "installable like any other modern CLI". Highlights of what's
already shipped (full history in [`CHANGELOG.md`](CHANGELOG.md)):

- A complete Cerefox feature surface: hybrid search, metadata-filtered search,
  small-to-big retrieval, implicit versioning with a per-document audit log,
  soft-delete with a trash bin, multi-project membership.
- Three integration paths for AI agents: local stdio MCP, remote MCP via
  Supabase Edge Functions, and a Custom GPT via GPT Actions. Plus a CLI fallback
  for local coding agents.
- A React + Mantine web UI at `/app/` with full read/write coverage of the
  knowledge base.

**Where the project is headed** is captured in
[`docs/specs/polish-and-distribution-design.md`](docs/specs/polish-and-distribution-design.md)
(also tracked iteration-by-iteration in [`docs/plan.md`](docs/plan.md)):

| Release | Theme | Ships |
|---|---|---|
| v0.2.0 | Foundations + first TS artifact | `VERSION` source-of-truth · OSS hygiene files · SemVer + script-language policies · `scripts/cut_release.ts` (first TS script outside Edge Functions and frontend) |
| v0.3.0 | "Install anywhere" | `~/.cerefox/` user-state root · `cerefox docs` CLI + `/app/help` web UI · schema-version-mismatch banner · first two Python scripts ported to TS (`sync_docs.ts`, `db_status.ts`) · `_shared/` TS module seeded |
| v0.4.x | TS MCP server | Local `cerefox mcp` becomes a TypeScript Bun/Node process, published as [`@cerefox/memory`](https://www.npmjs.com/package/@cerefox/memory) on npm · 10th MCP tool `cerefox_get_help` · `_shared/mcp-tools/` shared by remote EF + local server · OIDC trusted publishing |
| **v0.5.0** (current) | TS CLI | `cerefox` binary added to `@cerefox/memory` (same package, growing surface) — callable from any directory, no Python install needed · 6 new lifecycle commands (`init`, `doctor`, `status`, `configure-agent`, `self-update`, `sync-self-docs`) · automatic self-doc ingest (Layer 2 of MCP discoverability) · tab completion for bash/zsh/fish · documented exit codes · Python CLI deprecated (functional through v0.7) |
| v0.6.0 – v0.7.0 | TS web server + ingestion pipeline | FastAPI → Hono · Python ingestion → TS · all inside `@cerefox/memory` (single npm package, growing surface) |
| v0.8.0 – v0.9.0 | Python retirement | Deprecation banners → removal |
| **v1.0.0** | Stability commitment | Strict SemVer becomes binding; long-lived API contract |

Until v1.0.0 the SemVer policy in [`CONTRIBUTING.md`](CONTRIBUTING.md) is
aspirational — breaking changes can land in minor versions when there's a good
reason. After v1.0.0 it's binding. **The npm install path is now open** as of
v0.4.0: end users can run `npx -y --package=@cerefox/memory cerefox mcp` for
the local MCP server (no Python required). The Python CLI + web UI + ingestion
pipeline still need a clone + `uv` install; that changes through v0.5–v0.7 as
the remaining components migrate. (v0.4–v0.5.0 also shipped a dedicated
`cerefox-mcp` bin; dropped in v0.5.1 as redundant with `cerefox mcp`.)

---

## Getting Started

> **Full walkthrough**: `docs/guides/quickstart.md` -- zero to first ingested document and connected agent in 15 minutes.
>
> **Upgrading from v0.4.x?** See [`docs/guides/migration-v0.5.md`](docs/guides/migration-v0.5.md) — your existing MCP configs keep working; the new `cerefox` CLI is opt-in.

### Quickstart (npm path — recommended as of v0.5.0)

```bash
# One-line install (detects Bun or installs it, falls back to npm):
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh

# Or direct:
npm install -g @cerefox/memory      # Node ≥ 20
# bun install -g @cerefox/memory    # alternative — faster

cerefox init                         # interactive 5-step setup
cerefox doctor                       # verify the install

# Wire up your MCP client(s) — run the ones that apply to your setup:
cerefox configure-agent --tool claude-code      # Claude Code (~/.claude/mcp.json)
cerefox configure-agent --tool claude-desktop   # Claude Desktop config
# (Cursor / Codex / Gemini land in a future v0.5.x; see migration-v0.5.md
#  for the manual config snippets in the meantime.)
```

That's the path for end users who don't need to hack on Cerefox itself. For
the schema deploy + web UI + ingestion pipeline, see the "Building from
source" section below (Python is still the path for those in v0.5).

### Prerequisites for the npm install path

| Tool | Why | Install |
|---|---|---|
| **Node 20+** or **Bun 1.0+** | Runtime for the `cerefox` bin (includes `cerefox mcp` subcommand for MCP clients) | [nodejs.org](https://nodejs.org/) · [bun.sh](https://bun.sh) |
| A Supabase account | Database + pgvector + Edge Functions (free tier is enough) | [supabase.com](https://supabase.com/) |
| An embedding API key | OpenAI `text-embedding-3-small` (default) or Fireworks AI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

### Building from source / Contributors

For the schema deploy, the web UI, the ingestion pipeline, or contributing
to Cerefox itself:

| Tool | Why | Install |
|---|---|---|
| **Python 3.11+** with [`uv`](https://docs.astral.sh/uv/) | Schema deploy (`scripts/db_deploy.py`), web server (until v0.6), ingestion pipeline (until v0.7) | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| **Node 20+** with `npm` | One-time `npm install && npm run build` to produce the React SPA bundle the web UI serves | [nodejs.org](https://nodejs.org/) or `nvm install 20` |
| **[Bun](https://bun.sh) 1.x** | TypeScript scripts (`scripts/*.ts`), `_shared/` tests, `@cerefox/memory` build | `curl -fsSL https://bun.sh/install \| bash` |
| A Supabase account + embedding API key | Same as above | (same links) |

Full contributor setup in [CONTRIBUTING.md](CONTRIBUTING.md).

### 1. Clone and install

```bash
git clone https://github.com/fstamatelopoulos/cerefox.git
cd cerefox
uv sync
```

### 2. Set up Supabase (free)

1. Sign up at [supabase.com](https://supabase.com) — a GitHub login works fine.
2. Create a new project. Give it a name (e.g. `cerefox`) and set a database password (store it somewhere safe — you'll need it once).
3. On the project creation screen leave the defaults:
   - **Enable Data API** ✅ — required (the Python client uses this)
   - **Enable automatic RLS** — leave unchecked (single-user app, not needed)

### 3. Configure `.env`

```bash
cp .env.example .env
```

Open `.env` and fill in these values:

| Variable | Where to find it |
|---|---|
| `CEREFOX_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `CEREFOX_SUPABASE_KEY` | Supabase → Project Settings → API Keys → **Secret key** (`sb_secret_…`). Legacy `service_role` JWT also works. |
| `CEREFOX_DATABASE_URL` | Supabase → Project Settings → Database → **Connection pooling → Session Pooler** (port `5432`). See notes below. |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `CEREFOX_SUPABASE_ANON_KEY` (only for Edge Functions / MCP / GPT Actions) | Supabase → Project Settings → API Keys → **Legacy → anon** (JWT, `eyJ…`). The new `sb_publishable_…` does **not** work for Edge Function Bearer auth. See [`docs/guides/setup-supabase.md` → Supabase API keys (2026)](docs/guides/setup-supabase.md#supabase-api-keys-2026). |

**`CEREFOX_DATABASE_URL` notes:**
- Use the **Session Pooler** (port `5432`), not the Transaction Pooler (`6543`, no DDL) or the Direct Connection (IPv6-only on free tier).
- The Session Pooler may not be a first-class option in the new "Connect" dialog; either find it under **Connection pooling**, or take the Transaction Pooler URI and change `:6543` → `:5432`.
- The username must include your project ref: `postgres.your-project-ref` — not just `postgres`. Without the suffix Supabase returns "Tenant or user not found".
- Append `?sslmode=require` to enforce TLS.
- Full reference: [`docs/guides/setup-supabase.md` → Connection pooling (2026)](docs/guides/setup-supabase.md#connection-pooling-2026).

### 4. Deploy the schema

```bash
uv run python scripts/db_deploy.py
```

### 5. Deploy the Edge Functions

Edge Functions handle server-side embedding so AI agents never need a local model. Requires the [Supabase CLI](https://supabase.com/docs/guides/cli).

```bash
npx supabase functions deploy cerefox-search
npx supabase functions deploy cerefox-ingest
npx supabase functions deploy cerefox-mcp
```

Set your OpenAI key as a Supabase secret (used by the functions at runtime):

```bash
npx supabase secrets set OPENAI_API_KEY=sk-...your-key...
```

### 6. Build the web UI

The web UI is a React + Vite SPA. Build it once now (and re-run after any frontend change):

```bash
cd frontend
npm install
npm run build
cd ..
```

This produces `frontend/dist/`, which `uv run cerefox web` serves at `/app/`. Skipping this step is the most common "the web UI returns 404" cause.

### 7. Ingest a document and open the web UI

```bash
uv run cerefox ingest my-notes.md --title "My notes"
uv run cerefox web                # → http://localhost:8000
```

**Optional**: ingest the Cerefox docs themselves so AI agents can look up project details:

```bash
# Create a "cerefox" project first, then sync README + all docs/ into it.
uv run cerefox create-project cerefox
uv run python scripts/sync_docs.py
```

Re-run `sync_docs.py` any time after updating documentation to keep the knowledge base current.

**Try with sample data**: the `test-data/` directory contains six diverse markdown documents
you can ingest to experiment with search before adding your own content:

```bash
uv run cerefox ingest-dir test-data/ --recursive
```

---

## Architecture

```
cerefox_documents     cerefox_chunks
─────────────────     ───────────────────────────────
id, title, source     id, document_id, chunk_index
content_hash          heading_path, heading_level
project_id            content, char_count
metadata (JSONB)      embedding_primary (VECTOR 768)
chunk_count           fts (TSVECTOR, generated)
```

Search RPCs (MCP tools): `cerefox_hybrid_search`, `cerefox_fts_search`,
`cerefox_semantic_search`, `cerefox_search_docs`, `cerefox_reconstruct_doc`,
`cerefox_context_expand`, `cerefox_save_note`

---

## Connecting AI agents

**Option 1 — Remote MCP (recommended)** — just a URL, a legacy anon JWT (Supabase → Project Settings → API Keys → **Legacy → anon**, not the new `sb_publishable_…` key — see [setup-supabase.md](docs/guides/setup-supabase.md#supabase-api-keys-2026)), and `npx`:

The `cerefox-mcp` Supabase Edge Function speaks MCP Streamable HTTP. No Python, no local
repo clone — works from any machine with Node.js installed.

```bash
# Claude Code (native HTTP transport)
claude mcp add --transport http cerefox \
  https://<project-ref>.supabase.co/functions/v1/cerefox-mcp \
  --header "Authorization: Bearer <anon-key>"
```

For Claude Desktop, use [`supergateway`](https://www.npmjs.com/package/supergateway) as
a stdio-to-HTTP bridge in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "npx",
      "args": [
        "-y", "supergateway",
        "--streamableHttp", "https://<project-ref>.supabase.co/functions/v1/cerefox-mcp",
        "--header", "Authorization: Bearer <anon-key>"
      ]
    }
  }
}
```

For Cursor, use `url` + `headers.Authorization` in `mcp.json`.

**Option 2 — ChatGPT (web + desktop)** via Custom GPT + GPT Actions (requires ChatGPT Plus):

Create a Custom GPT and add an Action pointing at the Supabase Edge Functions — no local
install, no MCP config, works from both ChatGPT web and desktop. Uses the Supabase anon key
as Bearer auth.

**Option 3 — Local stdio MCP (legacy fallback)** — requires Python + uv + local repo clone:

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "uv",
      "args": ["--directory", "/path/to/cerefox", "run", "cerefox", "mcp"]
    }
  }
}
```

**Option 4 — Shell CLI for local coding agents** — no MCP setup at all:

Modern local coding agents (Claude Code, OpenAI Codex CLI, opencode, OpenClaw, Hermes, …)
have a Bash tool. If you've already got Cerefox checked out and your `.env` configured for
the CLI, you can simply point the agent at the repo path in its system prompt / project
memory, and tell it to read `AGENT_GUIDE.md`. The agent reads and writes Cerefox by
running `uv run cerefox …`. No `.mcp.json`, no `claude mcp add`, no Claude Desktop edit.
Useful when you want one Cerefox checkout to serve any number of local agents in the
same project with zero per-agent configuration.

Full setup for all options: `docs/guides/connect-agents.md`

---

## Documentation

| Guide | Description |
|-------|-------------|
| `docs/guides/quickstart.md` | Zero to first document in 15 minutes |
| `docs/guides/setup-supabase.md` | Supabase project setup |
| `docs/guides/configuration.md` | All configuration options |
| `docs/guides/connect-agents.md` | MCP agent integration |
| `docs/guides/cli.md` | Complete CLI reference (all `cerefox` subcommands) |
| `docs/guides/agent-coordination.md` | Multi-agent coordination patterns and best practices |
| `docs/guides/response-limits.md` | Response size limits: per-path behaviour and tuning |
| `docs/guides/access-paths.md` | All access layers, credentials, and integration paths |
| `docs/guides/setup-local.md` | Local Docker setup |
| `docs/guides/ops-scripts.md` | Backup, restore, migrate, sync docs |
| `docs/guides/setup-cloud-run.md` | Google Cloud Run deployment |
| `docs/guides/operational-cost.md` | Cost breakdown for all deployment options |
| `docs/guides/upgrading.md` | Standard upgrade checklist, version-specific notes |
| `CONTRIBUTING.md` | How to contribute to Cerefox |

---

## License

Apache 2.0 — see LICENSE.
