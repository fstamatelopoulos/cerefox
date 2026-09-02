# Python parity fixtures

Captured **2026-05-27** from the Python `cerefox web` server (v0.6 era,
iteration 24) against the maintainer's real Supabase data, as the reference for
porting the web API to TypeScript.

## These cannot be regenerated

The Python implementation was **removed entirely at v1.0.0** (iter-28G). The
capture script (`scripts/capture_python_parity.sh`) required
`uv run cerefox web` and was deleted in v1.12.0 once it became clear it could
only ever mislead: nothing it needed still exists.

**So treat these files as immutable.** They are the last surviving record of a
wire contract that predates the current server, and there is no way to take the
snapshot again.

## What still depends on them

- **`packages/memory/test/parity.test.ts`** — parses each response against the
  matching zod schema in `_shared/schemas/`. This is the regression guard on
  the `/api/v1/*` wire shape that frontends and external HTTP clients depend
  on: break a schema, and this goes red. Runs in CI with no network.
- **`_shared/__tests__/embeddings-batching.test.ts`** — uses the `embedding/`
  subdirectory as recorded embedding-API responses.

## If a fixture ever "fails"

Do not edit the fixture to make the test pass. A red parity test means the
current schema no longer accepts a response shape that was once served, which
is the finding, not the obstacle. Decide deliberately whether that break is
intended (a documented breaking change, recorded in `CHANGELOG.md`) or a
regression — and if it is intended, update the fixture in the same commit as
the schema change, with the reason in the message.
