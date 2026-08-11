/**
 * `bun run typecheck` must cover BOTH TypeScript projects, and CI must run it.
 *
 * It used to be `cd _shared && tsc --noEmit`, which left `packages/memory` — the
 * CLI's 35+ subcommands, the ingestion pipeline and the web server — entirely
 * unchecked, and it was not wired into CI at all. The failure mode is silent in
 * the worst way: `bun run typecheck` passes clean, so the signal says "checked",
 * while a missing import sits in a command nobody type-checks. That is exactly
 * what happened (#171) —
 *
 *     ✗ Unexpected error: ReferenceError: warnLargeBulkWrite is not defined
 *         at action (packages/memory/src/cli/commands/reindex.ts:118:3)
 *
 * — caught only because a live CLI test happened to exercise that path. A
 * subcommand without live coverage would have shipped broken.
 *
 * Reverting either half restores that blind spot while every other signal stays
 * green, so both halves are asserted here rather than trusted.
 *
 * Pure text analysis of the repo. No compiler run, no network.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");

const rootPkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const ci = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf8");

describe("typecheck covers both projects (#171)", () => {
  test("the root script reaches _shared", () => {
    const all = Object.values(rootPkg.scripts).join(" ");
    expect(all).toContain("_shared");
  });

  test("the root script reaches packages/memory", () => {
    // The regression this file exists for: packages/memory dropping out while
    // `typecheck` keeps exiting 0.
    const all = Object.values(rootPkg.scripts).join(" ");
    expect(all).toContain("packages/memory");
  });

  test("`typecheck` invokes both sub-scripts, not just one", () => {
    const entry = rootPkg.scripts.typecheck;
    expect(entry).toBeDefined();
    expect(entry).toContain("typecheck:shared");
    expect(entry).toContain("typecheck:memory");
    // `&&` so a failure in the first halts the run rather than being masked.
    expect(entry).toContain("&&");
  });

  test("CI runs the typecheck script", () => {
    // Wired into CI, not merely available locally — it was neither before #171.
    expect(ci).toContain("bun run typecheck");
  });
});
