# @cerefox/memory

**User-owned shared memory for AI agents.** The local TypeScript runtime for
[Cerefox](https://github.com/fstamatelopoulos/cerefox) — a persistent,
curated knowledge layer that multiple AI tools can read and write, backed by
Postgres + pgvector.

This package contains a single binary, **`cerefox`**:

| Subcommand | What it does |
|---|---|
| `cerefox <command>` | CLI — search, ingest, list, version-history, audit-log, lifecycle (`init`, `doctor`, `configure-agent`, `self-update`). Callable from any directory. |
| `cerefox mcp` | Local stdio MCP server. Drop-in for Claude Code, Cursor, Claude Desktop, Codex CLI, Gemini CLI. Exposes the same 10 MCP tools as the remote `cerefox-mcp` Edge Function. |

> **What this package isn't:** the source of truth for Cerefox's architecture
> or docs. Those live in the [GitHub repo](https://github.com/fstamatelopoulos/cerefox).
> This README is the npm landing card.

---

## Install

```bash
# One-line install (recommended on a fresh machine):
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh

# Direct (any of these):
bun install -g @cerefox/memory
npm install -g @cerefox/memory
pnpm add -g @cerefox/memory
yarn global add @cerefox/memory
```

Runtime requirements: **Node ≥ 20** or **Bun ≥ 1.0**.

---

## First-run setup

```bash
cerefox init        # 5-step interactive bootstrap (Supabase, OpenAI, identity)
cerefox doctor      # verify everything reaches
```

Cerefox needs:

- A **Supabase project** (free tier works) — see
  [`docs/guides/setup-supabase.md`](https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/setup-supabase.md).
- An **OpenAI API key** for embeddings (or Fireworks AI as an alternative).

`cerefox init` walks you through both.

---

## Connect an AI agent

```bash
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
