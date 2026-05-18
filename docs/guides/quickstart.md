# Quickstart -- Zero to First Document in 15 Minutes

Get Cerefox running locally and ingest your first document.

> **Upgrading from a previous version?** See the [Upgrading Guide](upgrading.md) for migration steps instead.

---

## 1. Prerequisites (2 min)

- Python 3.11+ (`python3 --version`)
- Node.js 18+ and npm (`node --version`)
- `uv` package manager (`pip install uv`)
- A Supabase account -- [supabase.com](https://supabase.com) (free tier works)
- An OpenAI API key -- [platform.openai.com/api-keys](https://platform.openai.com/api-keys)

---

## 2. Install Cerefox (2 min)

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
