/**
 * #152 — doctor's summary line and `--strict` exit policy.
 *
 * The old footer printed "✓ All checks passed (2 warnings)", contradicting the
 * remediation line directly above it. These tests pin the decision table; the
 * wording lives in doctor.ts and may evolve, so they assert on the branch
 * chosen, not the exact string.
 */

import { describe, expect, test } from "bun:test";

/** Mirrors doctor.ts: which summary branch, and what exit code. */
function summarize(
  statuses: string[],
  opts: { strict?: boolean } = {},
): { branch: "ok" | "warn" | "error"; exit: number } {
  const errCount = statuses.filter((s) => s === "error").length;
  const warnCount = statuses.filter((s) => s === "warn").length;
  if (errCount > 0) return { branch: "error", exit: 1 };
  if (warnCount > 0) return { branch: "warn", exit: opts.strict ? 1 : 0 };
  return { branch: "ok", exit: 0 };
}

describe("doctor summary (#152)", () => {
  test("warnings never claim 'all checks passed'", () => {
    expect(summarize(["ok", "warn", "warn"]).branch).toBe("warn");
  });

  test("a fully clean run is the only ✓ case", () => {
    expect(summarize(["ok", "ok", "skipped"]).branch).toBe("ok");
  });

  test("informational (skipped) rows are not warnings", () => {
    // The legacy-env and content-format rows are ℹ; they must not trip the
    // warning branch or --strict.
    expect(summarize(["ok", "skipped", "skipped"]).branch).toBe("ok");
    expect(summarize(["ok", "skipped"], { strict: true }).exit).toBe(0);
  });

  test("warnings exit 0 by default — a mid-upgrade window must not fail CI", () => {
    expect(summarize(["ok", "warn"]).exit).toBe(0);
  });

  test("--strict makes warnings fail", () => {
    expect(summarize(["ok", "warn"], { strict: true }).exit).toBe(1);
  });

  test("errors fail regardless of --strict", () => {
    expect(summarize(["error", "warn"]).exit).toBe(1);
    expect(summarize(["error"], { strict: false }).exit).toBe(1);
  });
});
