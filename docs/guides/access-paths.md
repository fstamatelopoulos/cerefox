# Cerefox Access Paths

Cerefox is built in three distinct layers. Understanding them tells you which credentials to
configure, what can reach the database, and which path is right for your integration.

> **A note on Supabase keys (2026):** Cerefox needs two API keys for two different transport
> layers. Layer 1 (Edge Functions) uses the **legacy anon JWT** as a Bearer token — the new
> `sb_publishable_…` key is rejected by the Edge Function gateway. Layer 2 (Python REST)
> uses the new **secret key** (`sb_secret_…`) or the legacy `service_role` JWT — either
> works. See [`setup-supabase.md` → Supabase API keys (2026)](setup-supabase.md#supabase-api-keys-2026)
> for the full picture and why this asymmetry exists.

---

## Layer 1 — AI Agents via Edge Functions (HTTPS)

This is the primary integration layer for AI clients. Six Supabase Edge Functions are
deployed on the Supabase platform and are reachable over HTTPS with nothing more than the
**legacy anon JWT** (a public-facing JWT, `eyJ…`). The Supabase gateway validates the key
before any request reaches a function; individual functions then use the service-role key
internally to call Postgres RPCs. Your anon key is never elevated to database-level access.

> ⚠️ Use the **legacy anon JWT** here, not the new `sb_publishable_…` key. The Edge
> Function gateway rejects non-JWT keys with `UNAUTHORIZED_INVALID_JWT_FORMAT`. See
> [`setup-supabase.md` → Supabase API keys (2026)](setup-supabase.md#supabase-api-keys-2026)
> for why.

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
- **Legacy anon JWT** — found in your Supabase dashboard under **Project Settings → API Keys → Legacy → anon**. (Do not use the new `sb_publishable_…` key — gateway constraint.)

See `docs/guides/connect-agents.md` for step-by-step setup per client.

---

## Layer 2 — Python Web App and CLI via Supabase REST

The FastAPI web app and all `cerefox` CLI commands (`ingest`, `search`, `reindex`,
`backup`, etc.) use `CerefoxClient` (`src/cerefox/db/client.py`), a thin wrapper around
`supabase-py`. This library talks to Supabase over its REST API (PostgREST), but
authenticates with a **service-role-equivalent key** rather than the anon key — either
the new **secret key** (`sb_secret_…`) or the legacy `service_role` JWT. Both are
accepted by the Data API gateway.

The service-role key bypasses Supabase Row Level Security (RLS) policies and grants
unrestricted read and write access. This is intentional — the CLI and web app are trusted,
local tools that need to insert, update, and delete freely. Keep this key out of any
public-facing configuration.

> **Local coding agents (Claude Code, Codex CLI, opencode, OpenClaw, Hermes, …) also reach
> Cerefox through this layer**, when the user authorises the agent to invoke `uv run cerefox …`
> via its Bash tool. This is "Path C" in `connect-agents.md`. The agent runs with the same
> service-role privileges as the user — same trust assumption as letting the agent edit
> source code in your repo. See `docs/guides/connect-agents.md` → "Path C — Shell CLI for
> local coding agents" for the setup and caveats.

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
- `CEREFOX_SUPABASE_KEY` — the new **secret key** (`sb_secret_…`) from **Project Settings → API Keys → Secret key**, or the legacy `service_role` JWT from the "Legacy" section of the same panel. **Not** the anon / publishable key.

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

- `CEREFOX_DATABASE_URL` — the direct Postgres connection string. **Use the Session
  Pooler** (port `5432`) from **Project Settings → Database → Connection pooling**, with
  username `postgres.<project-ref>` and `?sslmode=require` appended. Do not use the
  Transaction Pooler (`6543`) — it does not support DDL. See [`setup-supabase.md` →
  Connection pooling (2026)](setup-supabase.md#connection-pooling-2026) for the full
  reference.

---

## Summary

| Caller | Transport | Auth credential | Typical use |
|---|---|---|---|
| Claude Code / Cursor | HTTPS → `cerefox-mcp` | Legacy anon JWT | Daily AI assistant access |
| Claude Desktop | HTTPS → `cerefox-mcp` (via `supergateway`) | Legacy anon JWT | Daily AI assistant access |
| ChatGPT Custom GPT | HTTPS → primitive Edge Functions | Legacy anon JWT | AI assistant via GPT Actions |
| curl / HTTP scripts | HTTPS → primitive Edge Functions | Legacy anon JWT | Ad-hoc queries, automation |
| Python web app | Supabase REST API | Secret key (or legacy service_role) | Web UI backend |
| `cerefox` CLI (human) | Supabase REST API | Secret key (or legacy service_role) | Ingestion, search, reindex, backup |
| Local coding agent via `cerefox` CLI | Supabase REST API | Secret key (or legacy service_role) | User-authorised agent (Claude Code, Codex CLI, opencode, OpenClaw, Hermes, …) acting on user's behalf via Bash tool |
| Deployment scripts | Direct TCP (psycopg2) | DB password | Schema deploy, data restore |

### Key security principle

The (legacy) anon JWT is safe to share with AI agents and client applications — it can
only call the operations exposed by the Edge Functions, and the Supabase gateway
rate-limits and validates it. The secret key / `service_role` JWT and the database
password must never be embedded in client-facing configuration or committed to the
repository.
