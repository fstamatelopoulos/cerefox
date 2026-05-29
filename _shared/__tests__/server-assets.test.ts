/**
 * Tests for the server-asset path resolver (iter-26 Part 26A).
 *
 * Covers the three resolution modes:
 *   - explicit `assetsDir` (bundled layout under a caller-provided root)
 *   - source layout (repo checkout: src/cerefox/db + supabase/functions)
 *   - bundled layout (dist/server-assets relative to the running bin)
 *
 * No network, no DB — pure path logic against a temp fixture tree.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  bundledServerAssets,
  resolveServerAssets,
  serverAssetsUsable,
  sourceServerAssets,
} from "../server-assets/index.js";

describe("server-assets path resolver", () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "cerefox-assets-"));
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("bundledServerAssets: db under db/, functions under supabase/functions/", () => {
    const p = bundledServerAssets("/x/server-assets");
    expect(p.schemaFile).toBe("/x/server-assets/db/schema.sql");
    expect(p.rpcsFile).toBe("/x/server-assets/db/rpcs.sql");
    expect(p.migrationsDir).toBe("/x/server-assets/db/migrations");
    // supabase/functions/ prefix preserved so EF relative imports resolve.
    expect(p.functionsDir).toBe("/x/server-assets/supabase/functions");
    expect(p.layout).toBe("bundled");
  });

  test("sourceServerAssets maps db under src/cerefox/db and functions under supabase", () => {
    const p = sourceServerAssets("/repo");
    expect(p.schemaFile).toBe("/repo/src/cerefox/db/schema.sql");
    expect(p.rpcsFile).toBe("/repo/src/cerefox/db/rpcs.sql");
    expect(p.migrationsDir).toBe("/repo/src/cerefox/db/migrations");
    expect(p.functionsDir).toBe("/repo/supabase/functions");
    expect(p.layout).toBe("source");
  });

  test("serverAssetsUsable is true only when both SQL files exist", () => {
    const root = join(tmp, "bundled");
    mkdirSync(join(root, "db"), { recursive: true });
    const p = bundledServerAssets(root);
    expect(serverAssetsUsable(p)).toBe(false); // no files yet
    writeFileSync(p.schemaFile, "-- schema");
    expect(serverAssetsUsable(p)).toBe(false); // only schema
    writeFileSync(p.rpcsFile, "-- rpcs");
    expect(serverAssetsUsable(p)).toBe(true); // both present
  });

  test("explicit assetsDir wins and is reported as layout 'explicit'", () => {
    const root = join(tmp, "explicit-root");
    mkdirSync(join(root, "db"), { recursive: true });
    writeFileSync(join(root, "db", "schema.sql"), "-- schema");
    writeFileSync(join(root, "db", "rpcs.sql"), "-- rpcs");
    const p = resolveServerAssets({ assetsDir: root });
    expect(p.layout).toBe("explicit");
    expect(p.schemaFile).toBe(join(root, "db", "schema.sql"));
  });

  test("falls back to source layout when nothing resolves (clear-error path)", () => {
    // Point moduleDir + cwd at empty dirs so no candidate has SQL files.
    const emptyModuleDir = join(tmp, "empty-module", "server-assets");
    mkdirSync(emptyModuleDir, { recursive: true });
    const emptyCwd = join(tmp, "empty-cwd");
    mkdirSync(emptyCwd, { recursive: true });
    const p = resolveServerAssets({
      moduleDirOverride: emptyModuleDir,
      cwd: emptyCwd,
    });
    // Default is source-relative-to-module (two levels up from the module dir).
    expect(p.layout).toBe("source");
    expect(p.schemaFile).toContain(join("src", "cerefox", "db", "schema.sql"));
  });

  test("resolves the real repo source tree from this module's location", () => {
    // This test runs from _shared/__tests__, so the module's own location
    // (_shared/server-assets) resolves to the repo root → real schema.sql.
    const p = resolveServerAssets();
    expect(serverAssetsUsable(p)).toBe(true);
    expect(p.layout).toBe("source");
    expect(p.schemaFile).toContain("schema.sql");
  });
});
