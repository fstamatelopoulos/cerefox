# Cerefox Security Model

> **Status**: Living document. First written 2026-07-09 as the Iteration 28B security-audit
> deliverable, covering the OAuth MCP surface (iter-28A) and the credential/RPC trust model.
> Updated for **iter-28E**: the legacy anon JWT is retired as an Edge Function credential;
> all data EFs gate in-function on a rotatable Cerefox access token; the `cerefox-oauth-consent`
> EF was removed (the consent page is the Cloudflare Worker).
> **Scope note:** this pass audited the **OAuth surface + the credential trust model it
> touches**. A full-codebase audit of *all* publicly-reachable components (the 8 primitive
> Edge Functions, the GPT Actions surface, the web app, backup/restore) is a **tracked
> pre-1.0 TODO** (see §6).

Cerefox treats every stored byte as personal and sensitive. This document is the reference
for how access is gated, what the credentials can do, and the invariants that keep the
public surfaces safe.

## 1. Access layers and credentials

See [`docs/guides/access-paths.md`](../guides/access-paths.md) for the full breakdown. In
short:

| Credential | Role | Reaches | Sensitivity |
|---|---|---|---|
| **Cerefox access token** (`cfx_pat_…`) | Edge Function caller credential, validated **in-function** (constant-time compare against `CEREFOX_ACCESS_TOKENS`) | The EF tool surface (full read/write; EFs use service-role internally). **Not** the Data API RPCs (§3). | **Secret**, rotatable (`cerefox token generate`/`rotate`) — trusted agents/local configs only; never publish |
| **Publishable** key (`sb_publishable_…`) | Public client key | Supabase **Auth only**. The EF in-function token check rejects it; RPCs revoked (§3). No KB access. | Public-safe (embed in the consent page) |
| **Secret** key (`sb_secret_…`) / legacy `service_role` JWT | Full DB access, bypasses RLS | Data API + RPCs (as `service_role`). Used by the CLI, web app, Edge Functions (internally), local World B. | **Never** client-facing / committed |
| **Database password** (`CEREFOX_DATABASE_URL`) | Direct Postgres | DDL / deploy / restore only | **Never** client-facing / committed |
| **OAuth 2.1 access token** | Owner identity (cloud/mobile Claude) | `cerefox-mcp` only, validated in-function against JWKS + owner-`sub` pin (§4) | Per-session; issued by Supabase, `sub`-pinned |

> **Legacy anon JWT retired (iter-28E).** The legacy anon JWT (`eyJ…`) was the Edge
> Function gateway credential until iter-28E. On ES256-migrated projects it is
> **unrotatable** (revoke-only), so a leak could not be cycled without killing the EF
> path. It has been **retired as an Edge Function credential**: all data Edge Functions
> now run `--no-verify-jwt` and gate in-function on the rotatable Cerefox access token
> above. `CEREFOX_SUPABASE_ANON_KEY` and the removed `CEREFOX_MCP_STATIC_BEARER` are no
> longer used for Edge Function auth.

## 2. RLS posture

RLS is **enabled on every `cerefox_*` table with no policies** → deny-all for
`anon`/`authenticated` via the Data API. Direct table access (`/rest/v1/cerefox_documents`)
is closed for anon/publishable keys.

## 3. RPC execute-privilege lockdown (schema 0.7.0)

