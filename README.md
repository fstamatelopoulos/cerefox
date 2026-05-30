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
| **Local MCP server** | `cerefox mcp` stdio server (TypeScript, from `@cerefox/memory`) -- local alternative with zero Edge Function usage, lower latency, and offline support; `npm install -g @cerefox/memory`. (A frozen Python MCP server also ships for repo-clone users: `uv run cerefox mcp`.) |
| **Web UI** | React + TypeScript SPA (Mantine UI) at `/app/`; Hono (TypeScript) JSON API backend served by `cerefox web`; Markdown viewer, search with 4 modes, document editing, project management |
| **Markdown-first ingest** | `.md` / `.txt` (Markdown is the storage format; PDF/DOCX conversion was dropped in v0.7 — convert upstream) |
| **Batch ingest** | `cerefox document ingest-dir` recurses directories |
| **Deduplication** | SHA-256 content hash; re-ingesting the same file is a no-op |
| **Backup and restore** | JSON snapshots, optional git commit |
| **Small-to-big retrieval** | `cerefox_context_expand` RPC returns chunk neighbours for richer context |
| **Audit log** | Immutable, append-only log of all write operations (create, update, delete, status change). Author attribution with `author_type` ('user' or 'agent'). Browsable via web UI, queryable via MCP tool and Edge Function |
| **Review status** | Schema-level `review_status` on documents (`approved` / `pending_review`). Auto-transitions based on author_type. Filterable on search |
| **Version governance** | Version archival (protect specific versions from cleanup), configurable retention (`CEREFOX_VERSION_CLEANUP_ENABLED`), version diff viewer |
| **Usage tracking** | Opt-in logging of all operations (reads and writes) across all access paths. Tracks operation type, access path (remote-mcp, local-mcp, edge-function, webapp, cli), requestor identity, query text, and result count. Controlled via `cerefox config set usage_tracking_enabled true/false` -- no redeploy needed |
| **Analytics dashboard** | `/app/analytics` -- 7 interactive charts: calls per day, access path breakdown, top documents, top readers, operations donut, reader word cloud, and reader-to-document access pattern visualization (HEB). Date range + project + path filters. CSV export. |

---

## Project status

Cerefox is a single-maintainer open-source project, at **v0.9.0** and wrapping up
its **"Polish & Distribution" arc** — the work that takes it from "runnable from a
git clone" to "installable like any other modern CLI" (v0.8 shipped the
production-ready installer + `cerefox server deploy`; v0.9 hardens the CLI surface
before the v1.0 contract). Highlights of what's already shipped (full history in
[`CHANGELOG.md`](CHANGELOG.md)):

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
| v0.5.0 | TS CLI | `cerefox` binary added to `@cerefox/memory` (same package, growing surface) — callable from any directory, no Python install needed · 6 new lifecycle commands (`init`, `doctor`, `status`, `configure-agent`, `self-update`, `sync-self-docs`) · automatic self-doc ingest (Layer 2 of MCP discoverability) · tab completion for bash/zsh/fish · documented exit codes · Python CLI deprecated (functional through v0.7) |
| v0.6.0 | TS web server | FastAPI → Hono on Bun · all `/api/v1/*` endpoints + bundled SPA served by `cerefox web` from the same `@cerefox/memory` package · `configure-agent` adds Cursor + Codex + Gemini writers |
| **v0.7.0** (current) | TS ingestion pipeline | Chunking + embedding orchestration + version snapshotting move to TS · `cerefox document ingest` / `ingest-dir` / `reindex` use the in-process pipeline (no Edge Function round-trip) · PDF/DOCX support dropped · `scripts/db_deploy.ts` + `db_migrate.ts` ported · Python web prints a deprecation banner at startup; Python MCP server unchanged |
| v0.8.0 – v0.9.0 | Python retirement | Deprecation banners → removal (MCP server + CLI husks survive through v0.9; pytest as a test runner retires) |
| **v1.0.0** | Stability commitment | Strict SemVer becomes binding; long-lived API contract |

Until v1.0.0 the SemVer policy in [`CONTRIBUTING.md`](CONTRIBUTING.md) is
aspirational — breaking changes can land in minor versions when there's a good
reason. After v1.0.0 it's binding.

**The npm install path is complete:** the entire runtime surface — CLI, MCP,
web server, ingestion pipeline, *and* server-side deploy (schema + RPCs + Edge
Functions via `cerefox server deploy`) — ships in `@cerefox/memory` with no
Python and no repo clone required. End users install via the one-liner below or
`npm install -g @cerefox/memory`. The Bun-run `scripts/*.ts` (db_deploy,
db_migrate, sync_docs, …) remain for contributors working from a clone — they
duplicate what the CLI does, not capabilities only available from source.

---

## Getting Started

> **Upgrading to v0.9?** The CLI verbs were renamed to a resource-verb shape
> (`cerefox get-doc X` → `cerefox document get X`; old names still run but
> redirect) and the Python CLI/web were retired to husks. See
> [`docs/guides/migration-v0.9.md`](docs/guides/migration-v0.9.md).

Cerefox has **two install paths**. Pick the one that fits you — both are
first-class and kept in sync.

### Path A — I just want to *use* Cerefox (no repo clone)

