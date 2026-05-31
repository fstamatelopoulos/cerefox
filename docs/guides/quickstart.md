# Quickstart -- Zero to First Document in 5 Minutes

Get Cerefox running on your machine via the npm install path. **No source
clone, no Python required.**

> **Upgrading from an earlier version?** See [`upgrading.md`](upgrading.md)
> for migration steps instead.

---

## Prerequisites

- **Node.js 20+** (`node --version`) or **Bun 1.0+** (`bun --version`)
- A **Supabase account** -- [supabase.com](https://supabase.com) (free tier works). A fresh project is fine — `cerefox server deploy` (Step 2) deploys the schema for you.
- An **OpenAI API key** -- [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

## 1. Install

```bash
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh
```

Detects Bun (or installs it) and falls back to npm. After install,
`cerefox` is on your PATH.

Direct alternatives:
```bash
bun add -g @cerefox/memory       # preferred (faster cold start)
npm install -g @cerefox/memory   # equivalent
```

## 2. First-run setup

```bash
cerefox init        # 5-step interactive setup — prompts for the credentials above
cerefox doctor      # green across the board if everything's wired correctly
```

`cerefox init` validates each entry against the live service before saving,
writes `~/.cerefox/.env` (mode 0600), offers to deploy the schema + RPCs +
Edge Functions to a fresh Supabase project, and optionally ingests the bundled
self-docs into the `_cerefox-self-docs` project so agents can search for
Cerefox usage guidance.

## 3. Deploy the server side (fresh project only)

If `cerefox init` didn't already do it, deploy the schema, RPCs, and Edge
Functions to your Supabase project — straight from the npm-bundled assets, no
source clone:

```bash
cerefox server deploy        # detects fresh vs. existing DB; --dry-run to preview
```

On an existing database this applies pending migrations and re-applies RPCs
in place, so re-run it after upgrading. Detailed walkthrough:
[`setup-supabase.md`](setup-supabase.md).

## 4. Wire up an AI agent

```bash
# Run the commands that apply to your setup:
cerefox configure-agent --tool claude-code      # Claude Code (~/.claude.json)
cerefox configure-agent --tool claude-desktop   # Claude Desktop config
cerefox configure-agent --tool cursor           # Cursor (~/.cursor/mcp.json)
cerefox configure-agent --tool codex            # OpenAI Codex CLI (~/.codex/config.toml)
cerefox configure-agent --tool gemini           # Gemini CLI (~/.gemini/settings.json)
```

Then restart your client:
- **Claude Code**: start a fresh session — running sessions cache the MCP tool list.
- **Claude Desktop**: Cmd+Q to fully quit, then relaunch.
- **Cursor / Codex CLI / Gemini CLI**: reload or restart the client/session.

All five writers configure the local stdio server. For the remote (Edge Function)
HTTP transport, or to edit configs by hand, see [`connect-agents.md`](connect-agents.md).

## 5. Try it

From your AI agent, ask:

> "Use cerefox_search to look for 'cerefox conventions' and tell me what you find."

You should see results from the bundled self-docs.

---

## Contributing instead?

The path above is for **end users** (no clone). If you want to hack on Cerefox,
clone the repo, run `bun install`, and use the contributor scripts
(`bun scripts/db_deploy.ts`, `bun scripts/db_migrate.ts`). `uv` is only needed
for the legacy Python MCP fallback. See [`setup-local.md`](setup-local.md) and
`CONTRIBUTING.md`.

---

## What's next

- **Ingest your notes**: `cerefox document ingest my-notes.md`, or
  `cerefox document ingest-dir ./notes/` (recurses into sub-directories automatically)
- **Search from the CLI**: `cerefox search "your query"`
- **Discover all commands**: `cerefox --help`
- **Run the web UI**: `cerefox web` (TypeScript — Hono backend + React SPA); see [`setup-local.md`](setup-local.md)
- **Connect more AI clients** (Cursor, Codex, ChatGPT GPT Actions, etc.):
  [`connect-agents.md`](connect-agents.md)
- **Configuration reference**: [`configuration.md`](configuration.md)
- **Backup + restore**: [`ops-scripts.md`](ops-scripts.md)

For the agent-facing reference (what tools agents have, how to use them well),
read `AGENT_QUICK_REFERENCE.md` in the repo root — or have your agent run
`cerefox_get_help` from any MCP-connected client.
