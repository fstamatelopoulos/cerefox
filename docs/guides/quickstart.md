# Quickstart -- Zero to First Document

Get Cerefox running on your machine via the npm install path (the **cloud /
Supabase** backend). **No source clone required.** Once you have a Supabase
project (the one prerequisite — provisioning a free one takes a few minutes),
the Cerefox install and setup below takes ~15 minutes.

> **Upgrading from an earlier version?** See [`upgrading.md`](upgrading.md)
> for migration steps instead.

> **Want no cloud at all?** Cerefox also runs **fully local** — one Docker
> container, no Supabase account, no Node/Bun on the host. See
> [`setup-local.md`](setup-local.md). This quickstart covers the hosted-Supabase
> path.

---

## Prerequisites

- **Node.js 20+** (`node --version`) or **Bun 1.0+** (`bun --version`)
- A **Supabase account** -- [supabase.com](https://supabase.com) (free tier works). A fresh project is fine — `cerefox server deploy` (Step 2) deploys the schema for you.
- An **OpenAI API key** -- [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

## 0. Create a Supabase project

Cerefox stores everything in your own Supabase (Postgres + pgvector), so create
a free project first — provisioning takes a few minutes:

1. Sign up / log in at [supabase.com](https://supabase.com) and create a new project.
2. Keep its **Project URL**, **API keys**, and **database password** handy —
   `cerefox init` (Step 2) prompts for these.

A fresh, empty project is all you need; `cerefox init` / `cerefox server deploy`
deploy the schema, RPCs, and Edge Functions for you. Full walkthrough (keys,
where to find them, what each is for): [`setup-supabase.md`](setup-supabase.md).

---

## 1. Install

```bash
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh
```

Uses Bun if it's already installed, otherwise npm (Node ≥ 20); if neither is
present, it bootstraps Bun. After install, `cerefox` is on your PATH.

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

## 3b. Generate the Edge Function access token

The Edge Functions authenticate callers with a **Cerefox access token** and reject
anyone without it, so mint one now:

```bash
cerefox token generate
```

This creates a `cfx_pat_…` token, sets it as the `CEREFOX_ACCESS_TOKENS` secret on
Supabase, and writes `CEREFOX_ACCESS_TOKEN` into your `.env` (so `cerefox doctor`,
your tools, and any remote client can use it). It prints the token **once** — store
it. You only need to paste it somewhere by hand if you connect a **Custom GPT**
(into the Action's Authentication → API Key) or a **remote HTTP MCP** client; the
local MCP and cloud Claude (OAuth) don't use it. Lose it → `cerefox token rotate`.
Run `cerefox doctor` again — the "edge functions" check should now be green.

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
for the legacy Python MCP fallback. See [`CONTRIBUTING.md`](../../CONTRIBUTING.md).
(Want a no-cloud install instead? That's the self-hosted Docker backend —
[`setup-local.md`](setup-local.md).)

---

## What's next

- **Ingest your notes**: `cerefox document ingest my-notes.md`, or
  `cerefox document ingest-dir ./notes/` (recurses into sub-directories automatically)
- **Search from the CLI**: `cerefox search "your query"`
- **Discover all commands**: `cerefox --help`
- **Run the web UI**: `cerefox web` (TypeScript — Hono backend + React SPA); see [`cli.md`](cli.md)
- **Connect more AI clients** (Cursor, Codex, ChatGPT GPT Actions, etc.):
  [`connect-agents.md`](connect-agents.md)
- **Configuration reference**: [`configuration.md`](configuration.md)
- **Backup + restore**: [`ops-scripts.md`](ops-scripts.md)

For the agent-facing reference (what tools agents have, how to use them well),
read `AGENT_QUICK_REFERENCE.md` in the repo root — or have your agent run
`cerefox_get_help` from any MCP-connected client.
