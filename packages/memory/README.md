# @cerefox/memory

**User-owned shared memory for AI agents.** The local TypeScript runtime for
[Cerefox](https://github.com/fstamatelopoulos/cerefox) — a persistent,
curated knowledge layer that multiple AI tools can read and write.

> **Cerefox is BYO-storage.** This package is the *client* — the CLI + local
> MCP server. The knowledge base itself lives in **your own Supabase project**
> (Postgres + pgvector; free tier works). Installing this npm package does
> **not** give you a working KB on its own; you also need a Supabase project +
> an embedding API key. The first-run `cerefox init` wires everything together
> in ~2 minutes once you have those in hand. **See "Before you install"
> below.**

This package contains a single binary, **`cerefox`**:

| Subcommand | What it does |
|---|---|
| `cerefox <command>` | CLI — search, ingest, list, version-history, audit-log, lifecycle (`init`, `doctor`, `configure-agent`, `self-update`). Callable from any directory. |
| `cerefox mcp` | Local stdio MCP server. Drop-in for Claude Code, Cursor, Claude Desktop, Codex CLI, Gemini CLI. Exposes the same 10 MCP tools as the remote `cerefox-mcp` Edge Function. |

> **What this package isn't:** the source of truth for Cerefox's architecture
> or docs. Those live in the [GitHub repo](https://github.com/fstamatelopoulos/cerefox).
> This README is the npm landing card.

---

## Before you install

Cerefox is a self-hosted memory layer. To use it you need three things, none
of which this npm package brings with it:

| Prerequisite | Why | How |
|---|---|---|
| A **Supabase project** | The knowledge base (documents + chunks + embeddings) lives in your Supabase project's Postgres database, with pgvector for semantic search. Free tier is enough for most personal use. | Sign up at [supabase.com](https://supabase.com), create a project, then follow the [Supabase setup guide](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/setup-supabase.md) — deploy the Cerefox schema (one script), then deploy the Edge Functions (one command). Estimate: 10–15 minutes the first time. |
| An **embedding API key** | Cerefox embeds your documents for semantic search. OpenAI's `text-embedding-3-small` is the default; Fireworks AI is an alternative. | Get an [OpenAI API key](https://platform.openai.com/api-keys) — costs are pennies/month for typical personal use (see [operational-cost.md](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/operational-cost.md)). |
| **Node ≥ 20** or **Bun ≥ 1.0** | Runtime for the `cerefox` bin (and the bundled `cerefox mcp` server). | [nodejs.org](https://nodejs.org) or [bun.sh](https://bun.sh). The one-line installer below bootstraps Bun for you if neither is present. |

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
cerefox doctor      # verify everything reaches
```

`cerefox init` prompts for the credentials you collected above, validates them
against the live services, writes `~/.cerefox/.env` (chmod 0600), and
optionally wires up an MCP client. **It does not create the Supabase project
for you** — you'll be asked for the URL + key, so make sure those are
already provisioned (see "Before you install").

> **Schema deploy (v0.5):** if your Supabase project is fresh, `cerefox init`
> tells you to run `uv run python scripts/db_deploy.py` from a Cerefox repo
> clone to install the schema. This last manual step goes away in v0.6 when
> the deploy logic is ported to the TS CLI. For now, the setup-supabase
> guide walks through it.

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
cerefox configure-agent --tool claude-code          # writes ~/.claude/mcp.json
cerefox configure-agent --tool claude-desktop       # writes Claude Desktop config
```

Phase 1 supports Claude Code + Claude Desktop. Cursor, Codex CLI, and Gemini
CLI ship in a follow-up. For manual configuration, the canonical MCP entry
is:

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
- **Agents via local Bash tool** (Path C in the architecture): some
  coding agents prefer running `cerefox <subcommand>` over a Bash tool
  rather than configuring MCP.

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
