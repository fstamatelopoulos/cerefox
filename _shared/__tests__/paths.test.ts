/**
 * Tests for `_shared/config/paths.ts`. Covers the v0.5.3 precedence
 * inversion: `~/.cerefox/.env` (when it exists) wins over repo-local
 * `<cwd>/.env`, with the legacy dev-mode fallback retained for existing
 * users who haven't migrated.
 *
 * Run: `cd _shared && bun test` (or `bun test paths.test.ts`).
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  hasLegacyCwdEnv,
  isDevMode,
  resolveConfigDir,
  resolveEnvFile,
  userStateDir,
  USER_STATE_DIR_NAME,
} from "../config/paths.ts";

let savedEnv: string | undefined;
let tmpDir: string;
let fakeHome: string;

beforeEach(() => {
  savedEnv = process.env.CEREFOX_CONFIG_DIR;
  delete process.env.CEREFOX_CONFIG_DIR;
  tmpDir = mkdtempSync(join(tmpdir(), "cerefox-paths-cwd-"));
  fakeHome = mkdtempSync(join(tmpdir(), "cerefox-paths-home-"));
});

afterEach(() => {
  if (savedEnv !== undefined) process.env.CEREFOX_CONFIG_DIR = savedEnv;
  else delete process.env.CEREFOX_CONFIG_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
});

function writeHomeEnv(): string {
  const dir = join(fakeHome, USER_STATE_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, ".env");
  writeFileSync(p, "CEREFOX_FOO=home\n");
  return p;
}

describe("resolveConfigDir — v0.5.3 precedence", () => {
  test("env override wins over everything else", () => {
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=cwd\n");
    writeHomeEnv();
    const explicit = mkdtempSync(join(tmpdir(), "cerefox-explicit-"));
    try {
      process.env.CEREFOX_CONFIG_DIR = explicit;
      expect(resolveConfigDir({ cwd: tmpDir, home: fakeHome })).toBe(explicit);
    } finally {
      rmSync(explicit, { recursive: true, force: true });
    }
  });

  test("env override expands tilde", () => {
    process.env.CEREFOX_CONFIG_DIR = "~/custom-cerefox";
    expect(resolveConfigDir({ cwd: tmpDir, home: fakeHome })).toBe(
      join(homedir(), "custom-cerefox"),
    );
  });

  test("~/.cerefox/.env wins over CWD .env when both exist (v0.5.3 inversion)", () => {
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=cwd\n");
    writeHomeEnv();
    expect(resolveConfigDir({ cwd: tmpDir, home: fakeHome })).toBe(
      join(fakeHome, USER_STATE_DIR_NAME),
    );
  });

  test("CWD .env wins when ~/.cerefox/.env doesn't exist (legacy dev-mode)", () => {
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=cwd\n");
    // No home env written.
    expect(resolveConfigDir({ cwd: tmpDir, home: fakeHome })).toBe(tmpDir);
  });

  test("~/.cerefox/ is the fallback when neither home env nor CWD .env exist", () => {
    const result = resolveConfigDir({ cwd: tmpDir, home: fakeHome });
    expect(result).toBe(join(fakeHome, USER_STATE_DIR_NAME));
  });

  test("empty env value treated as unset", () => {
    process.env.CEREFOX_CONFIG_DIR = "";
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=cwd\n");
    expect(resolveConfigDir({ cwd: tmpDir, home: fakeHome })).toBe(tmpDir);
  });

  test("whitespace-only env value treated as unset", () => {
    process.env.CEREFOX_CONFIG_DIR = "   ";
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=cwd\n");
    expect(resolveConfigDir({ cwd: tmpDir, home: fakeHome })).toBe(tmpDir);
  });
});

describe("resolveEnvFile", () => {
  test("returns ~/.cerefox/.env when home file exists (v0.5.3)", () => {
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=1\n");
    writeHomeEnv();
    expect(resolveEnvFile({ cwd: tmpDir, home: fakeHome })).toBe(
      join(fakeHome, USER_STATE_DIR_NAME, ".env"),
    );
  });

  test("returns CWD .env in legacy dev-mode", () => {
    // Tightened in iter-24K: legacy fallback requires the CWD .env to
    // contain at least one CEREFOX_* key. An unrelated Node project's
    // .env (no Cerefox keys) doesn't trip the fallback.
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=cwd\n");
    expect(resolveEnvFile({ cwd: tmpDir, home: fakeHome })).toBe(join(tmpDir, ".env"));
  });

  test("ignores unrelated CWD .env without any CEREFOX_* keys (iter-24K)", () => {
    // Protects users who run `cerefox` from an unrelated Node project:
    // its DATABASE_URL=… / OPENAI_API_KEY=… would otherwise silently
    // bleed into Cerefox's config resolution. Now falls back to
    // ~/.cerefox/.env (the materialise-on-init path).
    writeFileSync(join(tmpDir, ".env"), "DATABASE_URL=postgres://elsewhere\nFOO=bar\n");
    expect(resolveEnvFile({ cwd: tmpDir, home: fakeHome })).toBe(
      join(fakeHome, USER_STATE_DIR_NAME, ".env"),
    );
  });

  test("returns ~/.cerefox/.env when nothing exists (caller materialises)", () => {
    expect(resolveEnvFile({ cwd: tmpDir, home: fakeHome })).toBe(
      join(fakeHome, USER_STATE_DIR_NAME, ".env"),
    );
  });
});

describe("userStateDir", () => {
  test("returns the home-rooted ~/.cerefox path", () => {
    expect(userStateDir({ home: fakeHome })).toBe(join(fakeHome, USER_STATE_DIR_NAME));
  });

  test("defaults to real homedir() when no override", () => {
    expect(userStateDir()).toBe(join(homedir(), USER_STATE_DIR_NAME));
  });
});

describe("isDevMode (v0.5.3 — reflects actual behavior)", () => {
  test("true when CWD .env exists and home env doesn't", () => {
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=1\n");
    expect(isDevMode({ cwd: tmpDir, home: fakeHome })).toBe(true);
  });

  test("false when both CWD .env AND home env exist (home wins)", () => {
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=1\n");
    writeHomeEnv();
    expect(isDevMode({ cwd: tmpDir, home: fakeHome })).toBe(false);
  });

  test("false when no .env in CWD", () => {
    expect(isDevMode({ cwd: tmpDir, home: fakeHome })).toBe(false);
  });

  test("false when env override set", () => {
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=1\n");
    const explicit = mkdtempSync(join(tmpdir(), "cerefox-explicit-"));
    try {
      process.env.CEREFOX_CONFIG_DIR = explicit;
      expect(isDevMode({ cwd: tmpDir, home: fakeHome })).toBe(false);
    } finally {
      rmSync(explicit, { recursive: true, force: true });
    }
  });
});

describe("hasLegacyCwdEnv (v0.5.3 — for doctor shadow detection)", () => {
  test("true when CWD .env exists, regardless of home env", () => {
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=1\n");
    writeHomeEnv();
    // Even though home wins for resolution, the legacy file still exists.
    expect(hasLegacyCwdEnv({ cwd: tmpDir, home: fakeHome })).toBe(true);
  });

  test("false when no .env in CWD", () => {
    writeHomeEnv();
    expect(hasLegacyCwdEnv({ cwd: tmpDir, home: fakeHome })).toBe(false);
  });
});
