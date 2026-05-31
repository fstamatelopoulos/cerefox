# `_shared/` — cross-context TypeScript modules

Single source of truth for TypeScript consumed by **both** runtimes:

- the **Deno** Edge Functions (`supabase/functions/*`), and
- the **Node/Bun** `@cerefox/memory` package (CLI, local MCP server, web server,
  ingestion) plus the `scripts/*.ts`.

The two runtimes import the same modules via structural typing, so a given
tool/handler behaves identically regardless of transport. `_shared/` lives at
the repo root precisely because it is shared across both — it can't live inside
either the Deno functions tree or the npm package.

## Modules

| Module | What it holds |
|---|---|
| `config/` | env loading + path resolution |
| `db-client/` | Supabase client, RPC wrapper, introspection helpers |
| `db-status/` | schema-version checks + the mismatch banner |
| `db-deploy/` | in-process schema + RPC deploy (shared by `cerefox server deploy` and `scripts/db_{deploy,migrate}.ts`) |
| `embeddings/` | OpenAI / Fireworks embedding helpers |
| `mcp-tools/` | the 10 MCP tool handlers — imported by both the remote `cerefox-mcp` EF and the local `cerefox mcp` server |
| `ingest/` | chunking + embedding orchestration |
| `cli-core/` | CLI helpers (exit codes, output, argv parsing, prompts) |
| `ef-meta/` | `EF_VERSION` + the `/version` payload helper |
| `compatibility/` | client ↔ server minimum-version matrix |
| `backup/` | backup / restore helpers |
| `schemas/` | shared validation schemas |
| `server-assets/` | deploy assets (schema/RPC SQL, EF sources) bundled into the npm package for `cerefox server deploy` |
| `__tests__/` | unit tests (`bun test`) |

## Running

These modules run under [Bun](https://bun.sh) (preferred) or Node 20+. Bun is a
contributor prerequisite (see `CONTRIBUTING.md`).

```bash
# From repo root
bun scripts/db_status.ts
bun scripts/sync_docs.ts --dry-run

# Unit tests
cd _shared && bun test
```

## Why a directory at the repo root rather than `src/`?

It's imported by both the Deno Edge Functions and the Node/Bun `@cerefox/memory`
package, so it can't live inside either. `src/cerefox/` is the frozen Python
package; keeping TS out of it also avoids confusing the Python wheel build /
tooling.

## Why ESM-only?

Bun supports both, but the MCP server SDK and `@supabase/supabase-js@^2` expose
modern ESM exports. CommonJS interop would mostly be a net negative.
