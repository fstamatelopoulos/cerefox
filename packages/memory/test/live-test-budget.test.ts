/**
 * Every live suite must write its tests with `liveTest` (#235).
 *
 * The 60-second budget in `_live-test.ts` only protects a test that is written
 * with it. This is the part that keeps the fix fixed: a new live suite that
 * reaches for bare `test(` inherits bun's 5-second default again, and this
 * file fails loudly instead of leaving the flake latent until release week.
 *
 * Pure text analysis, like `live-write-guard-coverage.test.ts`: no network,
 * no writes.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const TEST_ROOT = join(import.meta.dir);

/**
 * What makes a test file "live": it gates on a backend probe, on the
 * production-write guard, on the Edge Function opt-in, or it constructs a
 * client / pipeline that can reach a store.
 */
const LIVE_MARKERS = [
  /\bmayWriteToLiveTarget\b/,
  /\bprobeSupabase\s*\(/,
  /\bCEREFOX_LIVE_E2E\b/,
  /\bconst LIVE_OK\b/,
  /\bnew IngestionPipeline\b/,
  /\bcreateClient\s*\(/,
];

/** Bare `test(` or `test.skipIf(...)(` — `liveTest` does not match (lookbehind). */
const BARE_TEST = /(?<![\w.])test\s*\(|(?<![\w.])test\.skipIf\s*\(/;

const EXEMPT = new Set([
  "_live-test.ts",
  "live-test-budget.test.ts",
  // Reads the others as text; its own tests are not live.
  "live-write-guard-coverage.test.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function liveFiles(): string[] {
  return walk(TEST_ROOT).filter((f) => {
    if (EXEMPT.has(f.split("/").pop()!)) return false;
    const src = readFileSync(f, "utf8");
    return LIVE_MARKERS.some((re) => re.test(src));
  });
}

/** Strip comments so a `test(` mentioned in prose does not count. */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("live suites carry the live-test budget", () => {
  test("every live suite imports liveTest and uses no bare test()", () => {
    const offenders: string[] = [];
    for (const f of liveFiles()) {
      const src = codeOnly(readFileSync(f, "utf8"));
      const rel = relative(TEST_ROOT, f);
      if (!/\bimport \{[^}]*\bliveTest\b[^}]*\} from "[./]+\/_live-test\.ts"/.test(src)) {
        offenders.push(`${rel}: does not import liveTest`);
        continue;
      }
      const lines = src.split("\n");
      lines.forEach((line, i) => {
        if (BARE_TEST.test(line)) offenders.push(`${rel}:${i + 1}: bare test() — use liveTest()`);
      });
    }
    expect(offenders).toEqual([]);
  });

  test("the detector finds the live suites", () => {
    // If the markers stop matching, the assertion above passes vacuously.
    expect(liveFiles().length).toBeGreaterThanOrEqual(12);
  });

  test("the budget is what the helper applies", async () => {
    const { LIVE_TEST_BUDGET_MS } = await import("./_live-test.ts");
    expect(LIVE_TEST_BUDGET_MS).toBeGreaterThanOrEqual(30_000);
  });
});
