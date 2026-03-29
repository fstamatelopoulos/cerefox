<p align="center">
  <img src="web/static/cerefox_logo.jpg" alt="Cerefox" width="160">
</p>

# Cerefox

**User-owned shared memory for AI agents.** A persistent, curated knowledge layer that multiple AI tools can read and write, backed by Postgres + pgvector.

[![Apache 2.0 License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://python.org)

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

## Getting Started

> **Full walkthrough**: `docs/guides/quickstart.md` -- zero to first ingested document and connected agent in 15 minutes.
>
> **Upgrading?** If you are upgrading from a previous version, see the [Upgrading Guide](docs/guides/upgrading.md) for migration steps.

### 1. Clone and install

```bash
git clone https://github.com/yourname/cerefox.git
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
| `CEREFOX_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `CEREFOX_SUPABASE_KEY` | Supabase → Settings → API → Secret keys → `default` |
| `CEREFOX_DATABASE_URL` | Supabase → Settings → Database → Connection string → **Session pooler** (port 5432) |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |

**`CEREFOX_DATABASE_URL` notes:**
- Use the **Session pooler** string (port 5432), not the Direct connection or Transaction pooler.
- The username must include your project ref: `postgres.your-project-ref` — not just `postgres`.
- Direct connection is IPv6 only on the free tier. If you get `nodename nor servname provided`, you are on IPv4 — use the Session pooler.
- See `.env.example` for both URL formats with full explanations.

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

### 6. Ingest a document and open the web UI

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

**Option 1 — Remote MCP (recommended)** — just a URL, an anon key, and `npx`:

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

Full setup for all options: `docs/guides/connect-agents.md`

---

## Documentation

| Guide | Description |
|-------|-------------|
| `docs/guides/quickstart.md` | Zero to first document in 15 minutes |
| `docs/guides/setup-supabase.md` | Supabase project setup |
| `docs/guides/configuration.md` | All configuration options |
| `docs/guides/connect-agents.md` | MCP agent integration |
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
