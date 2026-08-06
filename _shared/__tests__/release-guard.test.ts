/**
 * Release-cut safety: a release must move the version forward.
 *
 * The mistake this guards against is concrete and unrecoverable: standing on
 * `main` (VERSION 1.1.0-beta.1) and cutting "1.0.7" would tag main's tree —
 * all of 1.1.0 — as a 1.0.x patch and publish it to the stable channel. Tags
 * are immutable here, so there is no clean undo.
 *
 * Mirrors the rule in scripts/cut_release.ts::checkVersionMovesForward.
 */

import { describe, expect, test } from "bun:test";

import { compareSemver } from "../compatibility/index.ts";

const allowed = (branchVersion: string, cutting: string) =>
  compareSemver(cutting, branchVersion) > 0;

describe("cut_release forward-only guard", () => {
  test("refuses a patch of an older line from a branch that is ahead", () => {
    // The exact scenario: main carries 1.1.0-beta.1, someone cuts 1.0.7.
    expect(allowed("1.1.0-beta.1", "1.0.7")).toBe(false);
  });

  test("allows that same patch from the maintenance branch", () => {
    // release/1.0.7, based on the v1.0.6 tag.
    expect(allowed("1.0.6", "1.0.7")).toBe(true);
  });

  test("refuses re-cutting the version already on the branch", () => {
    expect(allowed("1.0.6", "1.0.6")).toBe(false);
  });

  test("allows normal forward cuts, including pre-releases", () => {
    expect(allowed("1.0.6", "1.1.0")).toBe(true);
    expect(allowed("1.1.0-beta.1", "1.1.0-beta.2")).toBe(true);
    expect(allowed("1.1.0-beta.2", "1.1.0")).toBe(true);
  });

  test("refuses going backwards across a pre-release boundary", () => {
    // 1.1.0 is released; cutting 1.1.0-beta.3 afterwards would be a regression.
    expect(allowed("1.1.0", "1.1.0-beta.3")).toBe(false);
  });
});
