# Iteration 50 — the CLI and local MCP against a gated Cerefox Local on another host

**Status:** in progress on `feat/351-rest-key-swap`. Target **v1.22.0** (minor, additive; no
schema or Edge Function change). Issue #351. Unblocks the coding-agent part of #350.

## Why

A Cerefox Local on a LAN host (a NAS) runs with the API key gate on. The web UI (since
1.20.0) and `/api/v1` work with the key. The CLI and the local MCP server do not: they
speak to the Data API through the container's `/rest/v1` proxy, which forwards the
caller's headers unchanged, and PostgREST refuses a `cfx_lak_` key because it is not a
JWT (`Expected 3 parts in JWT; got 1`).

## Approach

When `/rest/v1` admits a request **because it presented a valid API key**, the proxy
replaces the caller's `apikey` and `Authorization` headers with the container's internal
service-role JWT (`CEREFOX_SUPABASE_KEY`) before forwarding.

- **Local only by construction.** The proxy is mounted only under
  `CEREFOX_POSTGREST_UPSTREAM`, which only the Local image sets.
- **Tied to the gate.** No new variable: the swap needs the proxy, a configured key and a
  `valid_key` decision. A request admitted for any other reason (loopback exemption, gate
  off) is forwarded exactly as today.
- **The internal JWT stays inside the container.** Added on the way to PostgREST, never
  returned. A caller that already presents the internal JWT (the server's own data client)
  passes through unchanged.

Rejected alternatives: a separate LAN image (doubles builds and docs for one condition);
an opt-in variable (a NAS setup would fail with a confusing JWT error until someone finds
it); path allowlisting on the proxy (fragile, breaks with client changes); MCP over HTTP
from the container (agents only, not the CLI; possible later); the CLI on `/api/v1`
(a second client backend, too large).

## Risks

- **More reach per key:** direct table access as the service role skips the RPCs'
  safeguards. Accepted for a single-user store, where the key already allows writes and
  hard deletes through `/api/v1`; documented as "the key is the store's master key".
- **Swap on the wrong decision** would open the gate: covered by the test matrix below.
- **Leak of the internal JWT:** asserted absent from every response, errors included.
- **Version skew:** a new client against an older container still gets the JWT error;
  `doctor` names the fix.

## Steps

1. [x] The swap (`upstreamCredentials` in `web/routes/postgrest-proxy.ts`; the gate sets
   `cerefoxAuthReason`): the `/rest/v1` gate records the decision; the proxy rewrites both auth
   headers only on `valid_key`.
2. [x] `test/web-rest-key-swap.test.ts`, 8 tests (2 fail with the swap call removed): keyless, wrong, blank and valid keys;
   gate on and off; loopback exemption; `apikey` only, `Authorization` only, both; the
   internal JWT passes through; no response carries it.
3. [x] `doctor` (`dataApiHint` in `cli/util/checks.ts`): on a gated Local target, recognize the PostgREST JWT error and say the
   container needs 1.22+.
4. [x] Live: done with the unchanged 1.21.0 client against a gated throwaway Local container from the branch image, reached from a
   separate config dir with only the URL and the key: `doctor`, `project list`, `search`,
   an ingest, semantic search, an MCP tool call all pass; keyless, wrong and `apikey`-only
   calls 401; the internal JWT in no response, errors included. `smoke-auth.sh` checks the Data API with the key, the refusals and the JWT (PASS). Gate-off Local suites
   unchanged.
5. [x] Docs: `setup-lan.md` (agents and CLI from other machines), `securing-local-access.md`
   (what the key reaches), `connect-agents.md`; CHANGELOG `[Unreleased]`.
6. [x] Codex review round 1 (about 77K tokens): "merge", no High or Medium; the Lows fixed
   (a proxy-without-gate test, gate-off Data API checks in `smoke-auth.sh`, the leak guarantee
   worded as resting on PostgREST).
7. [ ] Acceptance on the reference LAN host, together with the move to a Container Manager
   Project (#350).
