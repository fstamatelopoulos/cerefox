/**
 * Every test file that can write to a live store must consult the
 * production-write guard.
 *
 * The guard itself (`_live-target-guard.ts`) was added after `bun test` wrote
 * to the production store twice. It was then applied to the two suites found by
 * grepping for CLI-shaped writes — and that enumeration was wrong. Two
 * pipeline-level suites (`pipeline-ingest-text`, `pipeline-update`) construct
 * `IngestionPipeline` directly, matched none of those patterns, and kept
 * writing: a supposedly-fixed `bun test` still added 44 audit rows to
 * production, and the `[E2E pipeline-ingest]` / `[E2E pipeline-update]`
 * fixtures the maintainer had seen were exactly those.
 *
 * So the lesson is not "add the guard to those files too" — it is that a
 * hand-maintained list of write-bearing suites is the wrong instrument. This
 * derives the list instead: anything that builds a live client, a live
 * pipeline, or drives the CLI binary is treated as write-capable and must
 * import the guard.
 *
 * Pure text analysis. No network, no writes — which is rather the point.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const TEST_ROOT = join(import.meta.dir);

/** Constructs that give a test file the ability to write to a real store. */
const LIVE_CAPABLE = [
  /\bnew IngestionPipeline\b/,
  /\bcreateClient\s*\(/,
  /\bloadSettings\s*\(/,
  /\bTOOLS_BY_NAME\b/,
];

/** Files that are allowed to look live-capable without the guard. */
const EXEMPT = new Set([
  "_live-target-guard.ts",
  // This file: it reads the others as text.
  "live-write-guard-coverage.test.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** Test files that can reach a real store, by construction rather than by list. */
function liveCapableFiles(): string[] {
  return walk(TEST_ROOT).filter((f) => {
    const rel = relative(TEST_ROOT, f);
    if (EXEMPT.has(rel) || EXEMPT.has(rel.split("/").pop()!)) return false;
    const src = readFileSync(f, "utf8");
    return LIVE_CAPABLE.some((re) => re.test(src));
  });
}

describe("production-write guard covers every live suite", () => {
  test("every live-capable test file consults the guard", () => {
    const missing = liveCapableFiles()
      .filter((f) => !readFileSync(f, "utf8").includes("mayWriteToLiveTarget"))
      .map((f) => relative(TEST_ROOT, f));

    // A file here can create documents in whatever store the ambient
    // credentials point at — which on a maintainer's machine is production.
    expect(missing).toEqual([]);
  });

  test("the detector finds a non-trivial number of live suites", () => {
    // If the patterns ever stop matching, every assertion above passes
    // vacuously — the same silence as the bug.
    expect(liveCapableFiles().length).toBeGreaterThanOrEqual(6);
  });

  test("the guard refuses an unlabelled target by default", async () => {
    const { mayWriteToLiveTarget } = await import("./_live-target-guard.ts");
    const savedLabel = process.env.CEREFOX_ENV_LABEL;
    const savedOverride = process.env.CEREFOX_ALLOW_PROD_WRITE_TESTS;
    const savedDir = process.env.CEREFOX_CONFIG_DIR;
    try {
      delete process.env.CEREFOX_ENV_LABEL;
      delete process.env.CEREFOX_ALLOW_PROD_WRITE_TESTS;
      // Point at a directory with no config, so no file can supply a label.
      process.env.CEREFOX_CONFIG_DIR = join(import.meta.dir, "__no_such_config__");
      expect(mayWriteToLiveTarget()).toBe(false);

      process.env.CEREFOX_ENV_LABEL = "staging";
      expect(mayWriteToLiveTarget()).toBe(true);

      delete process.env.CEREFOX_ENV_LABEL;
      process.env.CEREFOX_ALLOW_PROD_WRITE_TESTS = "1";
      expect(mayWriteToLiveTarget()).toBe(true);
    } finally {
      if (savedLabel === undefined) delete process.env.CEREFOX_ENV_LABEL;
      else process.env.CEREFOX_ENV_LABEL = savedLabel;
      if (savedOverride === undefined) delete process.env.CEREFOX_ALLOW_PROD_WRITE_TESTS;
      else process.env.CEREFOX_ALLOW_PROD_WRITE_TESTS = savedOverride;
      if (savedDir === undefined) delete process.env.CEREFOX_CONFIG_DIR;
      else process.env.CEREFOX_CONFIG_DIR = savedDir;
    }
  });
});
