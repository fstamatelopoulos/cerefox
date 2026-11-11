# Iteration 52: Node 24.22.3 security floor (v1.23.1)

> Status: implemented (2026-11-11) on `fix/node-24-22-3`. The cut waits for the
> official `node:24-slim` image to carry 24.22.3.

## Why

Node.js 24.22.3 (2026-11-10, a security release) fixes HIGH vulnerabilities in
`tls`, `http` and `http2`. Two Cerefox runtimes run on Node:

| Runtime | Node | Affected | Fix |
|---|---|---|---|
| The `cerefox-web` image | `node:24-slim`, 24.22.2 at v1.23.0 | Yes | Rebuild on 24.22.3 |
| The CLI, local MCP server and `cerefox web` on a user's machine | Whatever Node they installed | Yes, below 24.22.3 | The user upgrades Node; `doctor` now says so |
| Cerefox Local | Bun only, no Node in the image | No | None |

## Changes

- Root `Dockerfile`: `MIN_NODE=24.22.3`. The build fails on any older Node, so
  a stale base image can never ship. The release workflow therefore cannot
  publish the web image until Docker Hub's `node:24-slim` carries 24.22.3, which
  is the intended behavior.
- `doctor`: `NODE_SECURITY_FLOOR` (per major line) and a **warn**, not an error,
  on a Node below it. The CLI still works there; blocking it would be the wrong
  signal. A test keeps the Dockerfile's `MIN_NODE` equal to the floor.
- Dependencies: #365 (`docker/login-action` 4.8.0; SHA verified against the
  upstream tag) and #366 (15 minor and patch updates, among them
  `@supabase/supabase-js` 2.119, `postgres` 4.1, Playwright 1.65, eslint 10.14).

## Verified

- typecheck, frontend lint (and a planted violation is still caught), all unit
  suites;
- staging: `server deploy` with Postgres.js 4.1, the package suite (488 pass,
  0 fail), Playwright (43, after installing Playwright 1.65's Chromium);
- the supabase-js to PostgREST coupling (`RELEASING.md` item 9): a Local image
  built from the branch, on its pinned PostgREST v14.12, through the bundled CLI:
  ingest with project and metadata, search, project-scoped list, metadata search,
  the audit trail, backup, `doctor`.

## Not in the repo

Upgrading Node on a maintainer's or user's machine. The CHANGELOG says how.
