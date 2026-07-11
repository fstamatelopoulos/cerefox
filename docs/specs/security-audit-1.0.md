# Pre-1.0.0 defensive security review

Status: complete (beta.3). Scope: a defensive read of Cerefox's own
security-sensitive surfaces before the 1.0.0 release, to find and fix hardening
gaps. This is a review of our own code — it records what was checked, what was
already solid, and the low-severity hardening applied. It deliberately omits
exploit detail.

## Method / scope

Read-through of the highest-risk surfaces:

- **Auth**: the Cerefox access-token check (`_shared/ef-auth/`) and the OAuth 2.1
  JWT validator (`_shared/mcp-auth/`), plus how `cerefox-mcp` wires them.
- **Database**: the 30 `SECURITY DEFINER` RPCs (`src/cerefox/db/rpcs.sql`) —
  `search_path` pinning and `EXECUTE` privileges.
- **Edge Functions**: input bounds, error/info disclosure, CORS.
- **Web server + SPA**: default bind, request auth, the `/rest/v1` proxy, and
  markdown rendering (stored-XSS).
- **CLI**: subprocess handling (command injection) and secret handling.
- Secret logging across all three runtimes.

## Verified solid (no change needed)

- **Constant-time token compare**, fail-closed when the accepted set is empty,
  no short-circuit across the set, token value never logged (`ef-auth`).
- **OAuth JWT**: algorithm allowlist enforced *before* any crypto (rejects
  `none`/HS256 — the alg-confusion defense), key type matched to alg, and all of
  `iss`/`aud`/`exp`/`nbf`/`sub` validated. The owner pin **fails closed** when
  unset (no accidental accept-any-user). Constant-time static path.
- **401 challenge** returns only `{ error }` + an RFC 9728 `WWW-Authenticate`
  header — the enriched claim `detail` goes to dashboard logs only, never the client.
- **All 30 `SECURITY DEFINER` functions pin `search_path`.**
- **`EXECUTE` revoked** from `PUBLIC`/`anon`/`authenticated`, granted only to
  `service_role`.
- **No command-injection surface**: every `spawnSync`/`spawn` uses the array-args
  form; no `shell: true`, no shell string interpolation.
- **Web server binds `127.0.0.1` by default** (loopback); `--host 0.0.0.0` is an
  explicit opt-in, and the cloud-run guide documents adding auth for exposure.
- **No stored XSS**: the SPA renders with `react-markdown` (v10) and **no
  `rehype-raw`** and no `dangerouslySetInnerHTML`, so raw HTML in document content
  is escaped to text, and dangerous URL schemes are stripped by default.
- **No secret logging**: no token/key value is written to `console.*`.
- **`/rest/v1` proxy** (local self-hosted only, gated by
  `CEREFOX_POSTGREST_UPSTREAM`) targets a fixed upstream host — the client
  controls only the path, so there is no host-redirection / SSRF.

## Findings + disposition

| # | Area | Severity | Finding | Disposition |
|---|---|---|---|---|
| 1 | `cerefox-search`, `cerefox-metadata-search` | Low | `match_count` / `limit` were unbounded — the response is byte-capped but the query work (vector sort / FTS ranking / row scan) was not, so an *authenticated* caller could request an oversized LIMIT. | **Fixed** — clamped to `[1, 200]` / `[1, 500]`. |
| 2 | `token generate/rotate` | Low | The token is passed to `supabase secrets set` as a process argument, so it is briefly visible via `ps` to other local users on a shared host. Inherent to how the Supabase CLI takes the value. | **Accepted / documented.** Single-user tool; brief window; co-located local user required. Revisit if the Supabase CLI gains a stdin/`--env-file` path. |
| 3 | `rpcs.sql` | Info | `SECURITY DEFINER` functions pin `search_path = public, pg_catalog`. `pg_catalog`-first (or `''` with fully-qualified refs) is marginally stricter. Low-risk on Supabase, where `public` is not writable by untrusted roles. | **Accepted** (defense-in-depth note). |
| 4 | `/rest/v1` proxy | Info | On a 502 the upstream error string is returned to the client (reveals local topology). Local self-hosted mode only. | **Accepted** (minor; local-only). |

## Outcome

The codebase is well-hardened — the earlier auth migration (iter-28E) and the
OAuth-surface work (iter-28B) closed the material risks. This review found only
low-severity items; the one concrete code fix (Finding 1) is applied. No
release-blocking issue was found for 1.0.0.
