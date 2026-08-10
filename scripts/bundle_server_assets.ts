#!/usr/bin/env bun
/**
 * Bundle the Cerefox server-side assets into the npm package's
 * `dist/server-assets/` tree so a fresh `npm install -g @cerefox/memory`
 * can run `cerefox deploy-server` without a repo clone (iter-26 Part 26A).
 *
 * Output layout — **mirrors the repo's relative structure** so the
 * `cerefox-mcp` Edge Function's `../../../_shared/mcp-tools/` import still
 * resolves when `supabase functions deploy` runs from the bundled copy:
 *
 *   packages/memory/dist/server-assets/
 *   ├── db/
 *   │   ├── schema.sql
 *   │   ├── rpcs.sql
 *   │   └── migrations/*.sql
 *   ├── supabase/functions/cerefox-* dirs   (all 9 EFs)
 *   └── _shared/
 *       ├── mcp-tools/                       (imported by cerefox-mcp)
 *       ├── embeddings/                      (transitively imported by mcp-tools)
 *       └── ef-meta/                         (GET /version helper, imported by all 9 EFs)
 *
 * From `…/server-assets/supabase/functions/cerefox-mcp/`, `../../../_shared`
 * resolves to `…/server-assets/_shared`. ✓
 *
 * Only the `_shared` subtrees the EFs actually import are copied
 * (`mcp-tools` + `embeddings`) — not the Node-only modules (cli-core,
 * config, db-status, server-assets, etc.) that Deno would never resolve.
 *
 * Python build artifacts (`__pycache__`, `*.pyc`, `__init__.py`) are
 * excluded.
 */

import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const OUT = join(REPO_ROOT, "packages", "memory", "dist", "server-assets");

const DB_SRC = join(REPO_ROOT, "src", "cerefox", "db");
const FUNCTIONS_SRC = join(REPO_ROOT, "supabase", "functions");
const SHARED_SRC = join(REPO_ROOT, "_shared");

/**
 * The `_shared/` subtrees the Edge Functions import, and therefore the ones the
 * bundle must contain. This is an allow-list, which means adding a new shared
 * module that an EF imports and forgetting this line ships a package whose
 * `cerefox-mcp` deploy fails at bundle time with "Module not found".
 *
 * That happened once: `partial-edits` was added in iteration 34 and omitted
 * here, so v1.3.0-beta.1 deployed 8 of 9 functions and failed the ninth.
 * `_shared/__tests__/server-assets-bundle.test.ts` now walks the EF import
 * graph and fails if this list is missing anything.
 */
export const SHARED_SUBTREES = [
  "mcp-tools",
  "embeddings",
  "ef-meta",
  "mcp-auth",
  "ef-auth",
  "ingest",
  "partial-edits",
  // iter-34: mcp-tools/{get-document,partial-edits}.ts import the pure
  // outline/anchor/apply layer from here.
] as const;

/** Skip Python build artifacts when copying trees. */
function notPythonCruft(src: string): boolean {
  return (
    !src.endsWith(".pyc") &&
    !src.endsWith("__init__.py") &&
    !src.includes("__pycache__") &&
    !src.endsWith("node_modules")
  );
}

function main(): void {
  rmSync(OUT, { recursive: true, force: true });

  // ── db/ ────────────────────────────────────────────────────────────────
  const dbOut = join(OUT, "db", "migrations");
  mkdirSync(dbOut, { recursive: true });
  cpSync(join(DB_SRC, "schema.sql"), join(OUT, "db", "schema.sql"));
  cpSync(join(DB_SRC, "rpcs.sql"), join(OUT, "db", "rpcs.sql"));
  for (const f of readdirSync(join(DB_SRC, "migrations"))) {
    if (f.endsWith(".sql")) {
      cpSync(join(DB_SRC, "migrations", f), join(dbOut, f));
    }
  }

  // ── supabase/functions/ (preserve the supabase/functions/ prefix) ────────
  cpSync(FUNCTIONS_SRC, join(OUT, "supabase", "functions"), {
    recursive: true,
    filter: notPythonCruft,
  });

  // ── _shared/ (only the subtrees the EFs import) ──────────────────────────
  // mcp-auth: cerefox-mcp imports it for in-function OAuth/static token
  // validation. ef-auth (iter-28E): the 8 primitive EFs import it for the
  // in-function access-token gate; it in turn imports `../mcp-auth`
  // (constantTimeEqual) — both must ship or the EF deploy breaks. (consent-page
  // is no longer bundled: its only EF consumer, cerefox-oauth-consent, was
  // removed in iter-28E; the Cloudflare Worker builds it independently.)
  // ingest (iter-28D): cerefox-ingest imports the consolidated exact-partition
  // chunker from `_shared/ingest/chunker.ts`.
  for (const sub of SHARED_SUBTREES) {
    cpSync(join(SHARED_SRC, sub), join(OUT, "_shared", sub), {
      recursive: true,
      filter: notPythonCruft,
    });
  }

  // eslint-disable-next-line no-console
  console.log(`✓  Bundled server assets → ${OUT}`);
}

if (import.meta.main) main();
