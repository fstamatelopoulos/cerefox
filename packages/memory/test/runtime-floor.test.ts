/**
 * The runtime floor is stated in two places and they must agree.
 *
 * `engines.node` in `packages/memory/package.json` is what npm reads.
 * `MIN_NODE_MAJOR` in `cli/util/checks.ts` is what `cerefox doctor` enforces.
 * They drifted the moment the floor moved: the baseline went to Node 24 while
 * `checkRuntime()` still passed anything `>= 20`, so a user on Node 22 got a
 * GREEN runtime line from `doctor` on a platform CI no longer tests.
 *
 * That drift matters more than it looks, because `doctor` is the only real
 * enforcement. npm's `engines` is advisory under the default
 * `engine-strict=false`: `npm install -g @cerefox/memory` on an unsupported
 * Node succeeds with an `EBADENGINE` warning, which is one line in a wall of
 * install output. `install.sh` does refuse, but the README offers the npm
 * command as an alternative to the installer, so the installer's refusal is
 * not on every path.
 *
 * Pure text + import analysis: no network, no writes.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { MIN_NODE_MAJOR } from "../src/cli/util/checks.ts";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function enginesNodeMajor(): number {
  const pkg = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")) as {
    engines?: { node?: string };
  };
  const spec = pkg.engines?.node;
  expect(spec, "packages/memory/package.json must declare engines.node").toBeTruthy();
  const m = /(\d+)/.exec(spec!);
  expect(m, `could not read a major version out of engines.node = ${spec}`).toBeTruthy();
  return Number.parseInt(m![1]!, 10);
}

describe("the Node floor is one number, not two", () => {
  test("checkRuntime's floor matches engines.node", () => {
    expect(MIN_NODE_MAJOR).toBe(enginesNodeMajor());
  });

  test("the floor is a plausible major, so neither side can be read as 0", () => {
    // A parse that silently yields 0 would make the assertion above pass while
    // enforcing nothing — the shape of vacuous guard this repo has hit before.
    expect(MIN_NODE_MAJOR).toBeGreaterThanOrEqual(20);
    expect(enginesNodeMajor()).toBeGreaterThanOrEqual(20);
  });

  test("the installer refuses below the same floor", () => {
    // install.sh is the other enforcement point, and it carries the number as a
    // shell literal that no import can reach. Assert the literal is present, so
    // moving the floor without touching the installer fails here rather than in
    // a user's terminal.
    const sh = readFileSync(join(PKG_ROOT, "..", "..", "install.sh"), "utf8");
    expect(sh).toContain(`-lt ${MIN_NODE_MAJOR} `);
    expect(sh).toContain(`requires Node ≥ ${MIN_NODE_MAJOR}`);
  });
});
