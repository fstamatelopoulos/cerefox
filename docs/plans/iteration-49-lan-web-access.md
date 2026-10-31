# Iteration 49 — the web UI on a gated server (LAN deployments)

**Status:** in progress on `feat/lan-web-key`. Target **v1.20.0** (minor, additive; no
schema or Edge Function change). Issue #346.
Design: [`docs/specs/lan-web-access.md`](../specs/lan-web-access.md).

## Why

Cerefox on a LAN host (a NAS, a home server) needs the API key gate on, because inside a
container every caller looks remote. Agents and the CLI cope; the web UI did not, since
the SPA could not hold or send a key. v1.19.6 (#343) fixed the gated container's own data
calls; this iteration fixes the browser.

## Steps

1. [x] Design spec (`docs/specs/lan-web-access.md`).
2. [x] Codex design review, round 1 (about 76K tokens, "revise first"): one High (keyless
   Cloud Run deployments break on upgrade: kept as a deliberate break with a migration and
   `CEREFOX_WEB_NO_KEY=1`) and six Mediums, all folded into the spec's review log.
3. [x] Frontend: key store (`lib/apiKey.ts`), challenge detection, header on every call,
   the prompt and "Forget key" (`components/ApiKeyPrompt.tsx`), downloads and `/api/v1`
   links through the client, no requests while the prompt waits, a late keyless refusal
   cannot drop a key just entered (found by the Playwright session test).
4. [x] Tests: frontend unit 70/0 (incl. `apiKey.test.ts`, the `api-key-surface` scan with
   fixtures); Playwright 41 passed / 1 skipped with the new `gated` project (8 tests),
   and the same 8 against a gated Cerefox Local container built from the branch.
5. [x] (b) `docs/guides/setup-lan.md`; `smoke-auth.sh` checks the SPA loads under the gate
   (PASS on a branch build).
6. [x] (a) web image: root `Dockerfile` built from the tree, non-root, Node floor,
   keyed healthcheck, `docker/web/entrypoint.sh` (refuses keyless start),
   `docker/web/smoke.sh` (PASS), `web-image.yml`, `--docker-publish` dispatches both image
   workflows; `setup-cloud-run.md` migrated to a Secret Manager key. Verified against
   staging: data routes 200 with the key, `healthy`.
7. [x] `fast-uri` override floor to `^3.1.9`.
8. [x] CHANGELOG; `_shared` 1264/0, package suite on staging 426/3/0.
8a. [x] `qs` pinned to 6.16.1 (GHSA-6pq8-jhm2-2vcw; v1.19.6 resolved 6.16.0).
8b. [x] #347, keyless browser guard: `browserGuard` in `web/auth.ts` refuses
   cross-site, foreign-Origin and non-local-Host (DNS rebinding) requests that
   were admitted without a key; `CEREFOX_ALLOWED_HOSTS`; the web image defaults it
   to `*` under `CEREFOX_WEB_NO_KEY=1`. Can only refuse, never admit (tested).
9. [ ] Reference deployment acceptance (#346 checklist) on the LAN host, with a 1.20.0
   build.
10. [ ] PR #348 (open), Codex code review, release.
