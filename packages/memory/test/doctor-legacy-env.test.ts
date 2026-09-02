/**
 * `doctor`'s `legacy env` check must ask the resolver, not invent its own rules.
 *
 * Two bugs (iter-40, #225), both from the check hardcoding what
 * `resolveConfigDir()` already knows:
 *
 *  1. It named `~/.cerefox/.env` as the shadower unconditionally, so under
 *     `CEREFOX_CONFIG_DIR` (the staging convention) `doctor` printed a `config`
 *     line and a `legacy env` line naming two different authorities.
 *  2. It fired on the existence of any `<cwd>/.env`, without the `CEREFOX_*`-key
 *     test the resolver has used since iter-24 — so running `cerefox` inside an
 *     unrelated project named that project's `.env` and called it safe to delete.
 *
 * Every case here drives the resolver through `ResolverOptions` and
 * `CEREFOX_CONFIG_DIR` rather than asserting on a literal path. That is the
 * point: an assertion that the message says `~/.cerefox/.env` passes both
 * before the fix and after a wrong one.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkLegacyShadowEnv } from "../src/cli/util/checks.ts";

const roots: string[] = [];
function tempRoot(): string {
  const d = mkdtempSync(join(tmpdir(), "cfx-legacyenv-"));
  roots.push(d);
  return d;
}

const CEREFOX_ENV = "CEREFOX_SUPABASE_URL=https://example.supabase.co\n";
const FOREIGN_ENV = "DATABASE_URL=postgres://localhost/other\nPORT=3000\n";

/**
 * Build a home dir with `~/.cerefox/.env` and a separate working dir whose
 * `.env` contains `body`. Returns both paths.
 */
function scaffold(body: string): { home: string; cwd: string; homeEnv: string } {
  const root = tempRoot();
  const home = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(join(home, ".cerefox"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const homeEnv = join(home, ".cerefox", ".env");
  writeFileSync(homeEnv, CEREFOX_ENV);
  writeFileSync(join(cwd, ".env"), body);
  return { home, cwd, homeEnv };
}

const savedConfigDir = process.env.CEREFOX_CONFIG_DIR;
afterEach(() => {
  if (savedConfigDir === undefined) delete process.env.CEREFOX_CONFIG_DIR;
  else process.env.CEREFOX_CONFIG_DIR = savedConfigDir;
  for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("checkLegacyShadowEnv", () => {
  test("reports the home env as the shadower when it is the active config", () => {
    delete process.env.CEREFOX_CONFIG_DIR;
    const { home, cwd, homeEnv } = scaffold(CEREFOX_ENV);

    const result = checkLegacyShadowEnv({ home, cwd });

    expect(result).not.toBeNull();
    expect(result?.name).toBe("legacy env");
    expect(result?.detail).toContain(join(cwd, ".env"));
    expect(result?.detail).toContain(homeEnv);
    expect(result?.hint).toContain(homeEnv);
  });

  test("names the CEREFOX_CONFIG_DIR env file, not the home one (#225)", () => {
    const { home, cwd } = scaffold(CEREFOX_ENV);
    const staging = join(tempRoot(), "staging");
    mkdirSync(staging, { recursive: true });
    const stagingEnv = join(staging, ".env");
    writeFileSync(stagingEnv, CEREFOX_ENV);
    process.env.CEREFOX_CONFIG_DIR = staging;

    const result = checkLegacyShadowEnv({ home, cwd });

    expect(result).not.toBeNull();
    // The active config file is the one named as doing the shadowing...
    expect(result?.detail).toContain(stagingEnv);
    expect(result?.hint).toContain(stagingEnv);
    // ...and the home file, which is NOT in effect, is not mentioned at all.
    expect(result?.detail).not.toContain(join(home, ".cerefox", ".env"));
    expect(result?.hint).not.toContain(join(home, ".cerefox", ".env"));
  });

  test("stays silent on an unrelated project's .env (#225)", () => {
    delete process.env.CEREFOX_CONFIG_DIR;
    const { home, cwd } = scaffold(FOREIGN_ENV);

    // No CEREFOX_* key in that file, so it is not ours and we must not offer
    // to delete it.
    expect(checkLegacyShadowEnv({ home, cwd })).toBeNull();
  });

  test("stays silent when the CWD env IS the active config (dev mode)", () => {
    delete process.env.CEREFOX_CONFIG_DIR;
    const root = tempRoot();
    const home = join(root, "home");
    const cwd = join(root, "project");
    // No ~/.cerefox/.env at all, so the resolver falls back to the CWD file.
    mkdirSync(home, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, ".env"), CEREFOX_ENV);

    expect(checkLegacyShadowEnv({ home, cwd })).toBeNull();
  });

  test("stays silent when there is no CWD env", () => {
    delete process.env.CEREFOX_CONFIG_DIR;
    const root = tempRoot();
    const home = join(root, "home");
    const cwd = join(root, "project");
    mkdirSync(join(home, ".cerefox"), { recursive: true });
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(home, ".cerefox", ".env"), CEREFOX_ENV);

    expect(checkLegacyShadowEnv({ home, cwd })).toBeNull();
  });

  test("the CEREFOX_* test is the resolver's, not a copy", () => {
    delete process.env.CEREFOX_CONFIG_DIR;
    // A file that mentions cerefox but declares no CEREFOX_ key must not count:
    // this pins the predicate to a key match rather than a substring search,
    // which is the shape a re-implementation would get wrong.
    const { home, cwd } = scaffold("# cerefox notes\nOTHER=CEREFOX_SUPABASE_URL\n");
    expect(checkLegacyShadowEnv({ home, cwd })).toBeNull();
  });
});
