# Cerefox Access Paths

Cerefox is built in three distinct layers. Understanding them tells you which credentials to
configure, what can reach the database, and which path is right for your integration.

> **A note on credentials (2026):** Cerefox uses two different credentials for two transport
> layers. Layer 1 (Edge Functions) uses the **Cerefox access token** (`cfx_pat_…`) as a Bearer
> token — a random, Cerefox-managed secret validated in-function (the legacy Supabase anon JWT
> is retired for all Edge Function paths as of iter-28E). Layer 2 (web + CLI REST) uses the new
> **secret key** (`sb_secret_…`) or the legacy `service_role` JWT — either works. See
> [`setup-supabase.md` → Supabase API keys (2026)](setup-supabase.md#supabase-api-keys-2026)
> for the full picture.

---

## Layer 1 — AI Agents via Edge Functions (HTTPS)

This is the primary integration layer for AI clients. Nine Supabase Edge Functions are
deployed on the Supabase platform and are reachable over HTTPS with the **Cerefox access
token** (`cfx_pat_…`) as a Bearer token. Each function is deployed `--no-verify-jwt` and
**authenticates the token in-function** (constant-time compare against the accepted set); it
then uses the service-role key internally to call Postgres RPCs. The token grants Edge
Function access only — it is never elevated to database-level access, and the service-role key
never leaves the server.

> ⚠️ The credential here is the **Cerefox access token**, not a Supabase key. Generate it with
> `cerefox token generate` (it sets the `CEREFOX_ACCESS_TOKENS` Function secret and writes
> `CEREFOX_ACCESS_TOKEN` to your local `.env`). The legacy Supabase anon JWT is retired for
> Edge Function auth as of iter-28E. See
> [`setup-supabase.md` → Step 7](setup-supabase.md#step-7--oauth-for-cloud-agents-claudeai--mobile-optional).

### The nine Edge Functions

| Edge Function | Role |
|---|---|
| `cerefox-search` | Hybrid FTS + semantic search; handles server-side embedding |
| `cerefox-ingest` | Ingest a document — chunks, embeds, versions, stores |
| `cerefox-metadata` | List metadata keys with document counts and example values |
| `cerefox-get-document` | Retrieve full document content (current or archived version) |
| `cerefox-list-versions` | List the archived version history for a document |
| `cerefox-get-audit-log` | Query audit log entries with filters |
| `cerefox-metadata-search` | Query documents by metadata key-value criteria without text search |
| `cerefox-list-projects` | List all projects with names, IDs, and descriptions |
| `cerefox-mcp` | Streamable HTTP MCP adapter — calls Postgres RPCs directly. **Also** an OAuth 2.1 protected resource for cloud/mobile Claude (optional — see "the OAuth variant" below) |

### How clients connect

**MCP clients** (Claude Code, Cursor, Claude Desktop) connect to `cerefox-mcp`. It speaks
the MCP Streamable HTTP protocol and calls the Postgres RPCs directly (no internal fan-out
to the primitive Edge Functions). The client only ever talks to one URL.

```
MCP client (Cerefox token)
    │
    ▼
cerefox-mcp   (in-function token check)
    │
    ▼ (service-role key, internal)
Postgres RPCs
```

**ChatGPT Custom GPT Actions** call the eight primitive Edge Functions directly over HTTPS
using an OpenAPI schema. `cerefox-mcp` is not involved (ChatGPT does not support the
Streamable HTTP MCP protocol).

**curl / scripts / custom HTTP clients** can also call the primitives directly using the
same Cerefox token as a Bearer token.

### Credentials needed

- `CEREFOX_SUPABASE_URL` — your Supabase project URL
- **Cerefox access token** (`cfx_pat_…`) — generate it with `cerefox token generate`. It is a
  random, Cerefox-managed secret (not a Supabase key), validated in-function on every Edge
  Function call.

See `docs/guides/connect-agents.md` for step-by-step setup per client.

### The OAuth variant of `cerefox-mcp` — cloud & mobile Claude (optional)

claude.ai web and the Claude mobile app **cannot** send a static Bearer token — a custom
connector there requires **OAuth**. As an optional feature (iter-28A), `cerefox-mcp` is
therefore *also* an OAuth 2.1 protected resource, so those clients get the same full
tool surface. Nothing else in Layer 1 changes, and you can ignore this entirely if you
don't use cloud/mobile Claude.

How it differs from the static-token path:

- **Two accepted credentials.** `cerefox-mcp` authenticates each request itself
  (`_shared/mcp-auth/`), accepting **either** a valid OAuth 2.1 access token (verified
  against the project **JWKS**, with the token's `sub` pinned to `CEREFOX_OAUTH_OWNER_ID`)
  **or** the static **Cerefox access token** (constant-time compare, the same token the
  static-Bearer clients use). All nine data Edge Functions are deployed `--no-verify-jwt` and
  do their token check in-function; `cerefox-mcp` additionally supports the OAuth arm.
- **Supabase is the authorization server.** The OAuth flow uses Supabase's native OAuth 2.1
  Server. The one piece that must serve HTML — the **consent page** — is a free **Cloudflare
  Worker** (`cloudflare/cerefox-consent/`), because a Supabase Edge Function can't serve
  `text/html` on the default `*.supabase.co` domain.
- **The owner pin is the authorization boundary.** `CEREFOX_OAUTH_OWNER_ID` (the owner
  user's UUID) is a server-side value — never entered into any client — and only tokens
  whose `sub` matches it are accepted.

Config: `CEREFOX_OAUTH_OWNER_ID` (owner pin), a pre-registered OAuth App using
**`client_secret_post`**, and the Cloudflare Worker (public project URL + publishable key
baked in). Setup: [`setup-supabase.md` → Step 7](setup-supabase.md#step-7--oauth-for-cloud-agents-claudeai--mobile-optional).
Design: [`docs/specs/oauth-mcp-server-design.md`](../specs/oauth-mcp-server-design.md).

---

## Layer 2 — Web UI and CLI via Supabase REST

The web UI (TypeScript Hono backend + React/Mantine SPA, served by `cerefox web`) and all
`cerefox` CLI commands (`document ingest`, `search`, `server reindex`, `backup`, etc.) talk
to Supabase over its REST API (PostgREST), authenticating with a **service-role-equivalent
key** rather than the anon key — either the new **secret key** (`sb_secret_…`) or the legacy
`service_role` JWT. Both are accepted by the Data API gateway.

> The Python implementation (FastAPI web app, CLI, and the MCP-server fallback) was fully
> removed at v1.0.0. The TS `cerefox` CLI and `cerefox web` are the implementations.

The service-role key bypasses Supabase Row Level Security (RLS) policies and grants
unrestricted read and write access. This is intentional — the CLI and web app are trusted,
local tools that need to insert, update, and delete freely. Keep this key out of any
public-facing configuration.

> **Local coding agents (Claude Code, Codex CLI, opencode, OpenClaw, Hermes, …) also reach
> Cerefox through this layer**, when the user authorises the agent to invoke `cerefox …`
> via its Bash tool. This is "Path C" in `connect-agents.md`. The agent runs with the same
> service-role privileges as the user — same trust assumption as letting the agent edit
> source code in your repo. See `docs/guides/connect-agents.md` → "Path C — Shell CLI for
> local coding agents" for the setup and caveats.

```
Web UI / CLI (service-role key)
    │
    ▼
Supabase REST API (PostgREST)
    │
    ▼
Postgres RPCs  (same cerefox_* functions called by Edge Functions)
```

This layer calls the same Postgres RPCs as the Edge Functions — the business logic
lives in one place (Postgres) and is shared across all callers.

### Credentials needed

- `CEREFOX_SUPABASE_URL` — your Supabase project URL
- `CEREFOX_SUPABASE_KEY` — the new **secret key** (`sb_secret_…`) from **Project Settings → API Keys → Secret key**, or the legacy `service_role` JWT from the "Legacy" section of the same panel. **Not** the anon / publishable key.

---

## Layer 3 — Direct Postgres (Deployment Scripts Only)

For end users, `cerefox server deploy` (which bundles schema + RPCs + the nine Edge
Functions from the npm package) handles schema deployment directly. For contributors, the
canonical deployment and migration scripts (`bun scripts/db_deploy.ts`,
`bun scripts/db_migrate.ts`, `bun scripts/backup_restore.ts`) connect directly to Postgres
over TCP using the database connection string. This is the only path that can run DDL statements (`CREATE TABLE`,
`CREATE FUNCTION`) — the REST API does not support them.

```
cerefox server deploy / bun scripts/db_deploy.ts  (DB password via DATABASE_URL)
    │
    ▼
Postgres (direct TCP connection)
```

No application code — not the web app, not the CLI's runtime read/write commands — uses
this path at request time. It is exclusively for schema deployment and data restore
operations.

### Credentials needed

- `CEREFOX_DATABASE_URL` — the direct Postgres connection string. **Use the Session
  Pooler** (port `5432`) from **Project Settings → Database → Connection pooling**, with
  username `postgres.<project-ref>` and `?sslmode=require` appended. Do not use the
  Transaction Pooler (`6543`) — it does not support DDL. See [`setup-supabase.md` →
  Connection pooling (2026)](setup-supabase.md#connection-pooling-2026) for the full
  reference.

---

## Local / self-hosted (World B) — a different access model

Everything above describes the **cloud / Supabase** deployment. The **local / self-hosted**
backend ([`setup-local.md`](setup-local.md)) runs Postgres + PostgREST + the Cerefox server
in one Docker container, and its access model is deliberately simpler:

- **No Layer 1 (Edge Functions) and no anon-JWT.** There are no Edge Functions; the
  `cerefox-server` inside the container exposes `/rest/v1` (a reverse-proxy to the in-container
  PostgREST) plus `/app` + `/api/v1`. Remote agents over HTTP are not a goal of World B.
- **The access token never leaves the container.** db-init self-generates the PostgREST JWT
  secret on boot and mints a `service_role` token into the container's runtime env. The web
  UI (served by the container) and the in-container CLI/MCP read it internally — nothing on
  the host holds it.
- **Agents use stdio over `docker exec`, not a network credential.** `cerefox-local mcp`
  runs `cerefox mcp` inside the container via `docker exec -i`; the MCP client launches that
  as a local subprocess. No URL, no bearer token in the client config.
- **The only host-side secret is `OPENAI_API_KEY`** (in `~/.cerefox/local/.env`), used for
  embeddings — the same as every deployment.
- By default the container publishes on **`127.0.0.1`** (loopback only); set
  `CEREFOX_LOCAL_BIND=0.0.0.0` to expose it on the LAN.

So Layers 1–3 below apply to the cloud deployment; the local backend collapses them into a
single container with an internally-held token.

---

## Summary

| Caller | Transport | Auth credential | Typical use |
|---|---|---|---|
| Claude Code / Cursor | HTTPS → `cerefox-mcp` | Cerefox access token (`cfx_pat_…`) | Advanced/fallback; prefer local MCP for daily use |
| Claude Desktop | HTTPS → `cerefox-mcp` (via `supergateway`) | Cerefox access token (`cfx_pat_…`) | Advanced/fallback; prefer local MCP for daily use |
| **Cloud Claude (claude.ai web + mobile)** | HTTPS → `cerefox-mcp` over **OAuth 2.1** | Owner-pinned OAuth access token (JWKS-verified) | Optional; memory in the browser + on the phone |
| ChatGPT Custom GPT | HTTPS → primitive Edge Functions | Cerefox access token (`cfx_pat_…`) | AI assistant via GPT Actions |
| curl / HTTP scripts | HTTPS → primitive Edge Functions | Cerefox access token (`cfx_pat_…`) | Ad-hoc queries, automation |
| Web UI (`cerefox web`) | Supabase REST API | Secret key (or legacy service_role) | Web UI backend (TS Hono) |
| **HTTP client → `/api/v1`** | Plain HTTP to `cerefox web` / Cerefox Local | **None** — loopback-bound by default | A local program or bot harness that wants HTTP rather than MCP. Names itself with `X-Cerefox-Author` / `X-Cerefox-Requestor` (v1.11.0): a declared label for attribution, not a verified identity. See [`api.md`](api.md) |
| `cerefox` CLI (human) | Supabase REST API | Secret key (or legacy service_role) | Ingestion, search, reindex, backup |
| Local coding agent via `cerefox` CLI | Supabase REST API | Secret key (or legacy service_role) | User-authorised agent (Claude Code, Codex CLI, opencode, OpenClaw, Hermes, …) acting on user's behalf via Bash tool |
| `cerefox server deploy` / deployment scripts | Direct TCP | DB password | Schema deploy, data restore |

### Key security principle

The **Cerefox access token** (`cfx_pat_…`) is the **Edge Function credential**. It authenticates
to the Edge Functions (which run business logic with the service-role key internally); each
function validates it in-function and Supabase rate-limits the request. **It is not RLS-scoped**
— any holder can call the full EF tool surface (read *and* write). So treat it as a shared
secret for *trusted* agents/clients — keep it in local configs, but do **not** publish it on a
public web page. Unlike the retired legacy anon JWT (which was revoke-only on ES256-migrated
projects), the Cerefox token is **rotatable** with zero downtime via `cerefox token rotate`.

> **Schema 0.7.0 hardening:** the `cerefox_*` RPCs are `SECURITY DEFINER` and previously
> had broader-than-intended `EXECUTE` grants. They now grant `EXECUTE` only to
> `service_role` (which every legitimate caller uses) — revoked from `anon`/`authenticated`/
> `PUBLIC`. A security hardening; run `cerefox server deploy` to apply. See
> [`docs/specs/security-model.md`](../specs/security-model.md).

The **publishable** key (`sb_publishable_…`) is genuinely public-safe: the EF gateway
rejects it and (post-0.7.0) it cannot call the RPCs either, so it grants no KB access — it
only reaches Supabase Auth. That's why the OAuth consent page embeds it, not the anon JWT.

The secret key / `service_role` JWT and the database password must never be embedded in
client-facing configuration or committed to the repository.

---

## Destructive operations and the trust model

Cerefox classifies write operations into three tiers based on how irreversible they are.
The access surface for each tier is **not** the same — this asymmetry is a deliberate
architectural property, not an oversight. Future contributors should read this section
before "completing" the parity table by adding purge to agent-facing access paths.

> **History**: until v1.7.0 restore sat in tier 3 with purge, on the theory that an
> agent must not be able to silently undo its own delete. The maintainer reversed
> that in #210 (2026-08-13): every delete and restore is audited with author
> attribution, restore cannot destroy content, and the CLI had `document restore`
> all along — the boundary the docs described had already outgrown the code. The
> guarded property is now exactly one thing: **no agent path to permanent purge.**

### The three tiers

| Tier | Operations | Reversible? | Where exposed |
|---|---|---|---|
| 1. Reads + soft mutations | search, get, list-*, ingest (create/update), metadata-search, get-audit-log | n/a (reads) / yes (versioned) | All paths — MCP, Edge Functions, CLI, web UI |
| 2. Soft-destructive + recovery | `delete_document` (soft delete to trash), `restore_document` (un-trash), `set_review_status` | yes — delete is restorable; restore recovers | CLI (`cerefox document delete` / `restore`), web UI, and — since v1.7.0 (#208, #210) — MCP (`cerefox_delete_document`, which requires the caller's read-hash, and `cerefox_restore_document`). **Not** the primitive GPT-Actions Edge Functions (deliberately deferred). |
| 3. **Hard-destructive** | `purge_document` (permanent), `set_version_archived` (toggle version retention) | no (purge) | **Web UI only** |

### Why purge is web-UI-only

The recovery story behind Cerefox depends on a **human-in-the-loop confirmation step
before irreversible action.** Everything an agent can do — write, soft-delete,
restore — is reversible and audited; the one action that destroys data outright is
reserved for a human who has just looked at what they are about to destroy.

So the access model is:

1. **An agent (via MCP, Edge Function, or CLI) can write, soft-delete, and restore
   freely.** Every such operation is recorded in `cerefox_audit_log` with `author`,
   `author_type`, and `created_at`. Soft-deleted documents land in trash and are
   excluded from search; a restore puts them back and is itself an audit event, so
   a delete-then-restore leaves a visible trail rather than silence.
2. **A human reviews the trash through the Cerefox web UI.** They see the audit history
   for each document, decide whether the agent's action was correct, and either restore
   the document or — only after seeing what they're about to destroy — purge it.
3. **Purge is the only operation that frees database storage.** Soft delete keeps every
   version, every chunk, every audit entry. The "I made a mistake; recover this" workflow
   is therefore always possible until the human explicitly chooses purge.

A `cerefox purge-doc` CLI command, a `cerefox_purge_document` MCP tool, or a
`/documents/{id}/purge` HTTP endpoint accessible via the Cerefox token would each break this
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
- **Do not attempt to purge from agent code.** There is intentionally no programmatic
  path to permanent deletion — if your workflow needs purge, that workflow needs human
  intervention. Restore, by contrast, is freely available since v1.7.0
  (`cerefox_restore_document` over MCP, `cerefox document restore` on the CLI), audited
  like every other write.

### CLI delete-doc — interactive vs scripted

`cerefox document delete` prompts for confirmation by default (the prompt requires a TTY, so
an agent's Bash tool gets an abort instead of accidentally deleting). Agents
that legitimately need to soft-delete must pass `--yes` *and* set `--author` /
`--author-type` so the audit log captures who acted:

```bash
cerefox document delete <doc-id> --yes \
  --author "claude-code" --author-type "agent"
```

The success message echoes the resolved values back so the agent can include them in
its response to the user.
