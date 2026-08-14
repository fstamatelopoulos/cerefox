# Design: OAuth 2.1 on `cerefox-mcp` — Cerefox for Claude.ai, Claude mobile, and other cloud agents

> **Status**: Design-of-record (2026-07-08). Not started. Work lands on `feat/oauth-mcp`,
> ships as part of **Iteration 28 (v1.0.0)** alongside the stability commitment and the
> security audit (which explicitly covers this new auth surface).
>
> **Supersedes** the March 2026 deferral in
> [`docs/research/oauth-mcp-auth.md`](../research/oauth-mcp-auth.md): Supabase has since
> shipped a native **OAuth 2.1 Server** (public beta 2025-11-26), which turns the old
> GoTrue blocker into the intended mechanism. This doc is the repo-side design derived
> from the maintainer's research handoff (Cerefox KB doc `92996524-2923-4c7d-864b-7ae52f1bbb28`,
> "Handoff: Cerefox as an OAuth-protected MCP server for Claude.ai and mobile").
>
> Per `docs/specs/README.md`, this is a point-in-time snapshot; `docs/plan.md` wins where
> they diverge during execution.

---

## 1. Problem and goal

Cerefox's remote MCP server (`cerefox-mcp` Edge Function) authenticates with a **static
Bearer token** (the legacy anon JWT), validated by the Supabase API gateway before the
function runs. That works for every client that can send a static header — Claude Code,
Cursor, Codex, Gemini CLI, Claude Desktop (via `supergateway`/`mcp-remote --header`) — but
**claude.ai web and the Claude mobile app require OAuth for custom connectors**
(authorization code + PKCE, with standard MCP discovery). Nuance verified 2026-07-08:
Anthropic has begun a **beta, slow-rollout "Request headers" option** on custom connectors
(static bearer/API-key via an allowlisted header set incl. `authorization`) — see §4.4; it
may deliver a zero-code quick win if the rollout has reached the maintainer's account, but
OAuth remains the robust, generally-available path this design targets.

**Goal**: make `cerefox-mcp` a spec-compliant OAuth 2.1 **protected resource server** so
any OAuth-discovering MCP client — claude.ai, Claude mobile, and potentially ChatGPT
connectors and others — can connect with the **full tool surface (ten tools at the time of this design; 15 core today)** (hybrid search,
document reconstruction, ingest, the works). Explicitly rejected: keyword-only access via
Supabase's hosted MCP (`mcp.supabase.com` + PAT) — raw table access without semantic
search or Cerefox tool ergonomics is not worth having.

**Non-goals**: multi-user support (Cerefox stays single-user; OAuth authenticates the one
owner), real-time transport changes (no SSE), any change to the primitive Edge Functions
or the GPT Actions path.

## 2. History — why this was blocked, and what changed

The March 2026 research (`docs/research/oauth-mcp-auth.md`) and the Decision Log
(2026 Q1 Part 1, entries of 2026-03-14/15/16) established:

- **GoTrue owned `/.well-known/*` on `*.supabase.co`** and served nothing valid for a
  custom Edge Function. Every OAuth-discovering client (`mcp-remote` default mode,
  Perplexity web connector — both *tested*) crashed at discovery/DCR before reaching the
  EF. Custom EFs could not override those routes.
- Supabase's own docs said auth for BYO MCP on Edge Functions was "coming soon".
- Decision then: **defer**; static Bearer covers every client we actually needed
  ("don't build infrastructure for a problem that doesn't exist yet"), with the
  Cloudflare Worker OAuth proxy noted as the escape hatch.

**What changed (the unblock)**: Supabase shipped the **OAuth 2.1 Server** (public beta
announced 2025-11-26). It provides:

- OAuth 2.1 **authorization code + PKCE** (the only grant — exactly what Claude needs).
- **Valid discovery metadata** at
  `https://<project-ref>.supabase.co/.well-known/oauth-authorization-server` (plus the
  `/auth/v1`-suffixed variant and `/.well-known/openid-configuration`). The route GoTrue
  owns now answers correctly — the wall became the door.
- **Dynamic Client Registration** (dashboard toggle), so Claude can self-register.
- JWT access tokens (carrying `user_id`, `role`, `client_id`) with refresh-token rotation,
  verifiable against the project **JWKS**.

Relevant Decision Log lessons this design must respect (from the 2026 sweep):

1. **405-for-GET is load-bearing** (2026-03-30): a 200 on GET once caused clients to
   treat the server as SSE-capable and poll ~1 req/sec (~86K EF invocations/day/client).
   The new discovery routes are GETs; everything else must keep returning 405.
2. **EF env vars are not reliably available** (2026-03-14): the original in-function
   Bearer check was removed partly because `Deno.env.get("SUPABASE_ANON_KEY")` was
   sometimes undefined. Any new in-function secret must be an **explicitly-set Function
   secret**, not an assumed platform-injected var.
