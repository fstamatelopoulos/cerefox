# Iteration 42 — the container loopback bug (v1.12.1)

**Status: FIX COMPLETE** (2026-09-03). Branch:
`fix/v1.12.1-container-loopback`. Target: **v1.12.1**, a hotfix.

## What broke

v1.12.0 shipped the #229 auth gate. Within an hour of release, Cerefox Local
was **completely inaccessible**: every request returned `401`, the web UI
included. Found live, on the maintainer's own instance, by a demo agent whose
Playwright recording started failing.

**Docker's port publishing rewrites the source address.** A request from the
host to `127.0.0.1:<port>` reaches the server inside the container appearing to
come from the bridge gateway, never from `127.0.0.1`. The loopback exemption
could therefore never match, for any caller.

## Why it is not only a wiring mistake

Inside a bridge-networked container the server **cannot** distinguish a
host-loopback caller from one that crossed the network: Docker NATs both to the
same address. The loopback-exempt middle ground is **not implementable there**,
and v1.12.0 was pretending otherwise.

So the container gate is now all-or-nothing, and *which* is decided on the
**host**, the only place the publish address is known at `docker run` time:

| Publish address | Gate |
|---|---|
| `127.0.0.1` (default) | **Off** — the bind is the boundary, exactly as pre-1.12.0 |
| Anything wider | **On for every caller**, including the browser |

`cerefox-local` derives this from `CEREFOX_LOCAL_BIND`; an explicit
`CEREFOX_API_REQUIRE_KEY=1` still forces it on. The key is minted and persisted
either way, so turning the gate on later never changes the value clients were
given.

## Why the tests missed it

**The mechanism was right; the packaging was wrong.** 17 unit tests, 8
HTTP-boundary tests and a real non-loopback verification all passed, because
they exercised `cerefox web` running **natively on the host**. The auth gate was
never once run inside a container — the single deployment where the address it
depends on is rewritten before it arrives.

The throwaway-container work in iteration 40 predates the feature, so there was
no existing container test to extend, and its absence was not noticed.

## Guards added

- **`docker/local/smoke-auth.sh`** — builds the real image, publishes a real
  port, makes real requests from the host. Asserts the default publish is
  ungated (the exact v1.12.0 regression), that require-mode gates everyone,
  that a wrong key is refused, and that the key survives a container recreate.
  **Verified to fail on the v1.12.0 behaviour**: the fix was reverted, the image
  rebuilt, and the test reproduced `host request got 401, expected 200`.
- **A boot warning** (`containerGateWarning()`): `cerefox web` now says so
  loudly when a key is configured inside a container without require-mode —
  precisely the broken configuration — instead of silently 401ing everything.

## Also in this release

Two more live tests given realistic budgets (`pipeline-update`,
`doctor --json`), same flake class as the `ingest-dir` fix in v1.12.0. The
systematic problem is [#235](https://github.com/fstamatelopoulos/cerefox/issues/235):
~130 live tests inherit bun's 5s default while making real network calls.
`bunfig.toml`'s `[test] timeout` does **not** work on bun 1.3.13 — tested, not
assumed, and recorded on the issue so nobody re-tries it.

## Lesson

Recorded because it generalises past this bug: **a feature that depends on a
property of the transport must be tested in every packaging that changes the
transport.** The gate reads a socket address; Docker rewrites socket addresses;
nothing tested the gate under Docker. Everything else was rigorous, which is
what made the gap invisible.
