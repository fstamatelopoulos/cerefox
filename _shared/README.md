# `_shared/` — cross-context TypeScript modules

Shared TS code consumed by scripts (`scripts/*.ts`), the local MCP server
(v0.4+), the TS CLI (v0.5+), and the TS web server (v0.6+). Single-version
source of truth for tool handlers, validation schemas, and DB client logic
that today lives in three or four places.

**Status as of v0.3.0**: seed only. Three modules:

| Module | Used by (v0.3.0) | Will be used by (later) |
|---|---|---|
| `config/` | `scripts/sync_docs.ts`, `scripts/db_status.ts` | All TS components |
| `db-client/` | `scripts/db_status.ts` | TS MCP server (v0.4), TS CLI (v0.5) |
| `db-status/` | `scripts/db_status.ts` | `cerefox doctor` (v0.5) |

**Not yet present** (deliberately deferred — see `docs/plan.md` § Iteration
20 → Deferred):

- `mcp-tools/` — Edge-Function tool handlers + their local MCP equivalents. **v0.4.**
- `ingest/` — chunking + embedding orchestration. **v0.7.**

## Running

These modules run under [Bun](https://bun.sh) (preferred) or Node 20+. Bun is
a contributor prerequisite from v0.2.0 (see `CONTRIBUTING.md`).

```bash
# From repo root
bun scripts/db_status.ts
bun scripts/sync_docs.ts --dry-run

# Vitest-style test runner under Bun
cd _shared && bun test
```

## Why a directory at the repo root rather than `src/`?

`src/cerefox/` is the Python package. Mixing TS source there would confuse
hatchling's wheel builds and Python tooling (ruff, pytest discovery). The
`_shared/` directory at the repo root is the staging area for TS code that
will later move into `packages/` once the npm workspace lands in v0.4.

## Why ESM-only?

Bun supports both, but the TS MCP server SDK and `@supabase/supabase-js@^2`
expose modern ESM exports. CommonJS interop would mostly be a net negative.

## Future shape (v0.4+)

```
_shared/
  config/           # env, resolver
  db-client/        # supabase-js wrapper
  db-status/        # schema introspection
  mcp-tools/        # tool handlers (extracted from supabase/functions/cerefox-mcp/tools/)
  ingest/           # chunking + embeddings
  __tests__/
```
