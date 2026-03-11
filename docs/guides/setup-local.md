# Local Setup Guide

Run the Cerefox web server and database on your own machine using Docker for Postgres+pgvector. Embeddings use the OpenAI API — an `OPENAI_API_KEY` is required even for local setups.

---

## Prerequisites

- Docker and Docker Compose
- Python 3.11+ with `uv` (`pip install uv`)
- An OpenAI API key (for embeddings — [platform.openai.com/api-keys](https://platform.openai.com/api-keys))

---

## Step 1 — Clone and install

```bash
git clone https://github.com/yourname/cerefox.git
cd cerefox
uv sync
```

---

## Step 2 — Start Postgres with pgvector

The included `docker-compose.yml` spins up a Postgres 16 instance with the pgvector extension pre-installed:

```bash
docker compose up -d postgres
```

Default connection details (overridable in `.env`):

| Setting | Default |
|---------|---------|
| Host | `localhost` |
| Port | `5432` |
| User | `cerefox` |
| Password | `cerefox` |
| Database | `cerefox` |

---

## Step 3 — Create a `.env` file

```bash
cp .env.example .env
```

Edit `.env` for local Docker:

```env
# Local Postgres (Docker)
CEREFOX_DATABASE_URL=postgresql://cerefox:cerefox@localhost:5432/cerefox

# For local-only use, Supabase keys are not required.
# The web UI and CLI will work without them if you skip the Supabase MCP integration.
CEREFOX_SUPABASE_URL=
CEREFOX_SUPABASE_KEY=

# OpenAI API key for embeddings (text-embedding-3-small, ~$0.10-0.30/month)
OPENAI_API_KEY=sk-...
```

---

## Step 4 — Deploy the schema

```bash
python scripts/db_deploy.py
```

This creates all tables, indexes, and RPC functions. Run with `--dry-run` to preview SQL without executing.

To start fresh:

```bash
python scripts/db_deploy.py --reset   # drops all cerefox_ tables first
```

---

## Step 5 — Verify the setup

```bash
python scripts/db_status.py
```

You should see all tables (cerefox_documents, cerefox_chunks, cerefox_projects) and RPC functions listed as ✓.

---

## Step 6 — Ingest your first document

```bash
# Ingest a markdown file
cerefox ingest my-notes.md --project "personal"

# Or paste content from stdin
echo "# Quick Note\n\nThis is a quick note." | cerefox ingest --paste --title "Quick Note"
```

Each ingest calls the OpenAI embedding API once per batch of chunks (fast, typically under a second).

---

## Step 7 — Start the web UI

```bash
cerefox web
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

For development with auto-reload:

```bash
cerefox web --reload
```

---

## Step 8 — Search from the CLI

```bash
# Hybrid search (recommended)
cerefox search "what did I write about project planning?"

# Keyword-only search
cerefox search "meeting notes" --mode fts

# Semantic search
cerefox search "ideas about creativity" --mode semantic
```

---

## Running everything at once

The `docker-compose.yml` also includes a `cerefox` service that runs the web UI:

```bash
docker compose up -d
```

Web UI will be at [http://localhost:8000](http://localhost:8000).

---

## Stopping services

```bash
docker compose down          # stop, keep data
docker compose down -v       # stop and delete database volume
```

---

## Updating the schema

When a new version of Cerefox introduces schema changes, run:

```bash
python scripts/db_migrate.py
```

This applies incremental migrations without losing data. Always back up first (see `ops-scripts.md`).

---

## Troubleshooting

**pgvector extension not found**
Make sure you're using the `pgvector/pgvector:pg16` Docker image (included in `docker-compose.yml`). Raw Postgres images do not include pgvector.

**"Supabase is not configured" error**
The CLI and web UI show this error if `CEREFOX_SUPABASE_URL` / `CEREFOX_SUPABASE_KEY` are empty. For local Docker setups, the app uses the direct Postgres URL (`CEREFOX_DATABASE_URL`) for schema deployment but the Supabase client for queries. Set up a local Supabase instance or use the hosted free tier (see `setup-supabase.md`).
