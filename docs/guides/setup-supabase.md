# Setting Up Cerefox with Supabase

This guide walks you from a blank Supabase project to a fully deployed Cerefox schema, ready to ingest documents and serve AI agents via MCP.

**Time required**: ~15 minutes

---

## Prerequisites

- The Cerefox CLI installed (`cerefox --version`) — see [`quickstart.md`](quickstart.md#1-install). End users do **not** need a source clone or Python.
- **Node.js 20+** or **Bun 1.0+** (the CLI runtime; also used for `npx supabase`).
- A Supabase account (free tier is enough): [supabase.com](https://supabase.com)

> The `python scripts/db_*.py` paths shown in the contributor footnotes below are **legacy**. The Python implementation is legacy and slated for removal in a future release; only the Python MCP server remains as a fallback. Contributors with a repo clone should use `bun scripts/db_deploy.ts` / `bun scripts/db_migrate.ts`.

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

- For `CEREFOX_SUPABASE_KEY` (this guide, the web UI, and the CLI): use the new **secret key** (`sb_secret_…`) from **Project Settings → API Keys → Secret key**. The legacy `service_role` JWT also still works during the transition.
- For `CEREFOX_SUPABASE_ANON_KEY` (only if you'll use Edge Functions / MCP / GPT Actions; not needed for this guide's deployment step): you must use the **legacy anon JWT** (`eyJ…`). The new `sb_publishable_…` key fails at the Edge Function gateway. See the reference section for why.

Either way: keep this key secret — it bypasses Row Level Security and grants full database access.

### 3c. Direct database URL — `CEREFOX_DATABASE_URL`

This is used by `cerefox server deploy` (and the contributor scripts `bun scripts/db_deploy.ts` / `bun scripts/db_migrate.ts`). See the **[Connection pooling in 2026](#connection-pooling-2026)** reference section near the end of this guide for context. The short version:

1. Open **Project Settings → Database → Connection pooling** (not the "Connect" dialog — that one usually omits the Session Pooler in the new UI).
2. Copy the **Session Pooler** URI (host ends in `.pooler.supabase.com`, port `5432`).
3. Confirm the username has the form `postgres.<project-ref>` — without that suffix you'll get "Tenant or user not found".
4. Append `?sslmode=require` to enforce TLS explicitly.

If you only see Direct Connection and Transaction Pooler in your dashboard, take the Transaction Pooler URI and change `:6543` → `:5432`. That gives you the Session Pooler. **Do not use port 6543** — Transaction Pooler does not support DDL and the schema deploy will fail mid-schema.

The Direct Connection (`db.<project-ref>.supabase.co:5432`) is IPv6-only on the free tier and unusable on most home/office networks. The dashboard now warns about this directly.

---

## Step 4 — Configure Your Environment

Run the interactive setup — it validates each credential against the live
service and writes `~/.cerefox/.env` (mode 0600):

```bash
cerefox init
```

When prompted, supply the three values from Step 3 (URL, secret key, database
URL) plus your `OPENAI_API_KEY`. If you plan to connect AI agents via the
remote MCP / GPT Actions path, also set `CEREFOX_SUPABASE_ANON_KEY` to the
**legacy anon JWT** (`eyJ…`, not `sb_publishable_…` — see "Supabase API keys
(2026)" below).

A minimal `~/.cerefox/.env` looks like:

```bash
CEREFOX_SUPABASE_URL=https://your-project-ref.supabase.co
CEREFOX_SUPABASE_KEY=sb_secret_...your-secret-key...
CEREFOX_DATABASE_URL=postgresql://postgres.yourref:yourpassword@aws-N-region.pooler.supabase.com:5432/postgres?sslmode=require
OPENAI_API_KEY=sk-...
# Only needed for Edge Functions / MCP / GPT Actions — must be the legacy anon JWT:
# CEREFOX_SUPABASE_ANON_KEY=eyJ...your-legacy-anon-jwt...
```

> **Contributors** (repo clone): copy `cp .env.example .env` in the project root
> and edit it directly; the repo-local `.env` takes precedence (see
> [`configuration.md`](configuration.md#where-cerefox-looks-for-env-v030)).

---

## Step 5 — Deploy the Schema and Edge Functions

`cerefox server deploy` is the catch-all end-user deploy path. It deploys the
schema + RPCs (using `CEREFOX_DATABASE_URL`) and all 9 Edge Functions — straight
from the npm-bundled assets, no source clone. It detects fresh vs. existing
databases: a fresh DB gets schema + RPCs + migration stamps; an existing DB gets
pending migrations applied and `rpcs.sql` re-applied in place.

```bash
# Preview what will happen (no changes made):
cerefox server deploy --dry-run

# Deploy everything (schema + RPCs + Edge Functions):
cerefox server deploy
```

Useful flags: `--schema-only`, `--functions-only`, `--dry-run`.

**First time only — the Edge Function step authenticates and links your project**
(it shells out to `npx supabase`). If prompted, run:

```bash
npx supabase login        # opens a browser tab; click "Confirm" to generate an access token
npx supabase link         # prompts for your project ref (the ID in your Supabase dashboard URL)
```

Your project ref is in the Supabase dashboard URL:
`https://supabase.com/dashboard/project/<project-ref>`

After it finishes, verify in the Supabase Dashboard → **Edge Functions** — all 9
functions should appear with a green "Active" status.

> **`WARNING: Docker is not running` is expected and harmless.** The Supabase CLI checks for
> Docker (its older local bundler ran in a container) but falls back to bundling the functions
> server-side — it uploads the source assets (you'll see `Uploading asset (…)` lines) and
> Supabase compiles them in the cloud. **Docker is not a prerequisite for deploying Cerefox's
> Edge Functions.** A deploy succeeded as long as each function ends with
> `Deployed Functions on project …`.

> **Re-deploying after upgrades**: just re-run `cerefox server deploy` (or
> `cerefox server deploy --functions-only` for EFs only). It applies pending
> migrations and re-applies RPCs in place. `npx supabase login` only needs to be
> run once per machine.

> **Contributors** (repo clone): the low-level path is `bun scripts/db_deploy.ts`
> / `bun scripts/db_migrate.ts` for schema, and `npx supabase functions deploy
> <name>` per Edge Function. The `python scripts/db_deploy.py` path is legacy.

---

## Step 6 — Connect an AI agent (optional)

Cerefox ships a built-in MCP server that gives desktop agents named tools
(`cerefox_search`, `cerefox_ingest`) with full hybrid search.

**For Claude Code / Claude Desktop / Cursor / Codex / Gemini** — let the CLI
write the config:
```bash
cerefox configure-agent --tool claude-code      # or claude-desktop, cursor, codex, gemini
```

This points the client at the local stdio server (`cerefox mcp`). To edit
configs by hand or use the remote (Edge Function) HTTP transport, see
[`connect-agents.md`](connect-agents.md).

**For cloud Claude.ai / Claude mobile** — connect over OAuth to your own
`cerefox-mcp` Edge Function with the **full hybrid-search tool surface** (not the
FTS-only `mcp.supabase.com` path). This needs a one-time OAuth setup — see
[Step 7](#step-7--oauth-for-cloud-agents-claudeai--mobile-optional) below.

**For cloud ChatGPT** — create a Custom GPT with GPT Actions pointing at the Edge Functions.

See `docs/guides/connect-agents.md` for the complete guide including system prompts,
architecture explanation, and ChatGPT GPT Actions setup.

---

## Step 7 — OAuth for cloud agents (Claude.ai / mobile) (optional) <a id="step-7--oauth-for-cloud-agents-claudeai--mobile-optional"></a>

> **Status (iter-28A):** the server side ships in the npm package and deploys with
> `cerefox server deploy`. This section documents the one-time Supabase configuration.
> The client-side connection walk-through lives in
> [`connect-agents.md` → Cloud Claude](connect-agents.md#cloud-claude-claudeai-web--mobile-oauth).
> Full design: [`docs/specs/oauth-mcp-server-design.md`](../specs/oauth-mcp-server-design.md).

Cloud AI agents (claude.ai web, the Claude mobile app, and other
OAuth-discovering MCP clients) can only connect to a custom MCP server over
**OAuth** — they cannot send a static Bearer token. Supabase's native **OAuth 2.1
Server** (beta; free during beta on all plans) makes `cerefox-mcp` a proper
OAuth-protected resource, so those agents get the full tool surface. Your existing
static-Bearer clients (Claude Code, Cursor, Codex, Gemini, Claude Desktop) keep
working unchanged.

**Prerequisite — asymmetric signing keys.** Token validation uses your project's
public JWKS, so the JWT signing key must be **asymmetric (ES256 or RS256)**, not the
HS256 default. Check under **Project Settings → JWT Keys**; if it says HS256, migrate
to ES256 first (Supabase-managed key rotation). Legacy-anon-key clients are unaffected
by the rotation (they treat the key as an opaque string).

### 7a. Enable the OAuth 2.1 Server

Supabase Dashboard → **Authentication → Configuration → OAuth Server**:

- **Enable** the OAuth 2.1 Server.
- **Authorization Path**: set to `/consent`. (This combines with the Site URL below
  to form your consent-page URL.)
- **Dynamic Client Registration (DCR): leave DISABLED.** The dashboard flags open DCR
  as a security risk (any client could self-register), a single-user setup only ever
  needs one client, and claude.ai's DCR against Supabase is currently unreliable. You
  register the one client by hand in Step 7d instead.

### 7b. Point the Site URL at the consent page

Supabase Dashboard → **Authentication → URL Configuration → Site URL**:

```
https://<your-project-ref>.supabase.co/functions/v1/cerefox-oauth-consent
```

With Authorization Path `/consent`, the consent page is served at
`…/cerefox-oauth-consent/consent`. (If your Site URL was the default
`http://localhost:3000`, nothing depends on it — repointing is safe.)

### 7c. Create the owner user + secrets

1. **Owner user** — Dashboard → **Authentication → Users → Add user**: your email +
   a strong password. This is the login you'll type on the consent page (unrelated to
   your Supabase dashboard login). Copy the new user's **UUID** from the users list.
2. **Function secrets** — the `cerefox-mcp` function runs with in-function auth
   (`--no-verify-jwt`). Set the **owner pin**; the back-compat secret is **optional**:

   ```bash
   # RECOMMENDED — owner pin: only tokens for THIS user id are accepted.
   supabase secrets set CEREFOX_OAUTH_OWNER_ID='<owner-user-uuid>' --project-ref <ref>

   # OPTIONAL — back-compat for existing static-Bearer clients. Skip this unless
   # you see old clients getting 401 (see note): by default the function uses the
   # platform-injected SUPABASE_ANON_KEY, which is what those clients already send.
   # supabase secrets set CEREFOX_MCP_STATIC_BEARER='eyJ...your-legacy-anon-jwt...' --project-ref <ref>
   ```

   **`CEREFOX_OAUTH_OWNER_ID`** is the UUID from step 1 — a **server-side** value only
   (never entered into claude.ai). Set it: it is the authorization boundary. If unset,
   the function accepts *any* validly-signed `authenticated` token from your project's
   auth server — which means **if email sign-ups are enabled (the Supabase default),
   anyone who self-registers could get an accepted token**. Pinning the owner (or
   disabling public sign-ups under Authentication → Sign In / Providers) closes that.

   **`CEREFOX_MCP_STATIC_BEARER`** is optional back-compat. The function falls back to
   the auto-injected `SUPABASE_ANON_KEY` (what Claude Code / Cursor / etc. already send),
   so existing clients keep working without it. Set it explicitly only if the injected
   var proves unreliable — the symptom is old clients getting 401 with a
   `auth rejected: bad_signature`/`malformed_token` line in
   `supabase functions logs cerefox-mcp`. Either way the static path fails **closed**
   (never accepts an unexpected token).

### 7d. Register the Claude client (pre-registration, since DCR is off)

Dashboard → **Authentication → OAuth Apps → New OAuth App**:

- **Client type**: Confidential (or Public — Claude supports both via the connector's
  optional Client ID / Client Secret fields).
- **Redirect URI** (exact match, no wildcards): `https://claude.ai/api/mcp/auth_callback`
- Save, then copy the generated **Client ID** and **Client Secret** — you paste these
  into the claude.ai connector dialog in `connect-agents.md`.

### 7e. Deploy

```bash
cerefox server deploy --functions-only
```

This deploys `cerefox-mcp` and `cerefox-oauth-consent` with `--no-verify-jwt` (the
deploy prints a reminder to set the secrets above). Then continue with the client
connection in
[`connect-agents.md` → Cloud Claude](connect-agents.md#cloud-claude-claudeai-web--mobile-oauth).

---

## Troubleshooting

### "could not connect to server"
- Check that `CEREFOX_DATABASE_URL` is correct and the password doesn't contain special characters that need URL-encoding
- Try pasting the URL directly into `psql` to verify it works

### "extension 'vector' does not exist"
- Go to Supabase Dashboard → Database → Extensions → enable `vector`
- Then re-run `cerefox server deploy`

### "permission denied for table"
- Make sure `CEREFOX_SUPABASE_KEY` is your secret key (`sb_secret_…`) or legacy `service_role` JWT — not the publishable / anon key. See [Supabase API keys (2026)](#supabase-api-keys-2026) below.

### Schema already exists (re-deploying)
- All schema objects use `CREATE ... IF NOT EXISTS` / `CREATE OR REPLACE`, so re-running `cerefox server deploy` is safe
- To start completely fresh, contributors with a repo clone can run `bun scripts/db_deploy.ts --reset` (⚠️ deletes all data; typed-`yes` guard). There is deliberately no `--reset` on `cerefox server deploy`.

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
| **Transaction Pooler** | `aws-N-region.pooler.supabase.com:6543` (note port) | **✗ no DDL** | ✓ | No — the schema deploy fails mid-schema. |
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
