# Design: migrate Edge Function auth off the unrotatable legacy anon JWT (iter-28E)

> **Status**: Design-of-record (2026-07-09). Not started. Work lands on a new branch
> `feat/ef-auth-token` (off `feat/oauth-mcp` — so the OAuth/security context is present).
> Target: **v0.12.0-beta** (executed carefully/defensively, extensively tested), before the
> 1.0.0 freeze. Plan entry: `docs/plan.md` Iteration 28E + the "Release sequencing" note.
>
> **Read-this-first context for a fresh session** (post-compaction): Cerefox is a single-user
> KB on Supabase (Postgres + pgvector + Edge Functions). Iteration 28A made `cerefox-mcp` an
> OAuth 2.1 protected resource with **in-function auth** (`_shared/mcp-auth/`), deployed
> `--no-verify-jwt`. Iteration 28B's security audit (see `docs/specs/security-model.md` +
> Decision Log Q3 Part 1 in the KB) closed a Data-API RPC bypass and found that the **legacy
> anon JWT is a full-KB credential**. On projects migrated to ES256 signing keys, that anon
> JWT **can only be revoked, not rotated** — so a leak can't be cycled without killing the EF
> path. `CEREFOX_MCP_STATIC_BEARER` (the anon-JWT accepted by `cerefox-mcp`'s static path) was
> already **removed** on the maintainer project. This iteration replaces the legacy anon JWT
> across **all** Edge Function paths with a rotatable, Cerefox-managed access token.

## 1. Problem

The Supabase **Edge Function gateway is JWT-only** — it rejects the new
`sb_publishable_`/`sb_secret_` keys (Decision Log Q2 Part 1, 2026-05-18). So today:
- the **8 primitive EFs** (`cerefox-search`, `cerefox-ingest`, `cerefox-metadata`,
  `cerefox-get-document`, `cerefox-list-versions`, `cerefox-get-audit-log`,
  `cerefox-metadata-search`, `cerefox-list-projects`) are gateway-verified and authenticate
  callers with the **legacy anon JWT** (used by ChatGPT **GPT Actions** and **direct HTTP**);
- `cerefox-mcp`'s **static-Bearer** path (remote MCP clients that don't do OAuth) also used
  the legacy anon JWT.

On an ES256-migrated project the legacy anon JWT is **unrotatable** (revoke-only, and
revoking kills the whole EF path). A leaked anon key therefore can't be cycled — a real
security gap for **every** Cerefox user on the EF/GPT-Actions/remote-static-MCP path.

## 2. Decision — a Cerefox-managed access token (NOT a Supabase key)

The caller credential becomes a **random, Cerefox-owned access token**, validated in-function.

**Rejected alternatives (record why):**
- `sb_publishable_` — *public by design* (it's embedded in the consent Worker HTML, shipped
  to clients). Cerefox has **no RLS** on the EF path (EFs use `service_role` internally), so
  gating on a public key = **no access control**: anyone who reads it gets full KB access.
- `sb_secret_` — full-DB (service_role). Placing it in a client config (GPT Action / MCP
  client) means a client compromise = full DB access via the Data API. Too powerful client-side.

