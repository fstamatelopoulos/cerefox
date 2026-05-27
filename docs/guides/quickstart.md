# Quickstart -- Zero to First Document in 15 Minutes

Get Cerefox running locally and ingest your first document.

> **Upgrading from a previous version?** See the [Upgrading Guide](upgrading.md) for migration steps instead.

## Two install paths

| You want | Read this section | Why |
|---|---|---|
| **Use Cerefox as an MCP server / CLI** | "Path A — npm install" below (fastest) | One install, callable from any directory. No Python needed. Recommended for end users since v0.5. |
| **Contribute to Cerefox, run the web UI, deploy schema** | "Path B — source checkout" below | Full source: schema deploy, web UI, ingestion pipeline. Required for contributors and for the web UI (until v0.6). |

You'll need a Supabase project (free tier works) and an OpenAI API key for either
path — those go into `.env`. The npm install asks for them interactively via
`cerefox init`; the source checkout has you write them into a `.env` file
yourself.

---

## Path A — npm install (fastest, 5 min total)

For end users who just want the Cerefox CLI + MCP server on their machine.

### A.1 Prerequisites
- Node.js 20+ (`node --version`) or Bun 1.0+ (`bun --version`)
- A Supabase account -- [supabase.com](https://supabase.com) (free tier works)
- An OpenAI API key -- [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
- **Schema must be deployed** to your Supabase. Until v0.6 ports the schema
  deploy to TypeScript, this still requires the source checkout (Path B) once,
  or someone else who has the source checkout to deploy it for you.

### A.2 Install
```bash
# One-line install (detects Bun or installs it, falls back to npm):
curl -fsSL https://github.com/fstamatelopoulos/cerefox/releases/latest/download/install.sh | sh

# Or direct:
bun add -g @cerefox/memory       # preferred
# npm install -g @cerefox/memory # alternative
```

### A.3 First-run setup
```bash
cerefox init        # 5-step interactive setup
cerefox doctor      # verify the install
```

### A.4 Wire up your MCP client
```bash
# Run the ones that apply:
cerefox configure-agent --tool claude-code
cerefox configure-agent --tool claude-desktop
```

`--tool claude-code` shells out to Claude Code's own `claude mcp add --scope user`
to register the server (Claude Code knows where to store the config).
`--tool claude-desktop` writes the JSON config file directly.

Then restart your MCP client. **Path A users skip ahead to "[Connect an AI agent](#8-connect-an-ai-agent-optional-5-min)" (step 8) for the verification prompt.** Steps 3–7
below are Path B-only (setting up `.env` by hand, deploying the schema, the web UI).

---

## Path B — source checkout (contributors, schema deploy, web UI)

For anyone hacking on Cerefox itself, deploying the schema for the first time,
or running the web UI.

### B.1 Prerequisites

- Python 3.11+ (`python3 --version`)
- Node.js 18+ and npm (`node --version`)
- `uv` package manager (`pip install uv`)
- A Supabase account -- [supabase.com](https://supabase.com) (free tier works)
- An OpenAI API key -- [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

### B.2 Install Cerefox (2 min)

```bash
git clone https://github.com/fstamatelopoulos/cerefox.git
cd cerefox
uv sync
```

> No heavy ML model downloads needed -- embeddings are handled by the OpenAI API.

---

## 3. Set up Supabase (5 min)

1. Create a new Supabase project at [app.supabase.com](https://app.supabase.com).
2. Go to **Project Settings → API → Project URL** and copy it. Also note your project ref (the slug in the URL, e.g. `abcd1234`).
3. Go to **Project Settings → API Keys** and copy the **Secret key** (`sb_secret_…`). The legacy `service_role` JWT also works if you prefer; either goes into `CEREFOX_SUPABASE_KEY`. See [`setup-supabase.md` → Supabase API keys (2026)](setup-supabase.md#supabase-api-keys-2026) for the full key story (including why the anon key, if you ever need it, must currently stay as the legacy JWT — `sb_publishable_…` does not work for Edge Functions).
4. Go to **Project Settings → Database → Connection pooling** and copy the **Session Pooler** URI (host ends `.pooler.supabase.com`, port `5432`). If you only see the Transaction Pooler in the dashboard, take that URI and change `:6543` → `:5432`. **Do not use port 6543** — Transaction Pooler does not support DDL. See [`setup-supabase.md` → Connection pooling (2026)](setup-supabase.md#connection-pooling-2026) for context.

Create a `.env` file:

```env
CEREFOX_SUPABASE_URL=https://your-project-ref.supabase.co
CEREFOX_SUPABASE_KEY=sb_secret_...your-supabase-secret-key...
CEREFOX_DATABASE_URL=postgresql://postgres.your-project-ref:your-db-password@aws-N-region.pooler.supabase.com:5432/postgres?sslmode=require
OPENAI_API_KEY=sk-...your-openai-key...
```

The username must include the `.<project-ref>` suffix (e.g. `postgres.abcd1234`) — without it, Supabase returns "Tenant or user not found".

---

## 4. Deploy the schema (1 min)

```bash
uv run python scripts/db_deploy.py
```

You should see all steps complete with a final `Done` message.

Verify:
```bash
uv run python scripts/db_status.py
```

This should show all checks passed.

---

## 5. Ingest your first document (2 min)

Have a markdown file? Ingest it:

```bash
uv run cerefox ingest my-notes.md
```

Or paste directly from the terminal:

```bash
echo "# My First Note

This is the beginning of my personal knowledge base." | uv run cerefox ingest --paste --title "First Note"
```

---

## 6. Build and start the web app (1 min)

Build the React frontend:

```bash
cd frontend && npm install && npm run build && cd ..
```

Start the web app:

```bash
uv run cerefox web
```

Open [http://localhost:8000/app/](http://localhost:8000/app/) -- your dashboard is live.

> The root URL (`http://localhost:8000/`) redirects to `/app/` automatically.

---

## 7. Search your knowledge (30 sec)

From the CLI:

```bash
uv run cerefox search "my first note"
```

Or use the web UI search page at [http://localhost:8000/app/search](http://localhost:8000/app/search).

---

## 8. Connect an AI agent (optional, 5 min)

Cerefox ships a built-in MCP server. Add it to Claude Desktop's config file
(`~/Library/Application Support/Claude/claude_desktop_config.json`):

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

Replace `/path/to/cerefox` with the absolute path to this checkout. Restart Claude Desktop.

> **Recommended: remote MCP** -- if you deployed the Edge Functions (see the main
> README), use the remote MCP path instead -- no Python install needed on the client machine.
> See `docs/guides/connect-agents.md` for Path A-Remote.
>
> **ChatGPT** does not support MCP -- use a Custom GPT with
> Edge Functions instead (see `docs/guides/connect-agents.md`, Path B).

For full setup details (remote MCP, Cursor, cloud clients, GPT Actions), see `docs/guides/connect-agents.md`.

---

## You're done!

**What's next:**
- Ingest a directory of notes: `cerefox ingest-dir ./notes/ --recursive`
- Re-embed existing content: `cerefox reindex`
- Create a backup: `python scripts/backup_create.py`
- Sync project docs into your knowledge base: `python scripts/sync_docs.py`
  (this also ingests the agent reference guides -- `AGENT_GUIDE.md` and `AGENT_QUICK_REFERENCE.md` --
  so your AI agents can search for "How AI Agents Use Cerefox" and learn how to use the tools)
- See all commands: `cerefox --help`

**More guides:**
- `AGENT_GUIDE.md` -- comprehensive reference for AI agents using Cerefox tools
- `AGENT_QUICK_REFERENCE.md` -- minimal quick reference card for AI agents
- `docs/guides/setup-supabase.md` -- detailed Supabase setup
- `docs/guides/configuration.md` -- all configuration options
- `docs/guides/connect-agents.md` -- connecting AI agents via MCP and Edge Functions
- `docs/guides/setup-local.md` -- local Docker setup (no Supabase account needed)
- `docs/guides/upgrading.md` -- upgrading from a previous version
