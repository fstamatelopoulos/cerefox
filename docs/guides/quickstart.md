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
2. Go to **Settings > API** and copy:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **service_role** key (under "Project API keys" -- use service_role, not anon)
3. Go to **Settings > Database** and copy the **Connection string** (URI format).

Create a `.env` file:

```env
CEREFOX_SUPABASE_URL=https://your-project-ref.supabase.co
CEREFOX_SUPABASE_KEY=your-service-role-key
CEREFOX_DATABASE_URL=postgresql://postgres:password@db.your-project-ref.supabase.co:5432/postgres
OPENAI_API_KEY=sk-...your-openai-key...
```

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
  (this also ingests the agent reference guides -- `AGENT_GUIDE.md` and `CEREFOX_SKILL.md` --
  so your AI agents can search for "How AI Agents Use Cerefox" and learn how to use the tools)
- See all commands: `cerefox --help`

**More guides:**
- `AGENT_GUIDE.md` -- comprehensive reference for AI agents using Cerefox tools
- `CEREFOX_SKILL.md` -- minimal quick reference card for AI agents
- `docs/guides/setup-supabase.md` -- detailed Supabase setup
- `docs/guides/configuration.md` -- all configuration options
- `docs/guides/connect-agents.md` -- connecting AI agents via MCP and Edge Functions
- `docs/guides/setup-local.md` -- local Docker setup (no Supabase account needed)
- `docs/guides/upgrading.md` -- upgrading from a previous version