3. **The EF gateway is JWT-only** (2026-05-18): it rejects the new `sb_publishable_…`/
   `sb_secret_…` keys with `UNAUTHORIZED_INVALID_JWT_FORMAT`. The recorded "Option B"
   sketch — per-function `verify_jwt = false` + in-function validation — was deliberately
   parked with trigger conditions; condition (d) ("MCP client-config layer being touched
   anyway") is now met. This design effectively executes Option B for `cerefox-mcp`,
   while keeping `Authorization: Bearer` semantics so no existing client config changes.
4. The old "claude.ai would be FTS-only even with perfect OAuth" note was an explicitly
   **untested assumption** about the `mcp.supabase.com` path; it does not apply to our
   own MCP server and is superseded by this design.

## 3. Decisions (locked 2026-07-07, maintainer session)

- **(a) Full MCP access only.** No keyword-only half measure.
- **(b) Primary path: native Supabase OAuth 2.1 Server**, with `cerefox-mcp` as the
  protected resource. No new infrastructure except a publicly reachable consent page.
- **(c) Cloudflare Worker OAuth proxy is the documented fallback** (§12), built only if
  the native path hits an unresolvable wall (likely a beta bug or discovery mismatch).
- **(d) Backward compatibility is an invariant**: the legacy static-Bearer path keeps
  working for all existing clients throughout and after this work.

## 4. Target architecture

### 4.1 The flow (what happens when the connector is added on claude.ai)

```
1. claude.ai POSTs (unauthenticated) to
   https://<ref>.supabase.co/functions/v1/cerefox-mcp
2. cerefox-mcp returns 401 + WWW-Authenticate: Bearer resource_metadata=
   "https://<ref>.supabase.co/functions/v1/cerefox-mcp/.well-known/oauth-protected-resource"
3. claude.ai fetches that Protected Resource Metadata (RFC 9728); it names
   Supabase's auth server in `authorization_servers`
4. claude.ai fetches https://<ref>.supabase.co/.well-known/oauth-authorization-server
   (served natively by Supabase now) → learns authorize/token/registration/JWKS endpoints
5. claude.ai self-registers via DCR (fallback: pre-registered client)
6. Authorization code + PKCE: Supabase authenticates the owner, redirects to OUR
   consent page; owner approves; Supabase issues access + refresh tokens
7. claude.ai calls cerefox-mcp with the Bearer access token; the function validates
   the JWT against Supabase's JWKS and serves the full tool surface
```

The `resource_metadata` URL points at a **path the function itself serves** (step 2), so
compliant clients never fall back to probing the domain root — where GoTrue's metadata
(which is correct now anyway) would also work, but the explicit pointer removes ambiguity.

### 4.2 Components

**A. Supabase project configuration (dashboard / Management API — no code).**
- Enable **OAuth 2.1 Server** (Authentication → OAuth Server; config.toml equivalent:
  `[auth.oauth_server] enabled / authorization_url_path / allow_dynamic_registration`).
  Verified 2026-07-08: the feature is **beta, free during beta on all Supabase plans**.
- **Signing keys must be asymmetric (RS256/ES256) — a prerequisite, not a
  recommendation**: Supabase's default is HS256, and this design validates tokens against
  the public **JWKS** (§5 Path 2), which HS256 cannot serve; OIDC id tokens outright fail
  on HS256. If a project is on HS256, migrate first (a Supabase-managed key-rotation
  flow); legacy-anon-key clients are unaffected (they compare the key as an opaque
  string). **Maintainer project: verified already on ES256 (ECC P-256), Phase 0
  2026-07-08 — no migration needed.** Forks/other installs must still check.
- Configure **Site URL + Authorization Path** — "the authorization path is combined with
  your Site URL … to create the full authorization endpoint URL" (component B's URL).
  Cerefox doesn't use Supabase Auth emails today, so repointing Site URL is acceptable;
  verify no side effects during Phase 1.
- **DCR: leave DISABLED** (decision 2026-07-08). The dashboard flags open dynamic
  registration as a security risk (any client can self-register against the auth
  server); claude.ai's DCR against Supabase is failing in the wild anyway (#565); and a
  single-user system needs exactly one registered client. Use a **pre-registered OAuth
  App** instead (Authentication → OAuth Apps → New OAuth App, in Phase 4) — more secure
  and the working path today. `allow_dynamic_registration` stays `false`.
- Create the **owner user** in Supabase Auth (email + password). Cerefox has never had
  GoTrue users; the OAuth flow authenticates *as* this user.

**B. Consent page — a static HTML+JS page on an HTML-capable host.**

> **Live finding (2026-07-08): the consent page CANNOT be a Supabase Edge Function.**
> Supabase rewrites `text/html` → `text/plain` (+ `nosniff`) for GET responses on the
> default `*.supabase.co` domain (anti-phishing; discussions #35627 / #31238), so an
> EF-served page renders as source. Real HTML from an EF needs a Supabase **custom
> domain** (paid Pro add-on). The page is a single static file (all logic client-side),
> so it moves to any host that serves real HTML. This does NOT affect the discovery host
> (`cerefox-mcp` stays on `supabase.co`; the §5 custom-domain gotcha applies only there).
> The `cerefox-oauth-consent` EF (built) is kept as the **template source** for the static
> page; the deploy host is chosen from the options in the "Consent host" decision below.
>
> **[iter-28E update]** The `cerefox-oauth-consent` EF was **removed** in iter-28E. The
> consent page is now served **only** by the Cloudflare Worker (`cloudflare/cerefox-consent/`);
> the shared markup module `_shared/consent-page/` is retained (the Worker imports it).

**Consent host decision (2026-07-08): Cloudflare Worker (free).** The maintainer picked
zero-cost hosting over a Supabase custom domain. Markup lives once in
`_shared/consent-page/renderConsentPage()`; the Cloudflare Worker
(`cloudflare/cerefox-consent/`) serves it as real `text/html` from a free
`*.workers.dev` subdomain (no owned domain needed). The `cerefox-oauth-consent` EF renders
the same shared markup and is retained only for users who have a Supabase custom domain.
**[iter-28E update]** That EF was removed in iter-28E; the Cloudflare Worker is now the sole
consent page (the `_shared/consent-page/` markup module stays, imported by the Worker).
Options weighed: Cloudflare Worker (free, chosen) · GitHub Pages (free, static) · Supabase
custom domain (~$10/mo Pro add-on, keeps it in Supabase).

Supabase delegates the consent screen to us; it needs a stable public URL that serves
real HTML. The page:
- Signs the owner in via supabase-js (CDN import, publishable key — public by design).
- Receives the redirect with an `authorization_id` query parameter; fetches the pending
  authorization's details and renders "Allow *Claude* to access your Cerefox knowledge
  base?" with Approve / Deny.
- Uses the supabase-js `supabase.auth.oauth` namespace (verified against the docs
  2026-07-08): `getAuthorizationDetails(authorization_id)` to display client info and
  scopes, then `approveAuthorization(authorization_id)` or
  `denyAuthorization(authorization_id)` — both return a `redirect_url` to send the user
  back to the OAuth client.
- Two hard requirements from claude.ai field reports (`anthropics/claude-ai-mcp`):
  redirects back to the client must be **302/303, never 307** (claude.ai silently
  rejects 307 — issue #250), and an **already-consumed or unknown `authorization_id`
  must render a graceful "start over from Claude" message** — Claude's Reconnect
  button re-uses consumed authorization URLs and can double-submit approvals
  (issue #562).
- Holds **no secrets server-side**; everything runs client-side with the owner's session.
Alternatives considered: the local web app (not publicly reachable — rejected); static
hosting (GitHub Pages / Cloudflare Pages — works, but new infra and a second deploy
surface; keep as plan-B if EF-served HTML proves awkward).

**C. `cerefox-mcp` becomes a protected resource server (the core code work).**
Deployed with `verify_jwt = false` — the gateway no longer gates it, so **in-function
auth becomes the only gate** (see §5 and §6). Changes:
- Serve `GET <function-path>/.well-known/oauth-protected-resource` (RFC 9728):
  `resource` (**must match the MCP server URL exactly** — Anthropic requirement),
  `authorization_servers` with the project's auth-server **issuer URL
  (`https://<ref>.supabase.co/auth/v1`) as the first entry** (Anthropic reads the first),
  `bearer_methods_supported: ["header"]`, and supported scopes. Clients then fetch the AS
  metadata from the documented endpoints
  `…/auth/v1/.well-known/{oauth-authorization-server,openid-configuration}` (Supabase:
  "both endpoints return the same metadata").
- Return **401 + `WWW-Authenticate`** (with the explicit `resource_metadata` pointer) for
  missing/invalid tokens on the JSON-RPC surface.
- **Validate tokens in-function** (§5): OAuth access JWTs against JWKS, or the legacy
  static Bearer by constant-time comparison.
- Preserve the GET contract: `/version` (now auth-gated in-function, §6) and the new
  `.well-known` route are the only GETs answered; everything else stays **405** (Decision
  Log lesson — do not resurrect SSE polling).
- The token-validation logic lives in a new **`_shared/mcp-auth/`** module so it is unit
  testable with `bun test` (mocked JWKS) and reusable if the local server ever grows a
  remote HTTP mode (iter-30's deferred "remote HTTP-MCP" item).

**D. Client registration.**
Prefer **DCR** (zero manual steps). Claude's callback is
`https://claude.ai/api/mcp/auth_callback` (watch for a `claude.com` migration), client
name `Claude`. If DCR proves flaky or noisy (one-off `client_id` rows per connect),
fall back to **pre-registering** a client with that exact redirect URI (exact match, no
wildcards). CIMD is not yet supported by Supabase; Claude falls back to DCR when CIMD
isn't advertised, so DCR is the working path today (watch item, §11).
**Expect to need the pre-registration fallback**: `anthropics/claude-ai-mcp` issue #565
(2026-07-07, open) reports claude.ai DCR against the Supabase OAuth server failing with
"Couldn't register". The claude.ai connector dialog's "OAuth Client ID / Client Secret
(optional)" fields are the UI for the pre-registered path (confirmed on the
maintainer's account, Phase 0) — register via Authentication → OAuth Apps and paste.

### 4.3 What deliberately does NOT change

- **Primitive Edge Functions + GPT Actions**: untouched. `cerefox-mcp` is not in the GPT
  Actions OpenAPI block, so no `info.version` bump. ChatGPT stays on Custom GPT + GPT
  Actions (Developer-Mode MCP disables ChatGPT Memory — recorded lesson); an OAuth MCP
  connector for ChatGPT becomes *possible* later but is out of scope.
- **Local MCP server (`cerefox mcp`) and CLI**: untouched.
- **Schema / RPCs**: no `src/cerefox/db/` change → **no `schema_version` bump**. New
  server-side settings (the owner pin, the optional static-Bearer value) are **Edge
  Function secrets** (`supabase secrets set`), read via `Deno.env` — no DB round-trip on
  the auth hot path, and no schema change. (An earlier draft considered a `cerefox_config`
  row; secrets are cheaper per-request and equally single-user-safe.)
- **Existing client configs**: Claude Code / Cursor / Codex / Gemini / Desktop bridges
  keep sending the legacy anon JWT in `Authorization: Bearer` — unchanged.

### 4.4 Parallel quick win (test in Phase 0): claude.ai "Request headers" beta

Verified 2026-07-08 against Anthropic's connector docs: custom connectors now support
**static bearer/API-key auth in beta** — a "Request headers" section in the Add custom
connector dialog, restricted to an allowlist of header names **including
`authorization`** (value entered as `Bearer <token>`, stored securely, sent on every
request). It is a **slow rollout** ("contact Anthropic for early access") and the docs
frame it around organization admins, so availability on a personal account is unknown
until tried.

If the maintainer's account has it, pointing a connector at `cerefox-mcp` with the
legacy anon JWT should work **today with zero code changes** (the EF gateway already
accepts it) — full tool surface (ten tools at the time of this design; 15 core today) on claude.ai web and mobile. Phase 0 tests this
first. It does **not** replace the OAuth work: it's a beta under slow rollout with a
shared-credential model, it does nothing for other OAuth-discovering clients, and the
product story ("any MCP client can connect") still needs the standard flow. But it can
deliver the maintainer's primary use case immediately and serves as a fallback if the
Supabase beta misbehaves — a *second* escape hatch alongside §12.

> **Phase 0 outcome (2026-07-08): not available.** The maintainer's claude.ai "Add
> Custom Connector (beta)" dialog offers only Name, URL, and Advanced settings with
> "OAuth Client ID (optional)" / "OAuth Client Secret (optional)" — no Request-headers
> section. The rollout has not reached the account; the OAuth build proceeds as the
> only path. Useful confirmation from the same dialog: claude.ai supports
> **pre-registered client credentials**, so the §4.2-D DCR fallback (pre-register in
> Supabase → paste ID/secret into those fields) is a verified UI affordance.
> Connector name reserved by the maintainer: **CerefoxMCP** (distinct from the local
> stdio server's `cerefox` so both can coexist in Claude clients).

## 5. Token validation (the auth model, precisely)

Every request to the JSON-RPC surface must present `Authorization: Bearer <token>` that
passes ONE of:

**Path 1 — legacy static Bearer (back-compat).**
Constant-time equality against the expected anon JWT.
`staticBearer = CEREFOX_MCP_STATIC_BEARER ?? SUPABASE_ANON_KEY ?? null`.
**[iter-28E update]** This anon-JWT static path was replaced in iter-28E: the static arm now
constant-time-compares against the rotatable **Cerefox access token** (`CEREFOX_ACCESS_TOKENS`);
`CEREFOX_MCP_STATIC_BEARER` and the anon-JWT fallback are gone. See
`docs/specs/ef-auth-migration-design.md`.
**Decision (2026-07-08, maintainer):** default to the platform-injected
`SUPABASE_ANON_KEY` — which is exactly what existing clients send — and treat the
explicit `CEREFOX_MCP_STATIC_BEARER` secret as an **escape hatch**, set only if the
injected var proves unreliable (the 2026-03-14 Decision Log flagged `SUPABASE_ANON_KEY`
as "sometimes undefined", but that was the original always-on gateway-redundant check;
here it is a fallback, and the maintainer primarily uses the local MCP that never touches
this path, so the blast radius of a miss is small). Whichever source is used, the check
*tightens* auth versus the old gateway (which accepted any valid project JWT). **Fail
closed**: if neither source is available at request time, Path 1 rejects everything
rather than accepting everything. No blocking deploy preflight — `cerefox server deploy`
prints a reminder; a missing static value cannot *open* the function (it only breaks old
clients, who then show `bad_signature`/`malformed_token` in the logs).

**Path 2 — OAuth access token.**
JWT validation against the project JWKS
(`https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`):
- **Algorithm allowlist**: RS256/ES256 only (never `none`, never HS256 — prevents
  key-confusion between the legacy HS256 anon JWT and asymmetric user tokens).
- `iss` = `https://<ref>.supabase.co/auth/v1`; `exp`/`nbf` with small clock skew.
- `aud` = `"authenticated"` (the documented value; verified 2026-07-08). RFC 8707
  resource-audience binding is **not supported** by Supabase's OAuth server — the token
  is project-scoped, not resource-scoped, which is acceptable here because the project
  hosts exactly one protected resource. Documented claims: `sub` (user UUID), `email`,
  `role` (`authenticated`), `aud`, `iss`, and the OAuth-specific `client_id`.
- Grant types issued: `authorization_code` (+PKCE) and `refresh_token` only
  (`client_credentials`/`password` explicitly unsupported — fine for this flow).
- **Owner check** (single-user) — **this is the authorization boundary, not optional
  hardening.** `sub` must equal the pinned owner user id, from the `CEREFOX_OAUTH_OWNER_ID`
  Function secret (a server-side value only; never entered into claude.ai). If unset, the
  function accepts *any* validly-signed `authenticated` token from the project's auth
  server — and **because Supabase enables email sign-ups by default, an attacker could
  self-register via `/auth/v1/signup` and obtain an accepted token**. Pinning the owner
  (or disabling public sign-ups) closes that hole; for a "every byte is sensitive" system,
  pin it. Maintainer owner UUID (Phase 1, 2026-07-08):
  `0b850e27-27b6-48eb-b019-e208fb7f92e7`.
- JWKS fetched with in-isolate caching (EF isolates are short-lived; a simple in-memory
  cache with TTL is enough — key rotation is picked up on isolate recycle or TTL expiry).
- Use a vetted JWT library (`jose` via npm/esm specifier in Deno) — no hand-rolled JWT
  parsing.

On success, the function proceeds exactly as today: **service-role key internally for DB
work** (single-implementation principle unchanged; RLS-scoped user access is available if
multi-user ever happens, not now). The usage log gains nothing new structurally — but the
handler should record the auth path (`oauth` vs `static`) in the existing `requestor`/
`access_path` conventions where useful for the audit trail.

## 6. Security invariants (audit checklist input for Iteration 28)

`verify_jwt = false` removes the platform gate; these invariants replace it and are
explicit audit items for the v1.0 security audit (`docs/specs/security-model.md`):

1. **Auth-first dispatch**: token validation runs before *any* method dispatch, tool
   lookup, or DB touch. The only unauthenticated responses the function ever produces:
   the RFC 9728 metadata document (public by spec), the 401 challenge, 405s, and CORS
   preflight. Nothing else leaks — not `/version` (now requires auth in-function; EF
   version info is low-sensitivity but stays gated as before), not error details.
2. **Fail closed** on both paths (§5): missing secret → Path 1 rejects; JWKS unreachable
   → Path 2 rejects (no "temporarily open" fallback).
3. **Constant-time comparison** for the static token.
4. **Algorithm allowlist** on JWT verification (no HS256 on Path 2, no `none` anywhere).
5. **405-for-GET preserved** for everything except `/version` and the `.well-known` route
   (quota-burn regression guard, not just spec hygiene).
6. **Deploy-time flag audit**: `--no-verify-jwt` applies ONLY to `cerefox-mcp` and
   `cerefox-oauth-consent`. The 8 primitive EFs keep gateway verification. The per-EF
   flag map lives in code (`deploy-server.ts` + `_shared/db-deploy/`), not in operator
   memory, and the flag must be passed on **every** deploy of those functions (the CLI
   default re-enables verification otherwise — a silent regression that would break
   OAuth clients; conversely, forgetting it never *opens* anything, it only breaks).
   **[iter-28E update]** Superseded: since iter-28E `--no-verify-jwt` applies to **all
   data EFs** (`cerefox-mcp` + the 8 primitive EFs), which now gate in-function on the
   Cerefox access token; the `cerefox-oauth-consent` EF was removed. See
   `docs/specs/security-model.md` §4 and `docs/specs/ef-auth-migration-design.md`.
7. **Consent page holds no secrets**; approve/deny happens under the owner's GoTrue
   session; the page validates the `authorization_id` against the API rather than
   trusting query-string content for display.
8. **Redirect URIs are exact-match** (no wildcards) whether DCR-created or pre-registered.
9. The peer `/version?peers=true` aggregator keeps forwarding the caller's auth to peer
   EFs (they still sit behind the gateway).

## 7. Repo changes (file-level map)

| Area | Change |
|---|---|
| `supabase/functions/cerefox-mcp/index.ts` | Auth-first dispatch; `.well-known` route; 401+`WWW-Authenticate`; auth-gate `/version` in-function |
| `_shared/mcp-auth/` (new) | Token validation: static compare + JWKS JWT verification; unit-testable, mocked in tests |
| `supabase/functions/cerefox-oauth-consent/` (new) | Public consent page EF (static HTML+JS, supabase-js CDN) |
| `packages/memory/src/cli/commands/deploy-server.ts` | Per-EF deploy-flag map (`--no-verify-jwt` for the two functions); secret preflight |
| `_shared/ef-meta/` | Add `cerefox-oauth-consent`?? — **no**: it's not a peer with a `/version` surface worth aggregating; decide at build time (default: leave out) |
| `_shared/compatibility/index.ts` | Review `minEdgeFunctions` — OAuth is additive for existing clients, so likely **no** bump (bump only if a client release depends on the new EF behavior) |
| `packages/memory/src/cli/commands/doctor.ts` | Optional: OAuth-config checks (owner pinned, secret set) — nice-to-have, Phase 5 |
| `docs/guides/connect-agents.md` | New "Claude.ai / Claude mobile (OAuth)" section; client matrix rows flip to supported |
| `docs/guides/setup-supabase.md` | OAuth 2.1 Server setup section (enable, Site URL/Authorization Path, DCR, owner user, secrets) |
| `docs/research/oauth-mcp-auth.md` | Resolution note: native OAuth path shipped; revise takeaways |
| `CLAUDE.md` | Client-compat matrix + three-layer auth section gain the OAuth path |
| `CHANGELOG.md` | `[Unreleased]` entries as work lands |

`EF_VERSION` bumps with the release as usual (via `cut_release.ts`).

## 8. Testing

- **Unit (`bun test`, no network)**: `_shared/mcp-auth/` — valid/expired/wrong-iss/
  wrong-alg/HS256-downgrade/garbage tokens against a mocked JWKS; static-path constant
  compare incl. unset-secret fail-closed; 401 challenge shape; metadata document shape;
  405 matrix (GET/PUT/DELETE on non-well-known paths).
- **Live remote-MCP e2e (opt-in, `CEREFOX_LIVE_E2E=1`)**: extend
  `packages/memory/test/mcp-remote/` with: unauthenticated → 401 + parseable
  `WWW-Authenticate`; `.well-known` fetch → valid RFC 9728 doc naming the auth server;
  legacy-Bearer tool call still works. (Full OAuth dance is not automatable here — it
  needs an interactive consent; cover it manually in Phase 4.) Keep EF-quota discipline:
  narrowest file, `requestor: "e2e-test"`.
- **Manual acceptance (Phase 4/5)**: claude.ai connector end-to-end (discovery → DCR →
  consent → tokens → all 15 core tools); same connector on Claude mobile; regression matrix
  for Claude Code / Cursor / Claude Desktop (supergateway) / Codex on static Bearer;
  GPT Actions untouched-but-verified; watch EF logs for the full handshake.

## 9. Phased plan

- **Phase 0 — Preflight**: check whether the claude.ai "Add custom connector" dialog
  offers the beta **Request headers** section (§4.4) — if yes, connect with the legacy
  anon JWT and test the full tool surface on web + mobile (immediate value + a working
  baseline while OAuth is built). Confirm OAuth 2.1 Server availability in the project's
  dashboard; check current signing-key algorithm; re-verify the §14 claims that matter
  for the next phase.
  **✅ DONE 2026-07-08**: Request-headers beta NOT on the account (§4.4 outcome note);
  OAuth Server present on the plan (disabled, Authentication → OAuth Apps / Configuration
  → OAuth Server); signing keys **already ES256 (P-256)** — no migration needed; Site URL
  is the unused `http://localhost:3000` default (repointing is risk-free; Redirect URLs
  allowlist empty).
- **Phase 1 — Supabase config**: enable OAuth server + DCR; create owner user; set
  Site URL + Authorization Path; set `CEREFOX_MCP_STATIC_BEARER` secret; pin
  `oauth_owner_user_id` config row. No code.
- **Phase 2 — Consent page**: build + deploy `cerefox-oauth-consent`; verify the
  approve/deny round trip with a manual OAuth test client before Claude ever connects.
- **Phase 3 — Resource server**: `_shared/mcp-auth/` + `cerefox-mcp` changes + deploy
  flag map; unit tests green; deploy; verify legacy clients unaffected.
- **Phase 4 — Connect Claude**: add the claude.ai custom connector; watch the full
  handshake in EF logs; then verify Claude mobile (same connector, synced).
- **Phase 5 — Regression + hardening**: full client matrix; optional `doctor` checks;
  live e2e additions.
- **Phase 6 — Document + log**: guides, matrices, `oauth-mcp-auth.md` resolution,
  CHANGELOG; Decision Log entry (KB) + update the KB handoff doc's status.

## 10. Iteration & versioning

This ships inside **Iteration 28 (v1.0.0)** — decision 2026-07-08 (maintainer preference,
agreed): the feature and the stability commitment travel together so the one-time
**security audit covers the new OAuth surface in the same pass** (auditing v1.0 and then
re-auditing a v1.1 auth rework would be double work, and "every public endpoint requires
auth" — the audit's headline item — must be re-stated around the two deliberately-public
routes this design introduces). Iterations 29+ keep their numbers.

Sequencing inside the iteration: OAuth work first (28A), then the audit (28B) over the
final surface, then the v1.0 contract/stamp (28C). One caveat the maintainer should hold:
Supabase's OAuth server is **beta** — if Phase 4 shows instability, prefer soaking the
OAuth feature in a `1.0.0-beta` pre-release and stamping `v1.0.0` after it settles, rather
than delaying or shipping a shaky 1.0. The plan structure supports either cut.

## 11. Risks and watch items

(Platform claims re-verified against live docs 2026-07-08 — see §14. Supabase ships
constantly; re-verify §14 before each phase that depends on a claim.)

- **Beta surface**: OAuth 2.1 Server is beta (free during beta on all plans); budget
  debugging time for session/consent rough edges. Fallbacks exist (§4.4, §12).
- **Custom domains break discovery**: confirmed still broken as of 2026-07-08
  (maintainer acknowledged 2026-02-17, no fix announced). The MCP URL must stay on
  `<project-ref>.supabase.co`. (The consent page may live anywhere.)
- **CIMD vs DCR**: Supabase still ships only DCR (community implementation offer of
  2026-04 unanswered). Anthropic's docs confirm Claude **falls back to DCR** when CIMD
  isn't advertised, so we're fine today. If Anthropic ever mandates CIMD before Supabase
  ships it, revisit (likely via the fallback proxy). Related upstream wart (2026-06): DCR
  strict port-matching breaks RFC 8252 loopback-callback clients — irrelevant for
  claude.ai (fixed HTTPS callback) but worth knowing if desktop OAuth clients appear.
- **DCR noise**: repeated connects may accumulate one-off client registrations; if so,
  pre-register (§4.2-D).
- **MCP protocol version**: the EF pins `2025-03-26`; the OAuth discovery flow is
  transport-level and version-independent, but verify claude.ai accepts the negotiated
  version during Phase 4 (bump the protocol surface if required — separate, mechanical).
- **EF invocation quota**: a cloud Claude user burns ~1 invocation per tool call (as any
  remote client does) plus a handful per OAuth handshake; acceptable, but heavy automated
  use should still prefer the local stdio server (recorded cost lesson).
- **Site URL repointing**: verify no latent dependency on the current Site URL value
  (password-reset emails etc.) — Cerefox has no GoTrue users today, so expected clean.
- **Signing-key migration**: moving HS256 → asymmetric is a prerequisite (§4.2-A);
  legacy-anon-key clients are unaffected (opaque string compare), but treat the
  migration as its own verified step in Phase 1, not a footnote.
- **Known claude.ai platform failure modes** (from `anthropics/claude-ai-mcp`, the
  official claude.ai-MCP tracker — check it before and during Phase 4, and file
  server-developer reports there if we hit a wall):
  - **#565** (open, 2026-07-07): DCR against Supabase OAuth server fails ("Couldn't
    register") → go straight to the pre-registered client (§4.2-D).
  - **#354 / #335 / #304 / #275** (recurring; #304 is Supabase-Auth-based): OAuth
    completes, token endpoint returns 200, **claude.ai never sends an authenticated
    MCP request**. Mostly closed "not planned". If we hit this and can't resolve it
    (first suspects: PRS `resource` not byte-identical to the connector URL;
    WWW-Authenticate still returned after valid auth), that is the §12 fallback
    trigger.
  - **#482** (closed): post-OAuth requests arrive **without** the Authorization header
    → 401 loop. Distinguish from the above by EF logs (requests arrive, no token).
  - **#476** (open): handshake + OAuth fine, tools never surface to the model on
    claude.ai web (same server fine in Claude Code/ChatGPT).
  - **#250**: 307 redirects silently rejected (consent page must 302/303 — §4.2-B).
  - **#562**: Reconnect re-uses consumed authorization URLs (consent page must handle
    idempotently — §4.2-B).
  - **#561** (open): connectors occasionally removed without warning / can't re-add —
    platform flakiness to keep in mind before blaming our own stack.
- **OSS-framing open items (revisit before shipping to users, 2026-07-08):**
  - **Cloud-agent support is an OPTIONAL, feature-scoped add-on** — most users connect via
    local/desktop clients and never touch OAuth or the consent page. Frame it that way in
    the guides so the "free tier is enough" story is unaffected. The consent page costs $0
    on Cloudflare/GitHub Pages; the only friction is one static-hosting step (candidate
    reductions: a `cerefox` command that emits the configured page, or a Cerefox-hosted
    shared consent page).
  - **Is the anon key really a "secret"? (maintainer note, 2026-07-08)**
    `CEREFOX_MCP_STATIC_BEARER` is set via `supabase secrets set`, but the anon JWT is
    **public by design** — the secrets mechanism is used purely as an env-var delivery
    channel, not for secrecy. The same value is baked into the Cloudflare Worker `[vars]`
    (also public). Before the OSS release, decide the cleanest framing: (a) document
    explicitly that this "secret" is a public value delivered via the secrets CLI, and/or
    (b) note it's only needed where the platform-injected `SUPABASE_ANON_KEY` fails to
    authenticate in-function (it DID fail on the maintainer project — hence required here —
    but a project where the injected var works could skip it entirely).
  - **ChatGPT-via-MCP is a weak beneficiary**: it needs developer mode, which disables
    ChatGPT Memory (Decision Log 2026-03-14). The honest audience for the OAuth work is
    **claude.ai web + Claude mobile**; say so rather than overselling ChatGPT.

## 12. Fallback: Cloudflare Worker OAuth proxy (build only if §11 bites)

A thin Worker on its own domain (free tier: 100K req/day) owns its own `/.well-known`,
implements the OAuth provider handshake via Cloudflare's open-source OAuth Provider
library, presents consent, and proxies authenticated calls to `cerefox-mcp` with the
static Bearer. Claude does OAuth against the Worker and never touches GoTrue. Cost ≈ $0;
effort ≈ 1–2 days; the price is a second service to maintain forever — which is exactly
why it's the fallback. Trigger: the native path fails in a way we cannot resolve
(discovery bug, DCR incompatibility, CIMD mandate before Supabase support).

## 13. References

- Supabase OAuth 2.1 Server: overview `https://supabase.com/docs/guides/auth/oauth-server`;
  getting started `…/oauth-server/getting-started`; MCP authentication
  `…/oauth-server/mcp-authentication`; flows `…/oauth-server/oauth-flows`;
  launch post `https://supabase.com/blog/oauth2-provider`
- Custom-domain discovery gotcha: `https://github.com/orgs/supabase/discussions/38022`
- CIMD vs DCR: `https://github.com/orgs/supabase/discussions/41695`
- Claude connector auth (OAuth required; callback URL; CIMD/DCR):
  `https://claude.com/docs/connectors/building/authentication`,
  `https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers`
- claude.ai MCP tracker (bug reports + announcements — watch during Phase 4):
  `https://github.com/anthropics/claude-ai-mcp` (issues #565, #562, #482, #476, #354,
  #335, #304, #275, #250 catalogued in §11)
- RFC 9728 (Protected Resource Metadata); RFC 8414 (AS metadata); RFC 8707 (resource
  indicators)
- FastMCP `SupabaseProvider` (pattern reference only — Python, not a drop-in):
  `https://gofastmcp.com/integrations/supabase`
- Repo: `docs/research/oauth-mcp-auth.md` (the 2026-03 analysis this supersedes);
  `supabase/functions/cerefox-mcp/index.ts`; `docs/guides/connect-agents.md`
- KB: handoff doc `92996524-2923-4c7d-864b-7ae52f1bbb28`; Decision Log 2026 Q1 Part 1
  (GoTrue-era failures), Q1 Part 2 (405/SSE lesson), Q2 Part 1 (key-system asymmetry,
  Option B sketch)

## 14. Platform-claim verification record (2026-07-08, live docs)

Supabase and Anthropic ship changes constantly; the handoff research (2026-07-07) was
done without live tooling, so every load-bearing claim was re-verified against the live
docs on 2026-07-08. Re-check the relevant rows before each phase.

| # | Claim | Verdict (2026-07-08) |
|---|---|---|
| 1 | OAuth 2.1 Server exists, authorization_code+PKCE | ✅ Confirmed; **beta, free during beta on all plans**; also issues `refresh_token`; `client_credentials`/`password` unsupported |
| 2 | DCR supported, dashboard/config toggle | ✅ Confirmed (`allow_dynamic_registration`, default **disabled**); CIMD still **unshipped** (Apr-2026 community offer unanswered) |
| 3 | Valid AS discovery metadata served | ✅ Confirmed at `…/auth/v1/.well-known/{oauth-authorization-server,openid-configuration}` ("interchangeable") |
| 4 | Custom domains break `.well-known` discovery | ✅ Still broken (maintainer ack 2026-02-17, no fix) — MCP URL stays on `<ref>.supabase.co` |
| 5 | EF gateway is JWT-only; new `sb_…` keys rejected; `--no-verify-jwt` is the sanctioned escape | ✅ Confirmed (collaborator, 2026-01-10: "It is required to use --no-verify-jwt if you call them with anon (publishable) or service_role (secret) key") |
| 6 | Consent page via Site URL + Authorization Path; supabase-js approve/deny | ✅ Confirmed; exact API: `supabase.auth.oauth.{getAuthorizationDetails,approveAuthorization,denyAuthorization}` → `redirect_url`; redirect carries `authorization_id` |
| 7 | Asymmetric signing keys | ⚠️ **Sharpened**: HS256 is still the platform default; asymmetric is *required* for JWKS-based validation + OIDC id tokens. **Maintainer project verified already on ES256 (P-256) in Phase 0** — prerequisite satisfied; forks must check. JWKS at `…/auth/v1/.well-known/jwks.json` |
| 8 | Token claims | ✅ `sub`, `email`, `role`, `aud:"authenticated"`, `iss`, `client_id`; **no RFC 8707** resource binding |
| 9 | claude.ai connectors require OAuth; callback `https://claude.ai/api/mcp/auth_callback`; CIMD→DCR fallback | ✅ Confirmed, **with one change**: beta slow-rollout **static "Request headers" auth** now exists (§4.4). PRS `resource` must exactly match the server URL; `authorization_servers[0]` is what Claude reads |
