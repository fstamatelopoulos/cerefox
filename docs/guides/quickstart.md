# Quickstart -- Zero to First Document in 5 Minutes

Get Cerefox running on your machine via the npm install path. **No source
clone, no Python required.**

> **Upgrading from an earlier version?** See [`upgrading.md`](upgrading.md)
> for migration steps instead.

---

## Prerequisites

- **Node.js 20+** (`node --version`) or **Bun 1.0+** (`bun --version`)
- A **Supabase account** -- [supabase.com](https://supabase.com) (free tier works) -- with the Cerefox schema deployed (see [Note on schema deploy](#note-on-schema-deploy) below)
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
writes `~/.cerefox/.env` (mode 0600), and optionally ingests the bundled
self-docs into the `_cerefox-self-docs` project so agents can search for
Cerefox usage guidance.

## 3. Wire up an AI agent

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

## 4. Try it

From your AI agent, ask:

> "Use cerefox_search to look for 'cerefox conventions' and tell me what you find."

You should see results from the bundled self-docs.

---

## Note on schema deploy

If your Supabase project is **brand new**, the Cerefox schema needs to be
deployed once before the CLI works. Until v0.6 ports the schema deploy to
TypeScript, this is the one step that still requires the source-checkout
path:

```bash
git clone https://github.com/fstamatelopoulos/cerefox.git && cd cerefox
uv sync
# Add CEREFOX_DATABASE_URL to your .env, then:
uv run python scripts/db_deploy.py
```

Detailed walkthrough: [`setup-supabase.md`](setup-supabase.md).
After v0.6.0, `cerefox init` will offer to do this for you.

---

## What's next

- **Ingest your notes**: `cerefox ingest my-notes.md`, or
  `cerefox ingest-dir ./notes/ --recursive`
- **Search from the CLI**: `cerefox search "your query"`
- **Discover all commands**: `cerefox --help`
- **Run the web UI** (Python-only until v0.6): [`setup-local.md`](setup-local.md)
- **Connect more AI clients** (Cursor, Codex, ChatGPT GPT Actions, etc.):
  [`connect-agents.md`](connect-agents.md)
- **Configuration reference**: [`configuration.md`](configuration.md)
- **Backup + restore**: [`ops-scripts.md`](ops-scripts.md)

For the agent-facing reference (what tools agents have, how to use them well),
read `AGENT_QUICK_REFERENCE.md` in the repo root — or have your agent run
`cerefox_get_help` from any MCP-connected client.
