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
- To call Edge Functions / remote MCP / GPT Actions you need the **Cerefox access token** (`cfx_pat_…`), not a Supabase key. Generate it later with `cerefox token generate` (Step 7 covers the server-side setup). The legacy Supabase anon JWT is retired for Edge Function auth (iter-28E), and `CEREFOX_SUPABASE_ANON_KEY` is no longer used.

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
remote MCP / GPT Actions path, you'll add a **Cerefox access token** later by
running `cerefox token generate` (it upserts `CEREFOX_ACCESS_TOKEN` into this
same `.env` and sets the accepted set on Supabase — see Step 7).

A minimal `~/.cerefox/.env` looks like:

```bash
CEREFOX_SUPABASE_URL=https://your-project-ref.supabase.co
CEREFOX_SUPABASE_KEY=sb_secret_...your-secret-key...
CEREFOX_DATABASE_URL=postgresql://postgres.yourref:yourpassword@aws-N-region.pooler.supabase.com:5432/postgres?sslmode=require
OPENAI_API_KEY=sk-...
# Only needed for Edge Functions / MCP / GPT Actions — written by `cerefox token generate`:
# CEREFOX_ACCESS_TOKEN=cfx_pat_...your-cerefox-token...
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

**Now generate the Edge Function access token.** The Edge Functions authenticate
callers with a Cerefox access token. Generate one if you'll use **GPT Actions** or a
**remote HTTP MCP** client, or want a fully-green `cerefox doctor`:

```bash
cerefox token generate
```

This sets the `CEREFOX_ACCESS_TOKENS` secret on Supabase and writes
`CEREFOX_ACCESS_TOKEN` into your `.env`. It prints the token **once** — store it. You
paste it by hand only if you connect a **Custom GPT** (Action → Authentication → API
Key) or a **remote HTTP MCP** client. The **local MCP**, **cloud Claude** (OAuth), and
the CLI/web reach Supabase over the Data API and don't need it, so this step is
optional for a local-MCP-only or OAuth-only setup. Lose it → `cerefox token rotate`.
Re-run `cerefox doctor` — the "edge functions" check goes green.

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

## Step 7 — Connect cloud & mobile Claude over OAuth (optional) <a id="step-7--oauth-for-cloud-agents-claudeai--mobile-optional"></a>

> **This whole section is optional.** You only need it to connect **claude.ai web and
> the Claude mobile app** (and any other OAuth-only cloud MCP client). Everything in
> Step 6 — the local MCP, Claude Desktop, Cursor, Claude Code, Codex, Gemini — works
> **without** any of this. Skipping Step 7 costs you nothing except cloud/mobile Claude.
>
> The one extra moving part OAuth adds is a **hosted consent page** — the screen where
> you approve the connection. A Supabase Edge Function can't serve it (Supabase rewrites
> HTML to `text/plain` on the default `*.supabase.co` domain), so this repo ships the
> page as a **free Cloudflare Worker** with a one-command deploy. Full design + the
> gotchas we hit: [`docs/specs/oauth-mcp-server-design.md`](../specs/oauth-mcp-server-design.md).

Cloud AI agents can only connect to a custom MCP server over **OAuth** — they cannot send
a static token. Supabase's native **OAuth 2.1 Server** (beta; free on all plans) makes
`cerefox-mcp` an OAuth-protected resource, so claude.ai and the mobile app get the full
hybrid-search tool surface (not the FTS-only `mcp.supabase.com` path).

**Prerequisite — asymmetric signing keys.** Token validation uses your project's public
JWKS, so the JWT signing key must be **asymmetric (ES256 or RS256)**, not the HS256
default. Check **Project Settings → JWT Keys**; if it says HS256, migrate to ES256 first
(a Supabase-managed key rotation). Existing clients are unaffected (they treat the key as
an opaque string). New projects often already default to ES256.

### 7a. Enable the OAuth 2.1 Server

Supabase Dashboard → **Authentication → OAuth Server** (under Configuration):

- **Enable** the OAuth 2.1 Server.
- **Authorization Path**: set to `/consent` (combines with the Site URL in 7b to form the
  consent-page URL).
- **Dynamic Client Registration (DCR): leave DISABLED.** The dashboard flags open DCR as a
  security risk (any client could self-register), a single-user setup only needs one
  client, and claude.ai's DCR against Supabase is currently unreliable. Register the one
  client by hand in 7d instead.

### 7b. Deploy the consent page (free Cloudflare Worker) and point Site URL at it

The consent page is a single static file that talks only to Supabase Auth. It embeds a
**publishable** key (`sb_publishable_…`) — **never the legacy anon JWT**. (The anon JWT is a
full-KB credential; the publishable key is public-safe — it's rejected by the Edge Function
gateway and, since schema 0.7.0, cannot call the Data API RPCs either. See the
[security model](../specs/security-model.md).)

Add your publishable key to `~/.cerefox/.env` as the single source
(`deploy.sh` reads it). Grab it from the dashboard (**Project Settings → API Keys →
Publishable**) or the CLI:

```bash
npx supabase projects api-keys --project-ref <ref>   # find the "publishable" entry
echo 'CEREFOX_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…' >> ~/.cerefox/.env
```

Then deploy to a free Cloudflare Worker (needs a free Cloudflare account — no domain, no
card):

```bash
cd cloudflare/cerefox-consent
./deploy.sh        # reads CEREFOX_SUPABASE_URL + CEREFOX_SUPABASE_PUBLISHABLE_KEY from ~/.cerefox/.env
```

See [`cloudflare/cerefox-consent/README.md`](../../cloudflare/cerefox-consent/README.md)
for the manual `wrangler` commands. It prints your Worker URL, e.g.
`https://cerefox-consent.<your-subdomain>.workers.dev`.

