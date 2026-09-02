/**
 * The web daemon's pidfile/log location.
 *
 * This matters beyond tidiness: before the state dir followed
 * `CEREFOX_CONFIG_DIR`, a staging `cerefox web start` wrote its pid over
 * production's, so a later `cerefox web stop` aimed at the wrong process and
 * killed the production server. See docs/guides/staging-env.md.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { resolveStateDir } from "../src/web/daemon.ts";

const HOME = "/home/tester";

describe("resolveStateDir", () => {
  test("defaults to ~/.cerefox when no override is set", () => {
    // `override` DEFAULTS to process.env.CEREFOX_CONFIG_DIR, so passing
    // `undefined` does not mean "unset" — it means "read the environment".
    // The ambient value has to go for the duration, or this test fails under
    // the documented staging invocation
    // (`CEREFOX_CONFIG_DIR=~/.cerefox/staging bun test`), which is exactly how
    // it was failing: a red test under the command the guides tell you to run
    // teaches people that red is normal.
    const saved = process.env.CEREFOX_CONFIG_DIR;
    delete process.env.CEREFOX_CONFIG_DIR;
    try {
      expect(resolveStateDir(undefined, HOME)).toBe(join(HOME, ".cerefox"));
    } finally {
      if (saved === undefined) delete process.env.CEREFOX_CONFIG_DIR;
      else process.env.CEREFOX_CONFIG_DIR = saved;
    }
  });

  test("treats an empty or whitespace override as unset", () => {
    expect(resolveStateDir("", HOME)).toBe(join(HOME, ".cerefox"));
    expect(resolveStateDir("   ", HOME)).toBe(join(HOME, ".cerefox"));
  });

  test("follows an explicit CEREFOX_CONFIG_DIR", () => {
    expect(resolveStateDir("/opt/cerefox/staging", HOME)).toBe("/opt/cerefox/staging");
  });

  test("expands a leading tilde", () => {
    expect(resolveStateDir("~/.cerefox/staging", HOME)).toBe(join(HOME, ".cerefox/staging"));
    expect(resolveStateDir("~", HOME)).toBe(HOME);
  });

  test("staging and production never share a state dir", () => {
    const prod = resolveStateDir(undefined, HOME);
    const staging = resolveStateDir("~/.cerefox/staging", HOME);
    expect(staging).not.toBe(prod);
  });
});
