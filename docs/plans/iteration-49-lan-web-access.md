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
2. [ ] Codex design review (one round), findings folded into the spec.
3. [ ] Frontend: key store, challenge detection, header on every call, the prompt, "Forget
   key", raw `fetch` sites and `/api/v1` links moved onto the client; source scan.
4. [ ] Frontend unit tests + gated Playwright project.
5. [ ] (b) docs: LAN/NAS section in `setup-local.md`; `smoke-auth.sh` SPA-under-gate checks.
6. [ ] (a) web image: root `Dockerfile` hardened, `web-image.yml` with a smoke test,
   `setup-cloud-run.md` updated.
7. [ ] Housekeeping: `fast-uri` override floor to `^3.1.9`.
8. [ ] CHANGELOG, docs, suites green, reference-deployment acceptance (#346 checklist).