Then Dashboard → **Authentication → URL Configuration → Site URL** = that Worker origin.
With Authorization Path `/consent`, the consent page lands at `…workers.dev/consent`. (If
your Site URL was the default `http://localhost:3000`, repointing is safe.)

### 7c. Create the owner user + pin it

1. **Owner user** — Dashboard → **Authentication → Users → Add user**: your email + a
   strong password. This is the login you type on the consent page (unrelated to your
   Supabase dashboard login). Copy the new user's **UUID**.
2. **Owner pin** — the only Function secret this feature needs:

   ```bash
   supabase secrets set CEREFOX_OAUTH_OWNER_ID='<owner-user-uuid>' --project-ref <ref>
   ```

   This is the **authorization boundary**, and a server-side value only (never entered
   into claude.ai). The OAuth path **fails closed when this is unset** — the function
   rejects every OAuth token — because otherwise, with Supabase's default email sign-ups
   on, anyone who self-registers could get an accepted token. For a deliberate multi-user
   setup (with sign-ups disabled), opt out explicitly:
   `supabase secrets set CEREFOX_OAUTH_ALLOW_ANY_USER=true`.

### 7d. Register the Claude client — **use `client_secret_post`**

Dashboard → **Authentication → OAuth Apps → New OAuth App**:

- **Client type**: Confidential.
- **Redirect URI** (exact match, no wildcards): `https://claude.ai/api/mcp/auth_callback`
- **Token endpoint auth method: `request body` (`client_secret_post`)** — **not** HTTP
  Basic. Claude sends its client secret in the request body; the Basic default silently
  fails the token exchange with an opaque `ofid_…` error and no usable token. **This is
  the single most common setup mistake — get it right here.**
- Save, then copy the **Client ID** and **Client Secret** (the secret is shown once). You
  paste both into the claude.ai connector — see
  [`connect-agents.md` → Cloud Claude](connect-agents.md#cloud-claude-claudeai-web--mobile-oauth).

### 7e. Deploy the function

```bash
cerefox server deploy --functions-only
```

Deploys `cerefox-mcp` with `--no-verify-jwt` (in-function auth). Then wire the claude.ai
connector per
[`connect-agents.md` → Cloud Claude](connect-agents.md#cloud-claude-claudeai-web--mobile-oauth).

> **Note — the Cerefox access token (iter-28E).** All nine data Edge Functions (the 8
> primitives + `cerefox-mcp`) now deploy `--no-verify-jwt` and authenticate the **Cerefox
> access token** in-function; the legacy anon JWT is retired for Edge Function auth. Before
> your first token-gated deploy, run `cerefox token generate` — it sets the accepted set
> (`CEREFOX_ACCESS_TOKENS`, a Supabase Function secret) and writes `CEREFOX_ACCESS_TOKEN` to
> your local `.env`. Deploying token-gated functions with no token set locks every caller
> out, so generate the token first. `cerefox-mcp` also accepts an owner-pinned OAuth token
> (the arm this Step 7 configures); the OAuth path fails closed until `CEREFOX_OAUTH_OWNER_ID`
> is set (7c).

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
| **Legacy** | "anon" and "service_role" JWTs (`eyJ…`), filed under a "Legacy" section | `service_role` still works for `CEREFOX_SUPABASE_KEY` (Data API). The **anon** JWT is **no longer used** for Edge Function auth (retired in iter-28E — see below). |

### What goes where in `.env`

| Variable | Recommended value | Why |
|---|---|---|
| `CEREFOX_SUPABASE_KEY` | New **secret key** (`sb_secret_…`). Legacy `service_role` JWT also works. | Used by `db/client.py` to reach the Data API (PostgREST). Both formats are accepted by the gateway. |
| `CEREFOX_ACCESS_TOKEN` | **Cerefox access token** (`cfx_pat_…`) from `cerefox token generate`. | The `Authorization: Bearer …` credential for Edge Function calls (remote MCP, GPT Actions, e2e tests, direct curl). Validated in-function; rotatable via `cerefox token rotate`. |
| `CEREFOX_SUPABASE_ANON_KEY` | *(deprecated / unused)* | Formerly the Edge Function Bearer credential. Retired in iter-28E; retained only so an old `.env` still parses. |

### Why Edge Functions use a Cerefox token, not a Supabase key

The Data API gateway was migrated in 2026 to accept both the new and legacy key formats. The Edge Function gateway was not — it rejects the new `sb_publishable_…`/`sb_secret_…` keys as non-JWTs. Rather than pin Edge Function auth to the unrotatable legacy anon JWT (revoke-only on ES256-migrated projects), iter-28E deploys every data Edge Function with `verify_jwt = false` and validates a **Cerefox-managed access token** in-function — a secret, rotatable credential independent of Supabase's key lifecycle. See `docs/specs/ef-auth-migration-design.md`.

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
