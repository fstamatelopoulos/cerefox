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
  // validation. consent-page: cerefox-oauth-consent imports it for the consent
  // markup. Both iter-28A — must ship or the respective EF deploy breaks.
  for (const sub of ["mcp-tools", "embeddings", "ef-meta", "mcp-auth", "consent-page"]) {
    cpSync(join(SHARED_SRC, sub), join(OUT, "_shared", sub), {
      recursive: true,
      filter: notPythonCruft,
    });
  }

  // eslint-disable-next-line no-console
  console.log(`✓  Bundled server assets → ${OUT}`);
}

main();
