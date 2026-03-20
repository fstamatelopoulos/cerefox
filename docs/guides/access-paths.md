# Cerefox Access Paths

Cerefox is built in three distinct layers. Understanding them tells you which credentials to
configure, what can reach the database, and which path is right for your integration.

---

## Layer 1 — AI Agents via Edge Functions (HTTPS)

This is the primary integration layer for AI clients. Six Supabase Edge Functions are
deployed on the Supabase platform and are reachable over HTTPS with nothing more than the
**anon key** (a public-facing JWT). The Supabase gateway validates the key before any
request reaches a function; individual functions then use the service-role key internally to
call Postgres RPCs. Your anon key is never elevated to database-level access.

### The six Edge Functions

| Edge Function | Role |
|---|---|
| `cerefox-search` | Hybrid FTS + semantic search; handles server-side embedding |
| `cerefox-ingest` | Ingest a document — chunks, embeds, versions, stores |
| `cerefox-metadata` | List metadata keys with document counts and example values |
| `cerefox-get-document` | Retrieve full document content (current or archived version) |
| `cerefox-list-versions` | List the archived version history for a document |
| `cerefox-mcp` | Streamable HTTP MCP adapter — delegates to all five above |

### How clients connect

**MCP clients** (Claude Code, Cursor, Claude Desktop) connect to `cerefox-mcp`. It speaks
the MCP Streamable HTTP protocol and fans out each tool call to the appropriate primitive
Edge Function via an internal `fetch()`. The client only ever talks to one URL.

```
MCP client (anon key)
    │
    ▼
cerefox-mcp ──▶ cerefox-search
            ──▶ cerefox-ingest
            ──▶ cerefox-metadata
            ──▶ cerefox-get-document
            ──▶ cerefox-list-versions
                    │
                    ▼ (service-role key, internal)
             Postgres RPCs
```

**ChatGPT Custom GPT Actions** call the five primitive Edge Functions directly over HTTPS
using an OpenAPI schema. `cerefox-mcp` is not involved (ChatGPT does not support the
Streamable HTTP MCP protocol).

**curl / scripts / custom HTTP clients** can also call the primitives directly using the
same anon key as a Bearer token.

### Credentials needed

- `CEREFOX_SUPABASE_URL` — your Supabase project URL
- Anon key — found in your Supabase dashboard under **Project Settings → API → anon public**

See `docs/guides/connect-agents.md` for step-by-step setup per client.

---

## Layer 2 — Python Web App and CLI via Supabase REST

The FastAPI web app and all `cerefox` CLI commands (`ingest`, `search`, `reindex`,
`backup`, etc.) use `CerefoxClient` (`src/cerefox/db/client.py`), a thin wrapper around
`supabase-py`. This library talks to Supabase over its REST API (PostgREST), but
authenticates with the **service-role key** rather than the anon key.

The service-role key bypasses Supabase Row Level Security (RLS) policies and grants
unrestricted read and write access. This is intentional — the CLI and web app are trusted,
local tools that need to insert, update, and delete freely. Keep this key out of any
public-facing configuration.

```
Python web app / CLI (service-role key)
    │
    ▼
Supabase REST API (PostgREST)
    │
    ▼
Postgres RPCs  (same cerefox_* functions called by Edge Functions)
```

The Python layer calls the same Postgres RPCs as the Edge Functions — the business logic
lives in one place (Postgres) and is shared across all callers.

### Credentials needed

- `CEREFOX_SUPABASE_URL` — your Supabase project URL
- `CEREFOX_SUPABASE_KEY` — the **service-role** key (not the anon key)
  Found in **Project Settings → API → service_role secret**

---

## Layer 3 — Direct Postgres (Deployment Scripts Only)

The deployment and migration scripts (`scripts/db_deploy.py`, `scripts/db_migrate.py`,
`scripts/backup_restore.py`) connect directly to Postgres over TCP using **psycopg2** and
the database connection string. This is the only path that can run DDL statements (`CREATE
TABLE`, `CREATE FUNCTION`) — the REST API does not support them.

```
scripts/db_deploy.py  (DB password via DATABASE_URL)
    │
    ▼
Postgres (direct TCP connection)
```

No application code — not the web app, not the CLI — uses this path at runtime. It is
exclusively for schema deployment and data restore operations.

### Credentials needed

- `CEREFOX_DATABASE_URL` — the direct Postgres connection string
  Found in **Project Settings → Database → Connection string → URI** (use the
  "Connection pooling" URI for Supabase; the direct URI for local Docker)

---

## Summary

| Caller | Transport | Auth credential | Typical use |
|---|---|---|---|
| Claude Code / Cursor | HTTPS → `cerefox-mcp` | Anon key | Daily AI assistant access |
| Claude Desktop | HTTPS → `cerefox-mcp` (via `supergateway`) | Anon key | Daily AI assistant access |
| ChatGPT Custom GPT | HTTPS → primitive Edge Functions | Anon key | AI assistant via GPT Actions |
| curl / HTTP scripts | HTTPS → primitive Edge Functions | Anon key | Ad-hoc queries, automation |
| Python web app | Supabase REST API | Service-role key | Web UI backend |
| `cerefox` CLI | Supabase REST API | Service-role key | Ingestion, search, reindex, backup |
| Deployment scripts | Direct TCP (psycopg2) | DB password | Schema deploy, data restore |

### Key security principle

The anon key is safe to share with AI agents and client applications — it can only call
the five operations exposed by the Edge Functions, and the Supabase gateway rate-limits
and validates it. The service-role key and the database password must never be embedded
in client-facing configuration or committed to the repository.