Everything is the `cerefox` command from the [`@cerefox/memory`](https://www.npmjs.com/package/@cerefox/memory)
npm package. **No `git clone`, no Python, no build, no `scripts/`.** The whole
runtime — CLI, MCP server, web UI, ingestion pipeline, *and* schema + Edge
Function deploy — ships in that one package.

```bash
# 1. Install (one-liner; detects Bun, falls back to npm):
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh
#    or: npm install -g @cerefox/memory     (Node ≥ 20)

# 2. Configure + stand up the server side (against your own Supabase project):
cerefox init             # interactive setup: Supabase URL/keys, embedding key
cerefox server deploy    # schema + RPCs + all 9 Edge Functions, from the npm bundle
cerefox doctor           # verify everything is wired up

# 3. Wire up your AI agent(s) — run the ones that apply:
cerefox configure-agent --tool claude-code      # also: claude-desktop | cursor | codex | gemini

# 4. Use it:
cerefox document ingest my-notes.md --title "My notes"
cerefox search "what did I decide about auth?"
cerefox web              # web UI → http://localhost:8000/app/
```

**Prerequisites:** Node 20+ or Bun 1.0+ · a Supabase account (free tier is
enough) · an embedding API key (OpenAI `text-embedding-3-small` by default, or
Fireworks AI).

**Try it with sample data:** `cerefox document ingest-dir test-data/ --recursive`
(the repo's `test-data/` has six diverse markdown docs — or point it at any
folder of your own `.md` files).

> **Full end-user walkthrough:** [`docs/guides/quickstart.md`](docs/guides/quickstart.md)
> — zero to first ingested document and a connected agent in ~15 minutes.
> Supabase specifics (API keys, connection pooling) are in
> [`docs/guides/setup-supabase.md`](docs/guides/setup-supabase.md).

### Path B — I want to *hack on* Cerefox (run from source)

Clone the repo and run from source. `bun` drives everything; `uv` is only for
the legacy Python MCP fallback.

```bash
git clone https://github.com/fstamatelopoulos/cerefox.git && cd cerefox
bun install                  # workspace deps: root + packages/memory + frontend
uv sync                      # OPTIONAL — only for the legacy `uv run cerefox mcp` fallback
cp .env.example .env         # fill in Supabase URL/keys + embedding key

bun scripts/db_deploy.ts     # schema + RPCs  (--dry-run to preview · --reset to wipe first)
npx supabase functions deploy   # Edge Functions (or just use `cerefox server deploy`)

cd frontend && bun run build && cd ..   # build the SPA `cerefox web` serves at /app/
bun test                     # run the suite (root + packages/memory + _shared)
```

Full contributor setup, conventions, and the test matrix are in
[`CONTRIBUTING.md`](CONTRIBUTING.md) and the contributor section of
[`docs/guides/quickstart.md`](docs/guides/quickstart.md).

> **Python is legacy.** As of v0.9 the entire runtime (CLI, MCP, web,
> ingestion) is TypeScript in `@cerefox/memory`. The only surviving Python is
> `uv run cerefox mcp` — a frozen, offline / no-npm MCP fallback for repo-clone
> users. It is unmaintained and slated for removal; everything else Python is a
> husk that redirects to the TS CLI. See
> [`docs/guides/migration-v0.9.md`](docs/guides/migration-v0.9.md).

---

## Architecture

```
cerefox_documents     cerefox_chunks
─────────────────     ───────────────────────────────
id, title, source     id, document_id, chunk_index
content_hash          heading_path, heading_level
project_id            content, char_count
metadata (JSONB)      embedding_primary (VECTOR 768)
chunk_count           fts (TSVECTOR, title-boosted)
```

Search RPCs (MCP tools): `cerefox_hybrid_search`, `cerefox_fts_search`,
`cerefox_semantic_search`, `cerefox_search_docs`, `cerefox_reconstruct_doc`,
`cerefox_context_expand`, `cerefox_save_note`

---

## Connecting AI agents

The fastest path is `cerefox configure-agent --tool <client>` — it writes the
right config for Claude Code, Claude Desktop, Cursor, Codex, or Gemini. There
are four ways an agent can reach Cerefox:

**1 — Remote MCP (recommended).** The `cerefox-mcp` Edge Function speaks MCP
Streamable HTTP. Just a URL + a legacy anon JWT (Supabase → API Keys →
**Legacy → anon**, *not* the new `sb_publishable_…` key — see
[setup-supabase.md](docs/guides/setup-supabase.md#supabase-api-keys-2026)). No
local install:

```bash
claude mcp add --transport http cerefox \
  https://<project-ref>.supabase.co/functions/v1/cerefox-mcp \
  --header "Authorization: Bearer <anon-key>"
```

**2 — Local stdio MCP.** `cerefox mcp` runs the same 10 tools in-process — lower
latency, no per-call Edge Function billing. `configure-agent` wires it up, or
point your client at `command: "cerefox", args: ["mcp"]`.

**3 — ChatGPT.** Custom GPT + GPT Actions pointing at the Edge Functions
(requires ChatGPT Plus). Paste the OpenAPI block from
[`connect-agents.md`](docs/guides/connect-agents.md).

**4 — Shell CLI.** Local coding agents with a Bash tool (Claude Code, Codex,
opencode, …) can read and write Cerefox by running the installed `cerefox`
command directly — no MCP config at all. Point the agent at
[`AGENT_GUIDE.md`](AGENT_GUIDE.md) and let it use `cerefox search` /
`cerefox document ingest`.

Full setup for every client — plus a manual per-client config appendix for when
`configure-agent` can't reach a tool — is in
[`docs/guides/connect-agents.md`](docs/guides/connect-agents.md).

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
| `docs/guides/migration-v0.9.md` | v0.9 CLI verb rename + Python retirement |
| `AGENT_GUIDE.md` | Reference for AI agents using Cerefox tools |
| `CONTRIBUTING.md` | How to contribute to Cerefox |

---

## License

Apache 2.0 — see LICENSE.