The Cerefox token is: **secret** (real access control), **rotatable** (regenerate + re-issue),
**scoped** (grants EF access only; the EF's own `service_role` never leaves the server), and
independent of Supabase's key lifecycle. Same pattern as `cerefox-mcp`'s in-function auth and
OB1's `MCP_ACCESS_KEY`.

## 3. Architecture

- **All data EFs run `--no-verify-jwt`** (the gateway stops gating; in-function auth is the
  only gate — extends the `NO_VERIFY_JWT_EFS` set from `{cerefox-mcp, cerefox-oauth-consent}`
  to include the 8 primitive EFs). `cerefox-oauth-consent` stays public (no auth — it's the
  consent page). `cerefox-mcp` already `--no-verify-jwt`.
- **In-function token check** on every data EF: read the incoming credential from
  `Authorization: Bearer <token>`, constant-time-compare against a set of accepted tokens.
- `cerefox-mcp` accepts **OAuth JWT (owner-pinned) OR a Cerefox token** (its static path,
  re-added — replacing the removed anon-JWT one). The 8 primitive EFs accept **a Cerefox
  token** (no OAuth — GPT Actions/HTTP clients don't do OAuth).
- Internally, EFs keep using `SUPABASE_SERVICE_ROLE_KEY` to call the RPCs (unchanged).

## 4. The token

- **Format:** a random 256-bit secret, base64url, prefixed for identifiability, e.g.
  `cfx_pat_<43chars>`. (Prefix helps gitleaks/humans recognize it.)
- **Storage (server):** a Supabase **Function secret** holding the accepted set:
  `CEREFOX_ACCESS_TOKENS` = comma-separated list (support **multiple** for zero-downtime
  rotation — accept old + new during a cutover). Set via `supabase secrets set`.
- **Distribution (clients):** the token goes into client configs (GPT Actions header, remote
  MCP client header). Automated by the CLI (§7).
- **Rotation:** add a new token to the set → migrate clients → remove the old. No downtime.

## 5. In-function auth (shared helper)

Add a small **`_shared/ef-auth/`** module (Web-Platform-only, runs under Deno + Bun, like
`_shared/mcp-auth/`), or extend `_shared/mcp-auth/`:

```
checkAccessToken(authorizationHeader, {
  tokens: string[],          // from CEREFOX_ACCESS_TOKENS
  legacyBearer?: string|null // legacy anon JWT accepted during the deprecation window
}): { ok: true, path: "token"|"legacy" } | { ok: false, reason }
```

- Constant-time compare (reuse `constantTimeEqual` from `_shared/mcp-auth/`).
- **Fail closed**: if `tokens` is empty and no `legacyBearer`, reject everything (never
  accept-all). `cerefox server deploy` must warn if it deploys token-gated EFs with no token set.
- Log the reason on rejection (never the token); `console.log` a warn when the **legacy** path
  is used (so the maintainer sees remaining legacy usage before dropping it).
- `cerefox-mcp` composes: OAuth JWT (existing `_shared/mcp-auth`) OR `checkAccessToken`.
- The 8 primitive EFs: `checkAccessToken` only. Refactor their shared request handling
  (they each build a Supabase client + parse the request) to call the check first — put the
  gate in one shared place they already import if possible (`supabase/functions/*/shared.ts`
  or a new `_shared/ef-auth` used by each `index.ts`).

## 6. Back-compat / deprecation window (CRITICAL for defensive rollout)

During migration the EFs accept **BOTH**: the new Cerefox token(s) **and** the legacy anon
JWT (via `legacyBearer` = the known anon JWT value, set as a Function secret
`CEREFOX_LEGACY_ANON_BEARER` during the window — same static-compare mechanism as the removed
`CEREFOX_MCP_STATIC_BEARER`). Warn on legacy use. After all clients migrate, **unset**
`CEREFOX_LEGACY_ANON_BEARER` → only tokens accepted → the legacy anon JWT is fully deprecated.

**This unlocks completing the 28B anon-key rotation:** once *no* EF accepts the legacy anon
JWT, the maintainer can **revoke the legacy HS256 secret** in Supabase → the exposed anon key
is fully neutralized (closes the 28B residual risk).

## 7. CLI automation (minimize friction)

- **`cerefox token generate` / `rotate` / `list`** (new command group): generates a random
  token, sets/updates `CEREFOX_ACCESS_TOKENS` (via `supabase secrets set`, needs the Supabase
  CLI + project), prints the token, and records it where clients need it. `rotate` adds a new
  token and (after confirmation) drops the oldest.
- **`cerefox server deploy`** generates a token on first deploy if none exists; warns loudly
  if the token-gated EFs would deploy with no token (fail-closed footgun).
- **`cerefox configure-agent`** writes the token into remote-MCP client configs (it already
  writes MCP configs; swap the anon key for the token for the *remote* transport).
- The token is a **secret** — never commit it; `.env` / Function secret / client config only.
  Add it to the gitleaks allowlist patterns (recognize `cfx_pat_`), and ensure it's not
  printed to logs.

## 8. GPT Actions OpenAPI + docs

- Update the **GPT Actions OpenAPI block** in `docs/guides/connect-agents.md`: security scheme
  → the Cerefox token in `Authorization: Bearer` (or an `apiKey` header), **bump `info.version`**
  (SemVer). Note: ChatGPT resets a Custom GPT's stored key when the schema changes (known
  gotcha) — users re-enter the token.
- **Migration guide** (new section in `connect-agents.md` + a pointer from the CHANGELOG) for
  the two client classes: **ChatGPT GPT Actions** and **remote static-Bearer MCP** — "get your
  token with `cerefox token …`, replace the anon key in your client config." Note the
  back-compat window (old anon JWT still works, with a warning, until the token is required).
- Update `docs/guides/access-paths.md`, `setup-supabase.md`, `CLAUDE.md` (Layer-1 auth +
  client-compat matrix), and `docs/specs/security-model.md` (new invariant: all data EFs are
  in-function-auth'd on a rotatable token; the legacy anon JWT is deprecated/removed).

## 9. Deploy changes

- `packages/memory/src/cli/commands/deploy-server.ts`: extend `NO_VERIFY_JWT_EFS` to the 8
  primitive EFs; keep the post-deploy reminder (now: "set `CEREFOX_ACCESS_TOKENS`; optional
  `CEREFOX_LEGACY_ANON_BEARER` during the deprecation window").
- Bundle `_shared/ef-auth` into `dist/server-assets/_shared/` (`scripts/bundle_server_assets.ts`
  — add `"ef-auth"` to the subtree list, like `mcp-auth`).
- No schema change (this is EF/auth only) → **no `schema_version` bump**.

## 10. Testing (extensive — this is security)

- **Unit (`bun test`, `_shared/__tests__/`):** `checkAccessToken` — accepts a valid token,
  rejects garbage, rejects empty header, constant-time, accepts the legacy bearer only when
  `legacyBearer` set, **fails closed** when no tokens + no legacy, multiple-token set.
- **Live EF e2e (opt-in `CEREFOX_LIVE_E2E=1`, narrowest file):** each primitive EF with the
  token → 200; with the legacy anon JWT during the window → 200 + warn; with garbage → 401;
  with the token unset server-side → 401 (fail closed). Keep EF-quota discipline (`requestor:
  "e2e-test"`).
- **`cerefox-mcp`:** OAuth path still works; token static path works; garbage → 401.
- **Regression:** existing EF e2e suites migrated to the token; `cerefox doctor` still works
  (its `/version` aggregator now needs the token, not the anon key).

## 11. Defensive rollout order (avoid locking yourself out)

1. Implement + unit-test the shared check.
2. Deploy the EFs with **BOTH** accepted (set `CEREFOX_ACCESS_TOKENS` AND
   `CEREFOX_LEGACY_ANON_BEARER`=current anon JWT). Nothing breaks — existing clients keep
   working via legacy; new token also works. **Verify live before proceeding.**
3. Migrate clients to the token (GPT Actions re-enter; remote MCP re-configure; `doctor`/CLI
   to the token).
4. Watch the "legacy path used" logs go quiet.
5. **Unset `CEREFOX_LEGACY_ANON_BEARER`** → token-only. Verify.
6. **Then revoke the legacy HS256 secret** in Supabase → the exposed anon key is dead (closes
   28B ①). Verify OAuth (cloud Claude) + local MCP + token EFs all still work (none use the
   legacy secret).

## 12. Risks

- **Lockout** if steps are reordered — mitigated by back-compat-first (§11). Never tighten
  before migrating clients + verifying.
- **Token leakage** in client configs (esp. ChatGPT) — it's a secret, but rotatable (the whole
  point). Document safe handling; never commit; gitleaks pattern.
- **"Every public endpoint requires auth"** (28B invariant) — this *strengthens* it: after
  28E, the only unauthenticated surfaces are the consent page + `cerefox-mcp`'s RFC 9728
  metadata/401. State that in `security-model.md`.
- **`doctor` / internal callers** that used the anon key must switch to the token.

## 13. References

- `_shared/mcp-auth/` (iter-28A in-function auth; reuse `constantTimeEqual`, the fail-closed +
  logging patterns). `supabase/functions/cerefox-mcp/{index,oauth}.ts` (the pattern to mirror).
- `docs/specs/security-model.md` (§1 credentials, §4 OAuth invariants — update for 28E).
- `docs/specs/oauth-mcp-server-design.md` (the sibling iter-28A design).
- Decision Log Q3 Part 1 (KB, private) — the 2026-07-09 security entry (RPC bypass, anon-key
  rotation blocked by the ES256/gateway constraint — the direct motivation for 28E).
- Decision Log Q2 Part 1 (KB) — the original "Option B" sketch (2026-05-18) this executes.
- GPT Actions OpenAPI block: `docs/guides/connect-agents.md` (keep in sync per CLAUDE.md rule).
