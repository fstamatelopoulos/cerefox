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

---

## Destructive operations and the trust model

Cerefox classifies write operations into three tiers based on how irreversible they are.
The access surface for each tier is **not** the same — this asymmetry is a deliberate
architectural property, not an oversight. Future contributors should read this section
before "completing" the parity table by adding purge or restore to agent-facing access
paths.

### The three tiers

| Tier | Operations | Reversible? | Where exposed |
|---|---|---|---|
| 1. Reads + soft mutations | search, get, list-*, ingest (create/update), metadata-search, get-audit-log | n/a (reads) / yes (versioned) | All paths — MCP, Edge Functions, CLI, web UI |
| 2. Soft-destructive | `delete_document` (soft delete to trash), `set_review_status` | yes — restorable via web UI | All paths (CLI: `cerefox document delete`; web UI; Python; **not** MCP or Edge Functions today) |
| 3. **Hard-destructive** | `purge_document` (permanent), `restore_document` (un-trash), `set_version_archived` (toggle version retention) | no (purge) / yes (restore, but recovers from a destructive action) | **Web UI only** |

### Why purge / restore are web-UI-only

The recovery story behind Cerefox depends on a **human-in-the-loop confirmation step
before irreversible action.** Soft-delete on its own is not enough — an agent that
mistakenly soft-deletes a document needs to be unable to silently restore the same
document later (covering its tracks), and certainly unable to escalate from soft-delete
to permanent purge.

So the access model is:

1. **An agent (via MCP, Edge Function, or CLI) can write or soft-delete freely.** Every
   such operation is recorded in `cerefox_audit_log` with `author`, `author_type`, and
   `created_at`. Soft-deleted documents land in trash and are excluded from search.
2. **A human reviews the trash through the Cerefox web UI.** They see the audit history
   for each document, decide whether the agent's action was correct, and either restore
   the document or — only after seeing what they're about to destroy — purge it.
3. **Purge is the only operation that frees database storage.** Soft delete keeps every
   version, every chunk, every audit entry. The "I made a mistake; recover this" workflow
   is therefore always possible until the human explicitly chooses purge.

A `cerefox purge-doc` CLI command, a `cerefox_purge_document` MCP tool, or a
`/documents/{id}/purge` HTTP endpoint accessible via the anon JWT would each break this
property. **Do not add them without a governance design that replaces the human-in-the-
loop step with an equivalent guard** (e.g. a "purge approval queue" the web UI must
clear before the operation actually runs).

### What this means for agent operations

If you're building tooling that uses the CLI (Path C) or any MCP/Edge Function path:

- **Use `cerefox document delete` freely** to soft-delete agent-authored content. Pair it
  with `--author <name> --author-type agent` so the audit trail is correct.
- **Surface the soft-delete to the user.** When your agent decides to delete something,
  tell the user explicitly: "I soft-deleted X (recoverable from the Cerefox trash in
  the web UI)." This gives them the visibility to review and either restore or commit.
- **Do not attempt to purge or restore from agent code.** There is intentionally no
  programmatic path. If your workflow needs purge / restore, that workflow needs human
  intervention — the design is correct, not incomplete.

### CLI delete-doc — interactive vs scripted

`cerefox document delete` prompts for confirmation by default (since `click.confirm` requires
a TTY, an agent's Bash tool will get an abort instead of accidentally deleting). Agents
that legitimately need to soft-delete must pass `--yes` *and* set `--author` /
`--author-type` so the audit log captures who acted:

```bash
cerefox document delete <doc-id> --yes \
  --author "claude-code" --author-type "agent"
```

The success message echoes the resolved values back so the agent can include them in
its response to the user.
