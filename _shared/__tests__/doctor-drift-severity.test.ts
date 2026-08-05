/**
 * #137 — doctor's "server is behind this client" reporting.
 *
 * Two checks (schema + RPCs, Edge Functions) can both report drift. They must
 * agree on severity, because the CLI's consolidated remediation only counts
 * checks whose status is `warn`/`error` when deciding between
 * `server deploy`, `--schema-only`, and `--functions-only`. When the EF check
 * reported drift as `skipped` (ℹ), a doubly-stale server was told to run
 * `--schema-only` — silently leaving the Edge Functions behind.
 *
 * These tests pin the decision table rather than the prose, so wording can
 * evolve without breaking them.
 */

import { describe, expect, test } from "bun:test";

import { classifyCompat, compareSemver } from "../compatibility/index.ts";

/** The remediation selector from `doctor.ts`, kept in sync deliberately. */
function remediationFor(statuses: { schema: string; ef: string }): string {
  const stale = (s: string) => s === "warn" || s === "error";
  const needsSchema = stale(statuses.schema);
  const needsEf = stale(statuses.ef);
  if (needsSchema && needsEf) return "full";
  if (needsSchema) return "schema-only";
  if (needsEf) return "functions-only";
  return "none";
}

/** The EF-check severity rule from `checks.ts` (#127 + #137). */
function efStatus(deployed: string, bundled: string, lastChanged: string): string {
  const level = classifyCompat(deployed, "0.6.0", bundled);
  if (level === "below-min") return "error";
  if (level !== "above-min-but-old") return "ok";
  // Label-only drift (deployed already carries the last real change) is a ✓;
  // genuine drift is a warning, matching the schema check.
  return compareSemver(deployed, lastChanged) >= 0 ? "ok" : "warn";
}

describe("EF drift severity (#127 + #137)", () => {
  test("label-only drift stays ✓ (no redeploy nagging for a cosmetic bump)", () => {
    // 1.0.2 stable bumped EF_VERSION without any EF source change.
    expect(efStatus("1.0.1", "1.0.2", "1.0.1")).toBe("ok");
  });

  test("genuine drift is a warning, not informational", () => {
    // v1.0.4 changed EF source; a server still on 1.0.3 is missing it.
    expect(efStatus("1.0.3", "1.0.4", "1.0.4")).toBe("warn");
  });

  test("below the supported minimum stays an error", () => {
    expect(efStatus("0.5.0", "1.0.4", "1.0.4")).toBe("error");
  });

  test("up to date is ✓", () => {
    expect(efStatus("1.0.4", "1.0.4", "1.0.4")).toBe("ok");
  });
});

describe("consolidated remediation (#137)", () => {
  test("both stale → full server deploy (the pre-fix misfire)", () => {
    // The exact v1.0.4 pre-deploy state: schema 0.9.0 vs 0.9.1, EF 1.0.3 vs
    // 1.0.4. Before the fix the EF check was `skipped`, yielding
    // "schema-only" and leaving the Edge Functions stale.
    const ef = efStatus("1.0.3", "1.0.4", "1.0.4");
    expect(remediationFor({ schema: "warn", ef })).toBe("full");
  });

  test("only the schema is stale → --schema-only", () => {
    const ef = efStatus("1.0.4", "1.0.4", "1.0.4");
    expect(remediationFor({ schema: "warn", ef })).toBe("schema-only");
  });

  test("only the EFs are stale → --functions-only", () => {
    const ef = efStatus("1.0.3", "1.0.4", "1.0.4");
    expect(remediationFor({ schema: "ok", ef })).toBe("functions-only");
  });

  test("all current → no remediation line", () => {
    const ef = efStatus("1.0.4", "1.0.4", "1.0.4");
    expect(remediationFor({ schema: "ok", ef })).toBe("none");
  });

  test("label-only EF drift alone does not nag for a redeploy", () => {
    const ef = efStatus("1.0.1", "1.0.2", "1.0.1");
    expect(remediationFor({ schema: "ok", ef })).toBe("none");
  });
});
