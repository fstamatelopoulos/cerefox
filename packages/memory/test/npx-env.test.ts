/**
 * `nestedNpxEnv`: a cerefox started by `npx --package=@cerefox/memory` must
 * not hand npm's package selection to the `npx supabase` it spawns, or that
 * call looks for a `supabase` bin inside @cerefox/memory and fails.
 */

import { expect, test } from "bun:test";

import { nestedNpxEnv } from "../src/cli/util/npx-env.ts";

test("drops npm_config_package and keeps everything else", () => {
  const env = nestedNpxEnv({
    PATH: "/usr/bin",
    npm_config_package: "@cerefox/memory@1.20.0",
    npm_config_yes: "true",
    CEREFOX_CONFIG_DIR: "/x",
  } as NodeJS.ProcessEnv);
  expect(env.npm_config_package).toBeUndefined();
  expect(env).toEqual({ PATH: "/usr/bin", npm_config_yes: "true", CEREFOX_CONFIG_DIR: "/x" });
});

test("does not mutate the environment it is given", () => {
  const original = { npm_config_package: "p" } as NodeJS.ProcessEnv;
  nestedNpxEnv(original);
  expect(original.npm_config_package).toBe("p");
});

test("every npx the CLI spawns passes it", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dir = join(import.meta.dir, "..", "src", "cli", "commands");
  for (const file of ["deploy-server.ts", "token.ts"]) {
    const src = readFileSync(join(dir, file), "utf8");
    const spawns = src.match(/spawnSync\((?:"npx"|cmd),[\s\S]*?\}\)/g) ?? [];
    expect(spawns.length).toBeGreaterThan(0);
    for (const call of spawns) expect(call).toContain("nestedNpxEnv()");
  }
});
