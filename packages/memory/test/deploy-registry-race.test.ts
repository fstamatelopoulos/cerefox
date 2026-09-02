/**
 * `upstreamRegistryRace()` — the predicate behind the deploy-failure hint.
 *
 * The input strings here are not invented: the first is the verbatim reply
 * from the 2026-09-02 production deploy, which failed because JSR published
 * `supabase-js@2.113.0` at 06:03:13Z and npm published its `auth-js`
 * dependency at 06:05:01Z. A deploy inside that 108-second window resolves a
 * JSR package whose npm dependency does not exist yet.
 *
 * The predicate's job is to tell that transient, self-healing, upstream
 * condition apart from a real deploy failure, because the two need opposite
 * advice: "wait and re-run" versus "fix the cause".
 */

import { describe, expect, test } from "bun:test";

import { upstreamRegistryRace } from "../src/cli/commands/deploy-server.ts";

const REAL_FAILURE_2026_09_02 =
  'unexpected deploy status 400: {"message":"Failed to bundle the function ' +
  "(reason: Could not find npm package '@supabase/auth-js' matching " +
  "'2.113.0'.\\n    at https://jsr.io/@supabase/supabase-js/2.113.0/src/lib/" +
  'types.ts:1:37)."}\nTry rerunning the command with --debug to troubleshoot the error.';

describe("upstreamRegistryRace", () => {
  test("recognises the verbatim 2026-09-02 production failure", () => {
    expect(upstreamRegistryRace(REAL_FAILURE_2026_09_02)).toBe(true);
  });

  test("recognises the same race on a different dependency", () => {
    // Matched on the bundler's phrasing, not on a package name: the race can
    // happen with any transitive dependency, so pinning one name would make
    // the hint silently stop firing.
    expect(
      upstreamRegistryRace(
        'Failed to bundle the function (reason: Could not find npm package ' +
          "'@supabase/realtime-js' matching '2.99.0'.)",
      ),
    ).toBe(true);
  });

  test("fires when several functions failed and their output is concatenated", () => {
    // The real call site joins every failed function's output; a deploy of 9
    // functions produces 9 copies.
    const joined = Array.from({ length: 9 }, () => REAL_FAILURE_2026_09_02).join("\n");
    expect(upstreamRegistryRace(joined)).toBe(true);
  });

  test("does NOT fire on an unrelated bundling failure", () => {
    // A genuine code error also says "Failed to bundle" — showing "wait a few
    // minutes and re-run" here would send someone to wait out a syntax error.
    expect(
      upstreamRegistryRace(
        "Failed to bundle the function (reason: The module's source code could " +
          "not be parsed: Expected ';', got '}' at file:///src/index.ts:42:1)",
      ),
    ).toBe(false);
  });

  test("does NOT fire on an auth or permission failure", () => {
    expect(
      upstreamRegistryRace("unexpected deploy status 401: {\"message\":\"Unauthorized\"}"),
    ).toBe(false);
  });

  test("does NOT fire on a missing-package message without a bundling failure", () => {
    // Both halves are required: "could not find npm package" alone shows up in
    // unrelated npm/npx chatter, and reaching for the hint there would be a
    // confident wrong answer.
    expect(
      upstreamRegistryRace("npm warn Could not find npm package 'left-pad' matching '1.0.0'"),
    ).toBe(false);
  });

  test("is empty-safe", () => {
    // spawnSync can return null stdout/stderr on a timeout; the call site
    // joins them into "" rather than crashing the error path.
    expect(upstreamRegistryRace("")).toBe(false);
  });
});
