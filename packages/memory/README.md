# @cerefox/memory

**User-owned shared memory for AI agents.** The local TypeScript runtime for
[Cerefox](https://github.com/fstamatelopoulos/cerefox) — a persistent,
curated knowledge layer that multiple AI tools can read and write.

> **Cerefox is BYO-storage.** This package is the *client* — the CLI + local
> MCP server + local web UI. The knowledge base itself lives in **your own
> Supabase project** (Postgres + pgvector; free tier works). Installing this
> npm package does **not** give you a working KB on its own; you also need a
> Supabase project + an embedding API key, and a one-time server-side deploy
> (`cerefox server deploy` — no repo clone needed). **See "Before you install" below.**
>
> Prefer no cloud at all? There is also **Cerefox Local**: the same stack in a
> single Docker container on your machine (this npm package is not needed for
> it). See [setup-local.md](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/setup-local.md).

**Why cloud-backed?** Cerefox is designed as a *cloud-backed* memory layer so
the same knowledge is reachable from every agent you run — Claude Code on
your laptop, Cursor on a second machine, ChatGPT on the web, a script in CI.
Postgres + pgvector deliver hybrid (semantic + full-text) search across that
shared memory; Supabase provides the always-on endpoint that makes "same
memory, any device, any agent" work. You own the data and the endpoint; this
package bundles **everything you run locally** — CLI, MCP server, web UI,
and the in-process ingestion + retrieval pipeline — that talks to it.

This package contains a single binary, **`cerefox`**:

| Subcommand | What it does |
|---|---|
| `cerefox <command>` | CLI — search, ingest, list, version-history, audit-log, lifecycle (`init`, `doctor`, `configure-agent`, `self-update`). Callable from any directory. |
| `cerefox mcp` | Local stdio MCP server. Drop-in for Claude Code, Cursor, Claude Desktop, Codex CLI, Gemini CLI. Exposes the same 15 core MCP tools as the remote `cerefox-mcp` Edge Function, plus 4 document-relation tools that stay hidden until enabled. |
| `cerefox web` | Local web app at `http://localhost:8000` — React UI for browsing, searching, editing, and ingesting documents. Backed by an in-process Hono server that exposes the same `/api/v1/*` REST surface as the bundled Edge Functions. |

> **What this package isn't:** the source of truth for Cerefox's architecture
> or docs. Those live in the [GitHub repo](https://github.com/fstamatelopoulos/cerefox).
> This README is the npm landing card.

---

## Before you install

Cerefox is a self-hosted memory layer with two halves you set up independently:

**Server side** (lives in your Supabase project, runs ~24/7):
- Postgres schema + RPCs (search, ingest, audit log, version history)
- Edge Functions (server-side embedding, remote `cerefox-mcp` MCP server, Custom-GPT actions)

**Client side** (this npm package, runs on your machine):
- `cerefox` CLI + `cerefox mcp` (local stdio MCP) + `cerefox web` (local UI at `http://localhost:8000`)

You deploy the server side with this package's CLI — `cerefox server deploy` stands up the schema, RPCs, and all 9 Edge Functions from bundled assets (no repo clone). Both halves are required for a working install.

### What you need

| Prerequisite | Why | How |
|---|---|---|
| A **Supabase project** | Hosts Postgres + pgvector + Edge Functions. Free tier is enough for most personal use. | [supabase.com](https://supabase.com) → New project |
| An **embedding API key** | OpenAI `text-embedding-3-small` (the cloud backend's embedder; Cerefox Local can instead run a fully-offline local model). Pennies/month for typical personal use (see [operational-cost.md](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/operational-cost.md)). | Get an [OpenAI API key](https://platform.openai.com/api-keys). |
| **Node ≥ 20** or **Bun ≥ 1.0** | Runtime for the `cerefox` bin (and the bundled `cerefox mcp` server). | [nodejs.org](https://nodejs.org) · [bun.sh](https://bun.sh). The one-line installer below bootstraps Bun if neither is present. |

### One-time server-side setup (~10 min — no clone needed)

The CLI stands up the whole server side — schema, RPCs, and all 9 Edge
Functions — from bundled assets:

```bash
cerefox init             # enter your Supabase URL/keys + embedding key
cerefox server deploy    # schema + RPCs + Edge Functions
```

Details (Supabase login/linking, connection-pooling quirks, API-key flavors,
troubleshooting, and the contributor clone-and-deploy path) live in the
[quickstart](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/quickstart.md)
and [setup-supabase.md](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/setup-supabase.md).

If you don't yet have Supabase + an OpenAI key, the [Cerefox
quickstart](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/quickstart.md)
walks through the whole setup in one place.

---

## Install

Once you have the prerequisites above in hand:

```bash
# One-line install (recommended on a fresh machine; bootstraps Bun if needed):
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh

# Or direct (any of these):
bun install -g @cerefox/memory
npm install -g @cerefox/memory
pnpm add -g @cerefox/memory
yarn global add @cerefox/memory
```

---

## First-run setup

```bash
cerefox init        # 5-step interactive bootstrap (asks for Supabase URL,
                    # Supabase key, OpenAI key, optional Postgres URL, identity)
cerefox doctor      # end-to-end health check against the live services
```

`cerefox init` prompts for the credentials you collected above, validates them
against the live services, writes `~/.cerefox/.env` (chmod 0600), and
optionally wires up an MCP client. **It does not create the Supabase project
for you** — you'll be asked for the URL + key, so make sure those are
already provisioned (see "Before you install").

> **Already ran the server-side setup above?** Then your schema is in place and
> `cerefox init` only needs the URL + keys. If you skipped that step,
> `cerefox doctor` will flag it and point you back to
> `cerefox server deploy`.

> **Have a `.env` from an earlier install (e.g. a repo clone)?** `cerefox init`
> detects it and offers to copy it to `~/.cerefox/.env` — the env-var names are
> identical, no rewrite needed. (The Python implementation was fully removed at
> v1.0.0; see the [migration guide](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/migration-1.0.md).)

---

## Connect an AI agent

```bash
# Run the configure-agent commands that apply to your setup:
cerefox configure-agent --tool claude-code          # ~/.claude.json via `claude mcp add`
cerefox configure-agent --tool claude-desktop       # Claude Desktop config
cerefox configure-agent --tool cursor               # ~/.cursor/mcp.json
cerefox configure-agent --tool codex                # ~/.codex/config.toml
cerefox configure-agent --tool gemini               # ~/.gemini/settings.json
```

For manual configuration (any other MCP client), the canonical entry is:

```json
{
  "mcpServers": {
    "cerefox": {
      "command": "npx",
      "args": ["-y", "--package=@cerefox/memory", "cerefox", "mcp"]
    }
  }
}
```

Once configured, any of these clients can search + write your Cerefox KB via
the 15 core MCP tools (`cerefox_search`, `cerefox_ingest`, `cerefox_insert`,
`cerefox_edit`, `cerefox_delete_document`, `cerefox_restore_document`,
`cerefox_get_document`,
`cerefox_list_versions`,
`cerefox_list_projects`, `cerefox_list_metadata_keys`,
`cerefox_metadata_search`, `cerefox_set_document_projects`,
`cerefox_set_document_metadata`,
`cerefox_get_audit_log`, `cerefox_get_help`).

`cerefox_insert` and `cerefox_edit` change part of a document without resending
it — the agent sends what changed and the server assembles the result.

Four more tools (`cerefox_set_relation`, `cerefox_delete_relation`,
`cerefox_get_relations`, `cerefox_get_neighbors`) build a typed graph between
documents. They ship **dormant**: hidden from every agent until you opt in with
`cerefox config set relations_enabled true`. Toggling changes visibility only,
never your data.

---

## Common commands

```bash
cerefox search "second brain"                          # hybrid (FTS + semantic)
cerefox document ingest notes.md --project "Personal"  # add a doc
cerefox document get <id> --section "## Heading"       # read one section
cerefox document set-metadata <id> --set-meta k='"v"'  # metadata-only write
cerefox document delete <id>                           # soft-delete (restore undoes it)
cerefox document dead-links                            # sweep for dead document links
cerefox project list                                   # discover projects
cerefox metadata search --metadata-filter '{"type":"decision-log"}'
cerefox audit list --since 2026-05-01                  # immutable history
cerefox doctor                                         # diagnose your install
cerefox upgrade                                        # alias for self-update
```

Run `cerefox --help` for the full command surface — a resource-verb shape
(`document …`, `project …`, `metadata …`, `server …`) plus flat commands
like `search` and the lifecycle verbs.

---

## Why install the CLI when I already have MCP wired up?

You don't have to. `cerefox mcp` (started as a stdio subprocess by any
MCP client) gives your AI agent full access to the knowledge base on
its own. The rest of the `cerefox` CLI is useful for:

- **One-off shell operations**: search, ingest, list, audit-log.
- **Power-user workflows**: `cerefox document ingest-dir ./meeting-notes`,
  `cerefox metadata search --metadata-filter …`, `cerefox backup create`.
- **Setup + diagnostics**: `cerefox init`, `cerefox doctor`,
  `cerefox configure-agent`, `cerefox self-update`.
- **Agents via local Bash tool**: some coding agents prefer running
  `cerefox <subcommand>` from a shell rather than configuring MCP.

---

## Architecture, design, docs

- **Project README + roadmap**: <https://github.com/fstamatelopoulos/cerefox>
- **Architecture overview**: [`CLAUDE.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/CLAUDE.md)
- **Setup guides**: [`docs/guides/`](https://github.com/fstamatelopoulos/cerefox/tree/main/docs/guides)
- **Upgrading**: [`docs/guides/upgrading.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/upgrading.md)
- **For AI agents using Cerefox**: [`AGENT_GUIDE.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/AGENT_GUIDE.md), [`AGENT_QUICK_REFERENCE.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/AGENT_QUICK_REFERENCE.md), or run `cerefox guides list`.
- **Changelog**: [`CHANGELOG.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/CHANGELOG.md)

---

## License

Apache-2.0 — see [`LICENSE`](https://github.com/fstamatelopoulos/cerefox/blob/main/LICENSE) in the repo.

Cerefox is a single-maintainer open-source project. Bug reports and PRs
welcome at [github.com/fstamatelopoulos/cerefox/issues](https://github.com/fstamatelopoulos/cerefox/issues).
