# Iteration 41 — the local surface, made honest (v1.12.0)

**Status: IN PROGRESS** (opened 2026-09-02). Branch:
`feat/v1.12.0-api-auth`. Target: **v1.12.0**. No schema change so far.

Addresses [#232](https://github.com/fstamatelopoulos/cerefox/issues/232),
[#230](https://github.com/fstamatelopoulos/cerefox/issues/230), the
deploy-error message from the 2026-09-02 production incident, and
[#229](https://github.com/fstamatelopoulos/cerefox/issues/229) (**design
only** — see `docs/specs/api-auth-design.md`; four decisions are the
maintainer's).

## Why these together

v1.11.0 opened `/api/v1` to clients other than the bundled web app. This
iteration deals with what that exposed: the surface has no authentication
(#229), it answers a refused write with a success status (#232), and the tests
that would have caught either were not all running (#230).

## Release lineage

v1.12.0 is this work. **#154** (commander 15, Node ≥ 22.12) moves to
**v1.13.0** — decision 2026-09-02. Both are "your setup may need attention"
releases; landing an auth change and a platform-baseline drop together makes
"what broke?" ambiguous for anyone who hits a problem.

## Steps

- [x] **#232 — the ingest routes answer with real status codes.** All three
      caught every pipeline failure and returned `200 {success:false, error}`.
      The mapping is not invented here: `documents-write.ts` has mapped the
      same two typed errors to 400/409 since iter-32, so this brings the
      ingest routes onto the existing convention.
      - Bodies keep `success:false` and `error` (nothing reading them breaks)
        and **gain `detail`** — because `ApiError` in the frontend reads
        `detail` and would otherwise show a bare "API error 400", silently
        losing the reason on the one surface it was written for.
      - `409` now carries `current_hash`, matching the edit route.
      - **Frontend, found in recon**: `IngestPage.tsx:89` posts FormData with
        raw `fetch` and threw `Upload failed: ${status}` with no message. New
        `uploadFailureMessage()` in `api/client.ts` reads `detail`/`error`.
        Without this the fix would have *removed* information from the UI.
- [x] **#230 — `loadEnv()` caches by resolved path, not a boolean.** A boolean
      made the second call a no-op forever, including after
      `CEREFOX_CONFIG_DIR` changed. `live-write-guard-coverage.test.ts` sets it
      to a non-existent directory on purpose (proving the production-write
      guard refuses an unlabelled target), which poisoned the cache for the
      whole run: every live suite loaded afterwards saw no credentials and
      skipped. **Effect: the full suite went from 215 pass / 12 skip to 262
      pass / 2 skip** — 47 tests that reported success while running nothing.
      Same shape as the v1.11.0 renamed-probe bug.
- [x] **Deploy-error message for the upstream registry race.** The
      2026-09-02 production deploy failed nine times with a raw
      `unexpected deploy status 400` and a JSR stack trace, which reads as
      "your release is broken". `upstreamRegistryRace()` detects the bundler's
      phrasing and explains it: upstream, your functions are unchanged and
      still serving, retry in a few minutes. Output is now captured rather
      than inherited so the reply can be read, and printed verbatim so nothing
      is hidden.
- [x] **#229 — authentication for the local surface. BUILT.** Loopback-exempt
      gate over `/api/v1/*` AND `/rest/v1/*`, reusing `_shared/ef-auth` rather
      than writing a second auth primitive. `cerefox api-key generate|show|
      rotate`; Cerefox Local mints at boot in `db-init` (persisted on the data
      volume, so it survives `upgrade`) and `cerefox-local api-key` reads it.
      Verified against a **real non-loopback connection**: bound `0.0.0.0`,
      then from the LAN address confirmed 401 without a key, 401 with a spoofed
      `X-Forwarded-For: 127.0.0.1`, 401 on ingest and purge, 200 with the key —
      while `127.0.0.1` stayed 200 throughout.
      - **Found while building**: `userError()` RETURNS a `CliError`, it does
        not throw. `userError(...)` without `throw` is a silent no-op that
        exits 0, which is what the first version of `api-key generate`'s
        refusal did. Invisible to the type checker (a discarded return value is
        legal) and to any test that only walks the happy path. Caught by
        running the command; pinned by `cli-api-key.test.ts`.
      - Both gate guards proven to fire by regressing them independently
        (always-allow → 8 failures; unknown-address-is-loopback → 1).
- [x] **~~#229 DESIGN~~ APPROVED
      2026-09-02, ready to build.** `docs/specs/api-auth-design.md`. Decided:
      loopback-exempt with a key for every other interface; `X-Forwarded-For`
      never consulted, **enforced by a test**, not by a sentence in a guide;
      `/api/v1/version` gated with everything else (verified: no local caller
      is affected, because the CLI never talks to the web server); purge stays
      reachable; ships in v1.12.0 alongside #232, as a second PR.
- [x] **Dead Python parity capture script deleted**, its fixtures documented.
      The script needed `uv run cerefox web` (removed at v1.0.0) so it could
      never run again while implying regeneration was possible; its OUTPUT is
      still the wire-shape regression guard for `/api/v1`.
- [x] **Seven dependency advisories cleared** (4 high, 3 moderate) via root
      `overrides`. Pre-existing on `main`, folded into #233 because it blocked
      the merge.
- [x] Live regression against staging (294 pass / 2 skip) + Playwright 20/20.
- [x] CHANGELOG, `api.md`, `configuration.md`, `access-paths.md`.

## Found during recon

**The port serves more than `/api/v1`.** `registerPostgrestProxy`
(`web/routes/postgrest-proxy.ts:31`) mounts `/rest/v1/*` on the same port and
forwards caller headers verbatim to PostgREST. It self-gates on
`CEREFOX_POSTGREST_UPSTREAM`, so it is live **on Cerefox Local specifically** —
the deployment most likely to run unattended. Any auth gate that covers only
`/api/v1` moves the hole rather than closing it. This is recorded here because
it is the single most likely way #229 ships half-done.

**Handing a key to the browser is the whole difficulty.** `index.html` is read
once at boot and served verbatim (`web/server.ts:160-161`). Injecting a key
there would mean anything that can `GET /app/` can read it — which is exactly
the attacker the key defends against. A key embedded in an unauthenticated
page is not a secret. The design's loopback-exempt recommendation exists to
dissolve this rather than work around it.

**`cerefox-local` never crosses the published port.** Every CLI verb runs
inside the container over `docker exec` (`docker/local/cerefox-local:424-432`);
the only network egress is a GitHub call to resolve the newest release tag. So
the wrapper needs no key, and the container's own secret boundary is preserved.

## Rejected: pinning `jsr:@supabase/supabase-js@2`

Considered on 2026-09-02 after the production deploy failed, and **rejected**.
The failure is rare, loud, leaves the previous functions serving, and
self-heals on retry. A permanent manual-bump burden across 9 functions is the
worse trade, and pinning would move the trust decision rather than remove it —
you would make the same call by hand on your own schedule. What the incident
justified was a readable error message, which is what shipped.

Evidence, since it is the kind of thing that gets re-litigated: JSR published
`supabase-js@2.113.0` at 06:03:13Z; npm published `supabase-js@2.113.0` at
06:04:34Z and its `auth-js@2.113.0` dependency at 06:05:01Z. The production
deploy landed inside that 108-second window. Staging had deployed earlier and
resolved 2.112.4, which is why the same command on the same version worked
there and not here.
