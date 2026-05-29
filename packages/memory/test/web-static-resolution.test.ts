/**
 * Regression test for the resolveSpaDist candidate order (iter-26 Part 26K).
 *
 * In source mode (this test runs from the repo checkout), the resolver must
 * prefer the repo's fresh `frontend/dist` build over a possibly-stale
 * `packages/memory/dist/frontend` bundle. Before the 26K swap, the stale
 * bundle won and shadowed fresh frontend edits during dev.
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSpaDist } from "../src/web/static.ts";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const REPO_FRONTEND_DIST = join(REPO_ROOT, "frontend", "dist");
const STALE_BUNDLE = join(PKG_ROOT, "dist", "frontend");

describe("resolveSpaDist candidate order (source mode)", () => {
  test("prefers repo frontend/dist over a stale package bundle when both exist", () => {
    // Only meaningful when the repo frontend build exists.
    if (!existsSync(join(REPO_FRONTEND_DIST, "index.html"))) {
      console.log("(skipped: frontend/dist not built)");
      return;
    }
    const resolved = resolveSpaDist();
    expect(resolved).not.toBeNull();
    // Must be the repo source build, never the stale package bundle.
    expect(resolved).toBe(REPO_FRONTEND_DIST);
    expect(resolved).not.toBe(STALE_BUNDLE);
  });
});
