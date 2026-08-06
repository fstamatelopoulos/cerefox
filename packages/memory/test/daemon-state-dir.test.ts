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
    expect(resolveStateDir(undefined, HOME)).toBe(join(HOME, ".cerefox"));
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
