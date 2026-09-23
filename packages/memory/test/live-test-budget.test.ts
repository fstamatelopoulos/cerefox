/**
 * Two properties every live suite must have: the `liveTest` budget (#235), and
 * a REACHABILITY gate (#275).
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

/**
 * A live suite must decide whether to run by ASKING THE BACKEND.
 *
 * Gating on configuration instead is how a paused staging project produced 22
 * failures rather than 22 skips: the credentials were all still present, so
 * `LIVE_OK` was true, every test ran, and every one died on a connection
 * error. "Configured", "permitted to write" and "reachable" are three
 * different questions, and only the third justifies running.
 *
 * The gate must be the SHARED probe. Four suites used to spawn
 * `project list --json` privately, and that duplication is exactly what let
 * the web-integration suite skip silently for eleven releases when the verb
 * was renamed. One implementation, so a rename breaks it loudly in one place.
 */
describe("live suites gate on reachability", () => {
  /** How a suite may legitimately establish that the target is up. */
  const REACHABILITY_GATES = [
    // The shared probe: asks the Data API, throws if the probe command itself
    // is rejected so a broken harness cannot look like an absent store.
    /\bprobeSupabase\s*\(/,
    // The Edge Function suites are opt-in and skip by default, which is a
    // stronger gate than a probe: they do not run unless asked.
    /\bCEREFOX_LIVE_E2E\b/,
    // Spawns the web server and skips when it will not start (the helper
    // returns null, which every caller treats as "skip").
    /\bspawnWebServer\s*\(/,
  ];

  /** `const someProbe = run(["project", "list", …])` — a private copy of the argv. */
  const PRIVATE_SUPABASE_PROBE =
    /(?:const|let)\s+(\w*[Pp]robe\w*)\s*=\s*run\(\s*\[\s*"project"\s*,\s*"list"/g;

  test("every live suite consults a reachability gate", () => {
    const offenders: string[] = [];
    for (const f of liveFiles()) {
      const src = codeOnly(readFileSync(f, "utf8"));
      if (!REACHABILITY_GATES.some((re) => re.test(src))) {
        offenders.push(
          `${relative(TEST_ROOT, f)}: decides whether to run without asking whether the ` +
            `backend is up — add probeSupabase() from _live-probe.ts`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  test("no suite spawns its own copy of the probe command", () => {
    // The probe argv lives in `_live-probe.ts` and nowhere else. A private
    // copy is a list that has to match the CLI's verbs, and that shape has
    // produced four incidents on this project.
    const offenders: string[] = [];
    for (const f of walk(TEST_ROOT)) {
      // This file quotes the offending shape as a test fixture, and
      // `_live-probe.ts` is where the argv is supposed to live.
      if (f.endsWith("_live-probe.ts") || f.endsWith("live-test-budget.test.ts")) continue;
      const src = codeOnly(readFileSync(f, "utf8"));
      const rel = relative(TEST_ROOT, f);
      // Specifically the SUPABASE probe argv bound to a probe-shaped local.
      // Two things must not trip this: exercising `project list` as the thing
      // under test (read-commands does, legitimately), and probing something
      // else entirely — lifecycle-commands probes the npm registry with
      // `self-update --check`, which is a different question and stays local.
      for (const m of src.matchAll(PRIVATE_SUPABASE_PROBE)) {
        offenders.push(`${rel}: private probe \`${m[1]}\` — use probeSupabase()`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("both gates fire on the shapes they exist to catch", () => {
    // A guard that cannot fail is not a guard.
    const configOnly = `
      const LIVE_OK = mayWriteToLiveTarget() && SUPABASE_URL.length > 0;
      liveTest("writes", async () => {});
    `;
    expect(REACHABILITY_GATES.some((re) => re.test(configOnly))).toBe(false);

    const gated = `
      import { probeSupabase } from "./_live-probe.ts";
      const LIVE_OK = mayWriteToLiveTarget() && probeSupabase();
    `;
    expect(REACHABILITY_GATES.some((re) => re.test(gated))).toBe(true);

    const privateProbe = `const liveProbe = run(["project", "list", "--json"]);`;
    expect([...privateProbe.matchAll(PRIVATE_SUPABASE_PROBE)]).toHaveLength(1);
    // And the npm-registry probe, which is a different question, must NOT trip it.
    const npmProbe = `const probe = run(["self-update", "--check"]);`;
    expect([...npmProbe.matchAll(PRIVATE_SUPABASE_PROBE)]).toHaveLength(0);
  });
});
