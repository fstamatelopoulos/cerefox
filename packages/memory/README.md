# @cerefox/memory

**User-owned shared memory for AI agents.** The local TypeScript runtime for
[Cerefox](https://github.com/fstamatelopoulos/cerefox) — a persistent,
curated knowledge layer that multiple AI tools can read and write.

> **Cerefox is BYO-storage.** This package is the *client* — the CLI + local
> MCP server + local web UI. The knowledge base itself lives in **your own
> Supabase project** (Postgres + pgvector; free tier works). Installing this
> npm package does **not** give you a working KB on its own; you also need a
> Supabase project + an embedding API key, and a one-time server-side deploy
> from the source repo. **See "Before you install" below.**

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
| `cerefox mcp` | Local stdio MCP server. Drop-in for Claude Code, Cursor, Claude Desktop, Codex CLI, Gemini CLI. Exposes the same 10 MCP tools as the remote `cerefox-mcp` Edge Function. |
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

The server side ships with the source repo, not this npm package. Both halves are required for a working install.

### What you need

| Prerequisite | Why | How |
|---|---|---|
| A **Supabase project** | Hosts Postgres + pgvector + Edge Functions. Free tier is enough for most personal use. | [supabase.com](https://supabase.com) → New project |
| An **embedding API key** | OpenAI `text-embedding-3-small` (default) or Fireworks AI. Pennies/month for typical personal use (see [operational-cost.md](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/operational-cost.md)). | Get an [OpenAI API key](https://platform.openai.com/api-keys). |
| **Node ≥ 20** or **Bun ≥ 1.0** | Runtime for the `cerefox` bin (and the bundled `cerefox mcp` server). | [nodejs.org](https://nodejs.org) · [bun.sh](https://bun.sh). The one-line installer below bootstraps Bun if neither is present. |

### One-time server-side setup (~10 min — clone required)

The schema, RPCs, and Edge Functions ship with the source repo, not this npm package. Clone once, configure, deploy:

```bash
git clone https://github.com/fstamatelopoulos/cerefox.git
cd cerefox && cp .env.example .env       # fill in CEREFOX_SUPABASE_* + OPENAI_API_KEY + CEREFOX_DATABASE_URL
bun install                              # workspace deps for the deploy scripts
bun scripts/db_deploy.ts                 # creates tables, indexes, RPCs in your Supabase
npx supabase functions deploy cerefox-mcp cerefox-search cerefox-ingest \
                              cerefox-metadata cerefox-get-document \
                              cerefox-list-versions cerefox-get-audit-log \
                              cerefox-metadata-search cerefox-list-projects
npx supabase secrets set OPENAI_API_KEY=sk-...
```

Full walkthrough (connection-pooling quirks, Supabase API-key flavors, troubleshooting): [setup-supabase.md](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/setup-supabase.md).

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
> `bun scripts/db_deploy.ts` from a repo clone.

> **Upgrading from the Python `cerefox` CLI?** If you have a working
> `.env` in your repo clone, init detects it and offers to **copy** it to
> `~/.cerefox/.env` so the TS CLI uses the new home while Python keeps
> reading the repo file unchanged. See the migration-v0.5 guide for the
> three-choice prompt. Existing users with no `~/.cerefox/.env` see zero
> behavior change until they opt in.

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

All five writers landed in v0.6. For manual configuration, the canonical MCP
entry is:

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
the 10 MCP tools (`cerefox_search`, `cerefox_ingest`, `cerefox_get_document`,
`cerefox_list_versions`, `cerefox_list_projects`, `cerefox_list_metadata_keys`,
`cerefox_metadata_search`, `cerefox_set_document_projects`,
`cerefox_get_audit_log`, `cerefox_get_help`).

---

## Common commands

```bash
cerefox search "second brain"                       # hybrid (FTS + semantic)
cerefox ingest notes.md --project "Personal"        # add a doc
cerefox list-projects                               # discover projects
cerefox metadata-search --metadata-filter '{"type":"decision-log"}'
cerefox get-audit-log --since 2026-05-01            # immutable history
cerefox doctor                                      # diagnose your install
cerefox upgrade                                     # alias for self-update
```

Run `cerefox --help` for the full command surface (28 subcommands grouped
by category).

---

## Why install the CLI when I already have MCP wired up?

You don't have to. `cerefox mcp` (started as a stdio subprocess by any
MCP client) gives your AI agent full access to the knowledge base on
its own. The rest of the `cerefox` CLI is useful for:

- **One-off shell operations**: search, ingest, list, audit-log.
- **Power-user workflows**: `cerefox ingest-dir ./meeting-notes`,
  `cerefox metadata-search --metadata-filter …`, `cerefox backup`.
- **Setup + diagnostics**: `cerefox init`, `cerefox doctor`,
  `cerefox configure-agent`, `cerefox self-update`.
- **Agents via local Bash tool**: some coding agents prefer running
  `cerefox <subcommand>` from a shell rather than configuring MCP.

---

## Architecture, design, docs

- **Project README + roadmap**: <https://github.com/fstamatelopoulos/cerefox>
- **Architecture overview**: [`CLAUDE.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/CLAUDE.md)
- **Setup guides**: [`docs/guides/`](https://github.com/fstamatelopoulos/cerefox/tree/main/docs/guides)
- **Migration from v0.4.x**: [`docs/guides/migration-v0.5.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/migration-v0.5.md)
- **For AI agents using Cerefox**: [`AGENT_GUIDE.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/AGENT_GUIDE.md), [`AGENT_QUICK_REFERENCE.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/AGENT_QUICK_REFERENCE.md), or run `cerefox docs --list`.
- **Changelog**: [`CHANGELOG.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/CHANGELOG.md)

---

## License

Apache-2.0 — see [`LICENSE`](https://github.com/fstamatelopoulos/cerefox/blob/main/LICENSE) in the repo.

Cerefox is a single-maintainer open-source project. Bug reports and PRs
welcome at [github.com/fstamatelopoulos/cerefox/issues](https://github.com/fstamatelopoulos/cerefox/issues).
