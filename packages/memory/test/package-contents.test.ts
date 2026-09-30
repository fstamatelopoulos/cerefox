/**
 * What `npm publish` actually ships, checked on the real tarball list (#303).
 *
 * The store serves its guides (`GET /api/v1/docs`) and its own API description
 * (`GET /api/v1/openapi.json`) from files copied in by `bundle-docs`. Neither
 * was checked against the tarball: `api.md` never shipped, and `openapi.json`
 * was not in the package at all. This runs the same bundle step publishing
 * runs, then asks npm what it would pack. Run inside packages/memory: from the
 * repo root, `npm pack` packs the private workspace root instead.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");

describe("the published package", () => {
  test("ships every guide and the OpenAPI document", () => {
    execFileSync("bun", ["run", "bundle-docs"], { cwd: PKG_ROOT, stdio: "ignore" });
    const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: PKG_ROOT,
      encoding: "utf8",
    });
    const files = new Set(
      (JSON.parse(out) as Array<{ files: Array<{ path: string }> }>)[0]!.files.map((f) => f.path),
    );

    const guides = readdirSync(join(REPO_ROOT, "docs", "guides")).filter((n) => n.endsWith(".md"));
    const missing = guides.filter((g) => !files.has(`docs/guides/${g}`));
    // GUIDE_EXCLUSIONS is empty today; if it gains entries, subtract them here.
    expect(missing).toEqual([]);
    expect(files.has("docs/api/openapi.json")).toBe(true);

    // And it is the committed artifact, not a stale copy.
    expect(readFileSync(join(PKG_ROOT, "docs", "api", "openapi.json"), "utf8")).toBe(
      readFileSync(join(REPO_ROOT, "docs", "api", "openapi.json"), "utf8"),
    );
  }, 60_000);
});
