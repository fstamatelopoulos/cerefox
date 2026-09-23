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

---

## Addendum: post-1.0.1 review (2026-08-02)

A follow-up defensive pass over the delta since the review above (the 1.0.x
releases, PR #110, CI, the Cerefox Local packaging) plus a dependency audit.
All referenced advisories are public.

**Re-verified solid**: migration `0013` grants reach only `service_role`
(`anon`/`authenticated` deliberately get nothing); no secrets in tracked files;
the shipped Cerefox Local image binds `127.0.0.1` by default and mints a
per-install random JWT secret (0600, in-volume); installers download over HTTPS
only; CI uses `pull_request` (fork PRs run without secrets); Edge Functions set
`Access-Control-Allow-Origin: *` **without** credentials (public-API pattern —
the Bearer token is the gate); the #110 query is parameterized.

**Fixed in this pass**:

| Area | Change |
|---|---|
| Dependencies | Version floors raised in `package.json`: `@hono/node-server` ^2.0.12 (serve-static path-traversal fix), `@modelcontextprotocol/sdk` ^1.30.0, `vite` ^8.2.0; remaining ranges already admit the fixed releases, so fresh installs resolve clean (`bun audit` on a fresh resolution: 19 advisories → 3 accepted ones, below). Note: the repo does not commit a lockfile (see open item), so every fresh install re-resolves ranges. |
| CI supply chain | All GitHub Actions pinned to commit SHAs (tag kept as a comment). Updates are now deliberate. |
| Dev spike stack | `docker/local/compose.yml` (contributor-only) ports bound to `127.0.0.1` — it previously published Postgres/PostgREST on all interfaces with a placeholder JWT secret. |

**Accepted (with reasoning)**:

- `tar` / `sharp` advisories via the `onnxruntime-node` /
  `@huggingface/transformers` tree: these libraries only unpack the runtimes'
  own release artifacts at install time (tar) or serve vision-model
  paths Cerefox never invokes (sharp — embeddings are text-only). No current
  upstream release resolves them. Revisit on `@huggingface/transformers` major
  bumps. (**The `adm-zip` half of this entry is retired** — see the 2026-09-22
  addendum: a fixed release shipped and is now pinned by override.)
- `react-router` RSC-mode advisory: fixed only in v8; Cerefox's SPA does not
  use RSC/SSR, so the affected code never runs. Revisit at a react-router v8
  migration.
- **2026-09-08 addendum.** Four advisories were published upstream in one day
  and broke the audit gate on every branch. Two were **fixed rather than
  accepted**, by overrides in the root `package.json`: `hono` to `^4.13.7`
  (three advisories, one of them in `parseBody()`, which the web server does
  reach) and `js-yaml` to `^4.3.2` (a frontend lint-time dependency). Two are
  accepted, and they are the same two packages and the same reasoning as
  above: `adm-zip` GHSA-vwc7-r8mq-g2x9, where **no fixed release exists** —
  0.6.0 is the newest and is itself affected — and `sharp`
  GHSA-rgj7-g3m4-5g8c, whose fix (0.35.4) is outside the `^0.34.5` that
  `@huggingface/transformers` pins. Both remain confined to the local ONNX
  embedder's install-time and vision paths. Revisit `adm-zip` when a fixed
  release ships and `sharp` at the next `@huggingface/transformers` bump.
- **2026-09-22 addendum — the `adm-zip` acceptances are retired.** A third
  advisory (GHSA-7q85-xj36-vmfc, high, uncontrolled memory allocation) was
  published on 2026-09-21 and broke the audit gate on every branch, as the
  2026-09-08 batch had. This time the premise of the acceptance had expired:
  **`adm-zip@0.6.1` shipped**, where 0.6.0 had been the newest and affected.
  An override to `^0.6.1` in the root `package.json` clears **all three**
  adm-zip advisories at once, so GHSA-xcpc-8h2w-3j85 and GHSA-vwc7-r8mq-g2x9
  were removed from the gate rather than a third being added to it.

  The override forces `adm-zip` past the `^0.5.16` that `onnxruntime-node`
  declares, which is worth stating plainly. The exposure is small and was
  checked rather than assumed: `onnxruntime-node` uses `adm-zip` in exactly one
  place, `script/install-utils.js`, to unpack a NuGet archive of **CUDA
  execution-provider binaries** that are not bundled in the npm package because
  of size. The default native binaries ship inside the package and are not
  extracted at install. Cerefox never requests the CUDA provider, so that code
  path does not run in any Cerefox deployment. What is **not** verified is a
  clean install on a CUDA-enabled Linux host under 0.6.1; if Cerefox ever wants
  the CUDA provider, re-test that path before relying on it.

  Lesson worth keeping: an acceptance whose reason is "no fixed release exists"
  has an expiry date that nothing checks. `adm-zip@0.6.1` was published
  **2026-09-11**, three days after the 2026-09-08 acceptance was written, and
  the acceptance stood unexamined until an unrelated advisory forced the issue
  ten days later. Nobody was going to notice: the stated revisit trigger was
  "when a fixed release ships", and no one watches for that. When accepting on
  those grounds, the honest trigger is the next time the gate fails for any
  reason — check whether the premise still holds before adding another id.
- The container-minted `service_role` JWT has no expiry; it never leaves the
  container, and rotating it is deleting `.cerefox_jwt_secret` from the data
  volume.
- `cerefox-local` sources its own config file; values there are writable only
  by the local user (self-affecting only).

**Resolved in the same pass (2026-08-02, follow-up commits):** the repo now
**commits `bun.lock`** (root workspace lock; CI installs are strict
`--frozen-lockfile`), CI gained a **`bun audit` gate** that fails on any
advisory not on the accepted list (the three above, referenced by GHSA id in
`ci.yml` — keep that list and this document in sync), and **Dependabot** is
configured for weekly grouped bun-workspace bumps plus GitHub Actions SHA-pin
updates. Still open from the 28B list: a gitleaks (secret-scanning) CI step.