The `cerefox_*` RPCs are `SECURITY DEFINER` (they run with the definer's privileges, so they
bypass RLS by design — that's how the Edge Functions and CLI do their work). The intended
access model is that only `service_role` executes them. Schema 0.7.0 makes the grants match
that intent.

**Change (deployed):** `rpcs.sql` `REVOKE`s `EXECUTE` from `PUBLIC`/`anon`/`authenticated`
and `GRANT`s only to `service_role`, applied over all `cerefox_*` functions and idempotent
(re-applied each deploy). Every legitimate caller uses `service_role` (Edge Functions via the
service-role key; CLI/web via the secret key; local World B via a container-minted
service-role JWT), so nothing legitimate breaks. `docker/local/roles.sql` was tightened to
match. Applied by `cerefox server deploy` (schema 0.6.0 → 0.7.0). **Existing cloud
deployments should redeploy to pick this up.**

## 4. OAuth MCP surface invariants (`cerefox-mcp`)

`cerefox-mcp` is deployed `--no-verify-jwt` (it must serve unauthenticated discovery + issue
401 challenges), so **in-function auth is the only gate**. Invariants, all verified in code
(`_shared/mcp-auth/`, `supabase/functions/cerefox-mcp/`) and by unit tests:

1. **Auth-first dispatch** — token validation runs before any method dispatch, tool lookup,
   or DB touch. The only unauthenticated responses are the RFC 9728 metadata document, the
   401 challenge, 405s, and CORS preflight.
2. **Two credentials, both fail-closed** — a valid OAuth JWT *or* the Cerefox access token
   (constant-time compare against `CEREFOX_ACCESS_TOKENS`; the legacy static-Bearer anon-JWT
   path was replaced in iter-28E). The token path rejects when no tokens are set (never
   accept-all). OAuth path rejects when JWKS is unreachable.
3. **Algorithm allowlist** — ES256/RS256 only, checked *before* any crypto (defends against
   HS256 alg-confusion with the legacy anon JWT). Never `none`.
4. **Issuer/JWKS from `SUPABASE_URL`, not request headers** — deriving them from
   `x-forwarded-*` would allow a JWKS-poisoning auth bypass; `SUPABASE_URL` is platform-set
   and not client-controllable.
5. **Owner-`sub` pin is the authorization boundary** — `CEREFOX_OAUTH_OWNER_ID`. The OAuth
   path **fails closed when unset** (rejects all OAuth tokens) unless
   `CEREFOX_OAUTH_ALLOW_ANY_USER=true` is set explicitly — because Supabase's default email
   sign-ups would otherwise let any self-registered user in.
6. **Failure detail is logged server-side only**, never returned to the client (the 401 body
   is a bare `{"error":"unauthorized"}` + `WWW-Authenticate`).
7. **405-for-GET preserved** for everything except `/version` and the metadata route
   (SSE-polling quota-burn guard).
8. **Deploy-flag map in code** (`NO_VERIFY_JWT_EFS`) — since iter-28E **all data Edge
   Functions** (`cerefox-mcp` + the 8 primitive EFs) deploy `--no-verify-jwt` and gate
   in-function on the Cerefox access token; the Supabase gateway no longer validates any of
   them. (The `cerefox-oauth-consent` EF was removed in iter-28E — the consent page is now
   the Cloudflare Worker, §5.) The only unauthenticated surface is `cerefox-mcp`'s RFC 9728
   OAuth discovery route plus its 401 challenge.

## 5. Consent page

The consent page is a **Cloudflare Worker** (`cloudflare/cerefox-consent/`, importing the
retained `_shared/consent-page` module). It is **not** a Cerefox Edge Function surface: the
`cerefox-oauth-consent` EF was removed in iter-28E, so the Worker is the sole consent page.
It is served **unauthenticated** (a browser loads it) and is therefore world-readable. It
embeds **only** the publishable key (§1) — never the anon JWT — and holds no server-side
secret.
Approve/deny happens under the owner's Supabase Auth session; the page redirects with
`location.assign` (client-side, so no 307), and handles an already-consumed
`authorization_id` gracefully.

## 6. Operational security

- `~/.cerefox/.env` is written `chmod 0600` (`cerefox init`); `cerefox doctor` warns if not.
- No secrets are committed (history clean as of the audit; recommend adding **gitleaks** to
  CI as a durable gate).
- Dependency audit: run `bun audit` (the repo is Bun-based; `npm audit` needs a lockfile).

## 7. Open items (pre-1.0)

- **Full-codebase security audit** of all publicly-reachable components — the 8 primitive
  Edge Functions, the GPT Actions OpenAPI surface, the web app, and backup/restore file
  handling. This document covers the OAuth surface + credential model only.
- **Access-token rotation** after any exposure: `cerefox token rotate` (add a new token to
  `CEREFOX_ACCESS_TOKENS`, migrate client configs, drop the old) — zero-downtime and fully
  rotatable, unlike the retired anon JWT (iter-28E closed the underlying unrotatability).
- **CI gates**: gitleaks (secret scanning) + `bun audit` (dependencies).
- **JWKS stale-cache** (low): on a JWKS fetch failure the validator serves the last-cached
  keys for up to the TTL (600s) — a rotated-out key stays accepted briefly. Acceptable;
  revisit if key rotation becomes frequent.
