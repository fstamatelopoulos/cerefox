/**
 * `test` for suites that talk to a real backend (#235).
 *
 * bun's per-test default is 5 seconds, and a test that makes real Supabase and
 * OpenAI calls inherits it. On a slow API day such a test fails for no reason,
 * which teaches people that red is normal — the same erosion as a green suite
 * that runs nothing. It bit twice in one release cycle (`ingest-dir` at 22s,
 * `content change → reindexed=true`), each fixed one test at a time, which
 * neither scales nor stops the next one.
 *
 * `bunfig.toml [test] timeout` is not honoured by bun 1.3.13 (verified: the
 * test still died at exactly 5000ms), and a `--timeout` flag on a package
 * script only helps the command nobody runs. So the budget lives in the
 * construct every live test is written with. `live-test-budget.test.ts` keeps
 * live suites on it.
 *
 * Usage mirrors `test`: `liveTest(name, fn)`, `liveTest.skipIf(cond)(name, fn)`.
 * A third argument still overrides the budget for the odd genuinely long case.
 */

import { test } from "bun:test";

/** Generous on purpose: a live test that needs more than this is broken, not slow. */
export const LIVE_TEST_BUDGET_MS = 60_000;

type TestFn = () => void | Promise<void>;

export function liveTest(name: string, fn: TestFn, timeout: number = LIVE_TEST_BUDGET_MS): void {
  test(name, fn, timeout);
}

liveTest.skipIf = (condition: boolean) =>
  (name: string, fn: TestFn, timeout: number = LIVE_TEST_BUDGET_MS): void => {
    test.skipIf(condition)(name, fn, timeout);
  };

liveTest.skip = test.skip;
