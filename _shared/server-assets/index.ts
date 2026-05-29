/**
 * Server-asset path resolution for Cerefox deploy operations.
 *
 * "Server assets" = the SQL + Edge Function sources needed to stand up
 * the server side of Cerefox:
 *   - schema.sql, rpcs.sql, migrations/  (Postgres DDL)
 *   - supabase/functions/cerefox-* dirs  (Deno Edge Functions)
 *
 * These live in two places in a repo checkout (`src/cerefox/db/` and
 * `supabase/functions/`) but are bundled into a single
 * `dist/server-assets/` tree in the published npm package (iter-26
 * Part 26A) so a fresh `npm install -g @cerefox/memory` can run
 * `cerefox deploy-server` without a repo clone.
 *
 * Resolution strategy (folder-as-parameter, per iter-26 design R6):
 *   - Callers that know the assets dir (e.g. `cerefox deploy-server`
 *     running from the bundled bin) pass `{ assetsDir }` explicitly.
 *   - Callers that don't (e.g. `bun scripts/db_deploy.ts` from a repo
 *     clone) let `resolveServerAssets()` walk candidate locations.
 *
 * The two on-disk layouts differ, so the resolver returns explicit
 * resolved file paths rather than a single root:
 *
 *   bundled (dist/server-assets/):        source (repo checkout):
 *     db/schema.sql                          src/cerefox/db/schema.sql
 *     db/rpcs.sql                            src/cerefox/db/rpcs.sql
 *     db/migrations/                         src/cerefox/db/migrations/
 *     supabase/functions/cerefox-* dirs      supabase/functions/cerefox-* dirs
 *     _shared/{mcp-tools,embeddings}/        _shared/{mcp-tools,embeddings}/
 *
 * The bundled layout deliberately mirrors the repo's relative structure
 * for `supabase/functions/` + `_shared/` so the cerefox-mcp EF's
 * `../../../_shared/mcp-tools/` import resolves identically when
 * `supabase functions deploy` runs from the bundled copy.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cwd as processCwd } from "node:process";

export interface ServerAssetPaths {
  schemaFile: string;
  rpcsFile: string;
  migrationsDir: string;
  functionsDir: string;
  /** Which candidate matched — for diagnostics / tests. */
  layout: "bundled" | "source" | "explicit";
}

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Bundled layout: db under `<root>/db`, functions under
 * `<root>/supabase/functions` (the `supabase/functions/` prefix is
 * preserved so EF relative imports + the supabase CLI's
 * directory-convention both work from the bundled copy).
 */
export function bundledServerAssets(serverAssetsRoot: string): ServerAssetPaths {
  return {
    schemaFile: join(serverAssetsRoot, "db", "schema.sql"),
    rpcsFile: join(serverAssetsRoot, "db", "rpcs.sql"),
    migrationsDir: join(serverAssetsRoot, "db", "migrations"),
    functionsDir: join(serverAssetsRoot, "supabase", "functions"),
    layout: "bundled",
  };
}

/** Source layout: db under src/cerefox/db, functions under supabase/functions. */
export function sourceServerAssets(repoRoot: string): ServerAssetPaths {
  const dbDir = join(repoRoot, "src", "cerefox", "db");
  return {
    schemaFile: join(dbDir, "schema.sql"),
    rpcsFile: join(dbDir, "rpcs.sql"),
    migrationsDir: join(dbDir, "migrations"),
    functionsDir: join(repoRoot, "supabase", "functions"),
    layout: "source",
  };
}

/** The two required SQL files exist at the resolved paths. */
export function serverAssetsUsable(p: ServerAssetPaths): boolean {
  return existsSync(p.schemaFile) && existsSync(p.rpcsFile);
}

export interface ResolveServerAssetsOptions {
  /**
   * Explicit assets root (bundled layout). When set, the resolver
   * returns the bundled paths under this root without probing — used by
   * `cerefox deploy-server` which computes the bundled dir relative to
   * the running bin.
   */
  assetsDir?: string;
  /** Override module dir; tests only. */
  moduleDirOverride?: string;
  /** Override cwd; tests only. */
  cwd?: string;
}

/**
 * Resolve server-asset paths, trying (in order):
 *   1. explicit `assetsDir` (bundled layout) if provided;
 *   2. bundled layout relative to the running bin
 *      (`<bin-dir>/../server-assets/` — works when `_shared/` is inlined
 *      into `dist/bin/cerefox.js`);
 *   3. source layout relative to this module (`<repo>/` from
 *      `<repo>/_shared/server-assets/`);
 *   4. source layout relative to cwd (covers odd runtime layouts).
 *
 * Returns the first candidate whose SQL files exist. Falls back to the
 * source-relative-to-module layout (which surfaces a clear "missing
 * files" error downstream) when nothing matches.
 */
export function resolveServerAssets(
  opts: ResolveServerAssetsOptions = {},
): ServerAssetPaths {
  if (opts.assetsDir) {
    return { ...bundledServerAssets(opts.assetsDir), layout: "explicit" };
  }

  const here = opts.moduleDirOverride ?? moduleDir();
  const cwd = opts.cwd ?? processCwd();

  const candidates: ServerAssetPaths[] = [
    // (2) Bundled bin: here ~ dist/bin (when inlined into cerefox.js).
    bundledServerAssets(join(here, "..", "server-assets")),
    // (3) Source: here = <repo>/_shared/server-assets → up two to repo root.
    sourceServerAssets(join(here, "..", "..")),
    // (4) Source via cwd fallback.
    sourceServerAssets(cwd),
  ];

  for (const candidate of candidates) {
    if (serverAssetsUsable(candidate)) return candidate;
  }

  // Nothing matched; return the source-relative-to-module default so the
  // caller's existsSync check produces a clear error pointing at the
  // expected repo location.
  return sourceServerAssets(join(here, "..", ".."));
}
