# Setting Up Cerefox with Supabase

This guide walks you from a blank Supabase project to a fully deployed Cerefox schema, ready to ingest documents and serve AI agents via MCP.

**Time required**: ~15 minutes

---

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/) installed
- A Supabase account (free tier is enough): [supabase.com](https://supabase.com)
- Python 3.11 or higher

---

## Step 1 — Create a Supabase Project

1. Go to [app.supabase.com](https://app.supabase.com) and sign in
2. Click **New project**
3. Choose a name (e.g. `cerefox`), set a strong database password, pick a region close to you
4. Click **Create new project** and wait ~2 minutes for it to provision

---

## Step 2 — Enable the pgvector Extension

Supabase includes pgvector but you need to activate it:

1. In your project dashboard, go to **Database → Extensions**
2. Search for `vector` and enable it

The deploy script also runs `CREATE EXTENSION IF NOT EXISTS vector` automatically, but enabling it in the UI first prevents permission issues.

---

## Step 3 — Collect Your Credentials

You need three values from Supabase: a URL, an API key, and a direct Postgres connection string. The API-key panel and the connection-string panel both went through significant changes in 2026 — read the two reference sections below for the up-to-date guidance.

### 3a. API URL
- **Project Settings → API → Project URL** → `CEREFOX_SUPABASE_URL`

### 3b. API key — `CEREFOX_SUPABASE_KEY`

See the **[Supabase API keys (2026)](#supabase-api-keys-2026)** section near the end of this guide for the full picture. The short version:

- For `CEREFOX_SUPABASE_KEY` (this guide, Python web app, CLI): use the new **secret key** (`sb_secret_…`) from **Project Settings → API Keys → Secret key**. The legacy `service_role` JWT also still works during the transition.
- For `CEREFOX_SUPABASE_ANON_KEY` (only if you'll use Edge Functions / MCP / GPT Actions; not needed for this guide's deployment step): you must use the **legacy anon JWT** (`eyJ…`). The new `sb_publishable_…` key fails at the Edge Function gateway. See the reference section for why.

Either way: keep this key secret — it bypasses Row Level Security and grants full database access.

### 3c. Direct database URL — `CEREFOX_DATABASE_URL`

This is used by `db_deploy.py`, `db_migrate.py`, and `db_status.py`. See the **[Connection pooling in 2026](#connection-pooling-2026)** reference section near the end of this guide for context. The short version:

1. Open **Project Settings → Database → Connection pooling** (not the "Connect" dialog — that one usually omits the Session Pooler in the new UI).
2. Copy the **Session Pooler** URI (host ends in `.pooler.supabase.com`, port `5432`).
3. Confirm the username has the form `postgres.<project-ref>` — without that suffix you'll get "Tenant or user not found".
4. Append `?sslmode=require` to enforce TLS explicitly.

If you only see Direct Connection and Transaction Pooler in your dashboard, take the Transaction Pooler URI and change `:6543` → `:5432`. That gives you the Session Pooler. **Do not use port 6543** — Transaction Pooler does not support DDL and `db_deploy.py` will fail mid-schema.

The Direct Connection (`db.<project-ref>.supabase.co:5432`) is IPv6-only on the free tier and unusable on most home/office networks. The dashboard now warns about this directly.

---

## Step 4 — Configure Your Environment

```bash
# In the cerefox project root:
cp .env.example .env
```

Edit `.env` and fill in your values. A minimal working configuration looks like:

```bash
CEREFOX_SUPABASE_URL=https://your-project-ref.supabase.co
CEREFOX_SUPABASE_KEY=sb_secret_...your-secret-key...
CEREFOX_DATABASE_URL=postgresql://postgres.yourref:yourpassword@aws-N-region.pooler.supabase.com:5432/postgres?sslmode=require
# CEREFOX_SUPABASE_ANON_KEY only needed if you'll deploy Edge Functions (Step 8)
# Must be the legacy anon JWT, NOT sb_publishable_... — see "Supabase API keys (2026)" below
# CEREFOX_SUPABASE_ANON_KEY=eyJ...your-legacy-anon-jwt...
```

Leave all other settings at their defaults for now.

---

## Step 5 — Install Dependencies

```bash
uv sync
```

This installs all Python dependencies defined in `pyproject.toml`, including `supabase`, `psycopg2-binary`, and `pydantic-settings`.

---

## Step 6 — Deploy the Schema

```bash
# Preview what will happen (no changes made):
python scripts/db_deploy.py --dry-run

# Apply the schema:
python scripts/db_deploy.py
```

Expected output:
```
╔══════════════════════════════════════╗
║  Cerefox DB Deploy                   ║
╚══════════════════════════════════════╝

Connecting to database...

▶  Enable extensions (uuid-ossp, vector/pgvector)...
   ✓  Done

▶  Apply schema (tables, indexes, triggers)...
   ✓  Done

▶  Apply RPCs (search functions)...
   ✓  Done

──────────────────────────────────────────
✓  Deployment complete. 3 steps applied.

Next step: verify the schema with:
    python scripts/db_status.py
```

---

## Step 7 — Verify the Schema

```bash
python scripts/db_status.py
```

Expected output:
```
╔══════════════════════════════════════╗
║  Cerefox DB Status                   ║
╚══════════════════════════════════════╝

Extensions:
  ✓  uuid-ossp
  ✓  vector

Tables:
  ✓  cerefox_projects
  ✓  cerefox_documents
  ✓  cerefox_chunks
  ✓  cerefox_migrations

Functions / RPCs:
  ✓  cerefox_set_updated_at()
  ✓  cerefox_hybrid_search()
  ✓  cerefox_fts_search()
  ✓  cerefox_semantic_search()
  ✓  cerefox_reconstruct_doc()
  ✓  cerefox_save_note()
  ✓  cerefox_search_docs()
  ✓  cerefox_context_expand()

Indexes:
  ✓  idx_cerefox_chunks_fts
  ✓  idx_cerefox_chunks_emb_primary
  ✓  idx_cerefox_chunks_emb_upgrade
  ✓  idx_cerefox_chunks_document
  ✓  idx_cerefox_docs_metadata
  ✓  idx_cerefox_docs_project

Row counts:
  ℹ  cerefox_projects: 0 rows
  ℹ  cerefox_documents: 0 rows
  ℹ  cerefox_chunks: 0 rows

──────────────────────────────────────────
✓  All checks passed. Schema looks healthy.
```

All checks should show ✓. If any show ✗, re-run `python scripts/db_deploy.py`.

---

## Step 8 — Deploy Edge Functions

The Edge Functions run server-side on Supabase. `cerefox-search` and `cerefox-ingest` handle
embedding for agents; `cerefox-mcp` wraps them as a remote MCP endpoint (recommended for
Claude Code, Cursor, and Claude Desktop). Deploy using the Supabase CLI via `npx` — no
separate install needed, just Node.js.

**First time only — authenticate and link your project:**

```bash
npx supabase login        # opens a browser tab; click "Confirm" to generate an access token
npx supabase link         # prompts for your project ref (the ID in your Supabase dashboard URL)
```

Your project ref is in the Supabase dashboard URL:
`https://supabase.com/dashboard/project/<project-ref>`

**Deploy all three functions** (from the cerefox project root):

```bash
npx supabase functions deploy cerefox-ingest
npx supabase functions deploy cerefox-search
npx supabase functions deploy cerefox-mcp
```

Expected output for each:
```
Bundling Function: cerefox-ingest
Deploying Function: cerefox-ingest (script size: ~880kB)
Deployed Functions on project <your-project-ref>: cerefox-ingest
```

You can verify in the Supabase Dashboard → **Edge Functions** — all three functions should
appear with a green "Active" status.

> **`WARNING: Docker is not running` is expected and harmless.** The Supabase CLI checks for
> Docker (its older local bundler ran in a container) but falls back to bundling the functions
> server-side — it uploads the source assets (you'll see `Uploading asset (…)` lines) and
> Supabase compiles them in the cloud. **Docker is not a prerequisite for deploying Cerefox's
> Edge Functions.** A deploy succeeded as long as each function ends with
> `Deployed Functions on project …`. This applies to both the manual commands here and
> `cerefox server deploy --functions-only`.

> **Re-deploying after updates**: run the same `npx supabase functions deploy` commands
> again from the project root, or just `cerefox server deploy --functions-only` (it deploys
> all 9 from the bundled assets). `npx supabase login` only needs to be run once per machine.

---

## Step 9 — Run the Tests

Confirm everything is wired up correctly:

```bash
uv run pytest
```

These are unit tests only (no real database connection needed). You should see all tests pass.

To also run the integration tests against your live Supabase instance:
```bash
uv run pytest -m integration
```

---

## Step 11 — Connect an AI agent (optional)

Cerefox ships a built-in MCP server that gives desktop agents named tools
(`cerefox_search`, `cerefox_ingest`) with full hybrid search.

**For Claude Desktop / ChatGPT Desktop / Cursor** — add to the client's MCP config:
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

**For cloud Claude.ai** — connect to the Supabase remote MCP (FTS keyword search only):
1. In Supabase Dashboard → Project Settings → Integrations → MCP, get your project ref
2. In Claude.ai Settings → Integrations, add `https://mcp.supabase.com/sse?project_ref=<ref>`

**For cloud ChatGPT** — create a Custom GPT with GPT Actions pointing at the Edge Functions.

See `docs/guides/connect-agents.md` for the complete guide including system prompts,
architecture explanation, and ChatGPT GPT Actions setup.

---

## Troubleshooting

### "could not connect to server"
- Check that `CEREFOX_DATABASE_URL` is correct and the password doesn't contain special characters that need URL-encoding
- Try pasting the URL directly into `psql` to verify it works

### "extension 'vector' does not exist"
- Go to Supabase Dashboard → Database → Extensions → enable `vector`
- Then re-run `python scripts/db_deploy.py`

### "permission denied for table"
- Make sure `CEREFOX_SUPABASE_KEY` is your secret key (`sb_secret_…`) or legacy `service_role` JWT — not the publishable / anon key. See [Supabase API keys (2026)](#supabase-api-keys-2026) below.

### Schema already exists (re-deploying)
- All schema objects use `CREATE ... IF NOT EXISTS` / `CREATE OR REPLACE`, so re-running is safe
- To start completely fresh: `python scripts/db_deploy.py --reset` (⚠️ deletes all data)

---

## Supabase API keys (2026) <a id="supabase-api-keys-2026"></a>

In 2026 Supabase rolled out a new API key system. The dashboard now shows two key types side by side, and the migration is **asymmetric** — one half is fully migrated, the other is not. Cerefox needs values from both halves.

### The two key families

| Family | What you'll see in the dashboard | Use it for |
|---|---|---|
| **New (recommended)** | "Publishable key" (`sb_publishable_…`) and "Secret key" (`sb_secret_…`) | `CEREFOX_SUPABASE_KEY` — works end-to-end through the Data API. |
| **Legacy** | "anon" and "service_role" JWTs (`eyJ…`), filed under a "Legacy" section | `CEREFOX_SUPABASE_ANON_KEY` — **still required** for any Edge Function call (MCP, GPT Actions, e2e tests, direct curl). |

### What goes where in `.env`

| Variable | Recommended value | Why |
|---|---|---|
| `CEREFOX_SUPABASE_KEY` | New **secret key** (`sb_secret_…`). Legacy `service_role` JWT also works. | Used by `db/client.py` to reach the Data API (PostgREST). Both formats are accepted by the gateway. |
| `CEREFOX_SUPABASE_ANON_KEY` | **Legacy anon JWT** (`eyJ…`). | Used as the `Authorization: Bearer …` header for Edge Function calls. The Supabase Edge Function gateway still validates this token as a JWT — it parses `header.payload.signature` and rejects non-JWT keys with `UNAUTHORIZED_INVALID_JWT_FORMAT`. The new `sb_publishable_…` key is not a JWT and fails. |

### Why we cannot just use the new keys everywhere

The Data API gateway was migrated in 2026 to accept both the new and legacy key formats. The Edge Function gateway was not. A Supabase team member [confirmed this](https://github.com/orgs/supabase/discussions/41834): the only way to call Edge Functions with the new keys today is to deploy each function with `verify_jwt = false` and validate the key inside the function. Cerefox is not yet doing that (a future migration; see Decision Log 2026 Q2 for context and triggers).

### Is the legacy key going away?

Not yet. The Supabase docs explicitly state: *"You can still use old anon and service-role API keys after enabling the publishable and secret keys."* The "Legacy" label in the dashboard suggests deprecation, but **no end-of-life date has been published** as of May 2026. When Supabase announces one, Cerefox will migrate.

### Sources

- [Edge Function returning "JWT is invalid" after migrating to 2026 API Keys — supabase/discussions#41834](https://github.com/orgs/supabase/discussions/41834)
- [Understanding API keys — Supabase Docs](https://supabase.com/docs/guides/api/api-keys)
- [Securing Edge Functions — Supabase Docs](https://supabase.com/docs/guides/functions/auth)

---

## Connection pooling in 2026 <a id="connection-pooling-2026"></a>

Supabase's "Connect" dialog was redesigned in 2026 and the **Session Pooler** is no longer a first-class tab in many projects. The other two surfaces (Direct Connection and Transaction Pooler) are present but neither works for Cerefox's deployment scripts. Here's the full picture.

### The three Postgres connection types

| Type | Host / port | DDL support | IPv4 compatible? | Use for Cerefox? |
|---|---|---|---|---|
| **Direct Connection** | `db.<project-ref>.supabase.co:5432` | ✓ | **IPv6 only on free tier.** Dashboard warns about this directly. | No — most networks can't reach it. |
| **Transaction Pooler** | `aws-N-region.pooler.supabase.com:6543` (note port) | **✗ no DDL** | ✓ | No — `db_deploy.py` fails mid-schema. |
| **Session Pooler** | `aws-N-region.pooler.supabase.com:5432` | ✓ | ✓ | **Yes — use this.** |

The Transaction Pooler runs PgBouncer in transaction mode and does not maintain a session between statements, breaking DDL, prepared statements, `SET LOCAL`, and advisory locks. The Session Pooler is the same hostname on a different port and keeps a full session per connection.

### Finding the Session Pooler URI

Two reliable paths in the current dashboard:

1. **Project Settings → Database → Connection pooling.** The Session Pooler URI is listed here.
2. **Quick shortcut**: take whatever Transaction Pooler URI the "Connect" dialog shows you and change `:6543` → `:5432`. Same host, same username, just session mode instead of transaction mode.

### Required pieces of the connection string

- **Host**: `aws-N-region.pooler.supabase.com` (substituted by your project's region — e.g. `aws-1-us-east-1`).
- **Port**: `5432` — **never `6543`** for Cerefox.
- **Username**: `postgres.<project-ref>` — the `.<project-ref>` suffix is mandatory. Without it Supabase returns "Tenant or user not found".
- **Password**: the database password set when you created the project (or rotated under Project Settings → Database). URL-encode special characters (`@` → `%40`, etc.) or pick a URL-safe password to avoid the gotcha.
- **Query string**: append `?sslmode=require` to enforce TLS explicitly. Supabase enforces TLS server-side anyway; being explicit doesn't hurt.

Final shape:

```
postgresql://postgres.<project-ref>:<password>@aws-N-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

### Common errors and what they mean

| Error | Likely cause |
|---|---|
| `Tenant or user not found` | Username is missing the `.<project-ref>` suffix. |
| `nodename nor servname provided` | You used the Direct Connection on an IPv4-only network. Switch to Session Pooler. |
| `cannot create function ... transaction mode does not support ...` (or similar mid-schema failure) | You used the Transaction Pooler (port 6543). Switch to Session Pooler (port 5432). |
| `password authentication failed` | Wrong password, or special characters not URL-encoded. Reset under Project Settings → Database. |
