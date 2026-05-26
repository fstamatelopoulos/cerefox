/**
 * TS port of tests/test_paths.py. Same precedence rules covered.
 * Run: `cd _shared && bun test` (or `bun test paths.test.ts`).
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  isDevMode,
  resolveConfigDir,
  resolveEnvFile,
  userStateDir,
  USER_STATE_DIR_NAME,
} from "../config/paths.ts";

let savedEnv: string | undefined;
let tmpDir: string;

beforeEach(() => {
  savedEnv = process.env.CEREFOX_CONFIG_DIR;
  delete process.env.CEREFOX_CONFIG_DIR;
  tmpDir = mkdtempSync(join(tmpdir(), "cerefox-paths-"));
});

afterEach(() => {
  if (savedEnv !== undefined) process.env.CEREFOX_CONFIG_DIR = savedEnv;
  else delete process.env.CEREFOX_CONFIG_DIR;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveConfigDir", () => {
  test("env override wins over dev mode", () => {
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=bar\n");
    const explicit = mkdtempSync(join(tmpdir(), "cerefox-explicit-"));
    try {
      process.env.CEREFOX_CONFIG_DIR = explicit;
      expect(resolveConfigDir({ cwd: tmpDir })).toBe(explicit);
    } finally {
      rmSync(explicit, { recursive: true, force: true });
    }
  });

  test("env override expands tilde", () => {
    process.env.CEREFOX_CONFIG_DIR = "~/custom-cerefox";
    expect(resolveConfigDir({ cwd: tmpDir })).toBe(join(homedir(), "custom-cerefox"));
  });

  test("dev mode wins over user state", () => {
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=bar\n");
    expect(resolveConfigDir({ cwd: tmpDir })).toBe(tmpDir);
  });

  test("user-state dir is the fallback", () => {
    const result = resolveConfigDir({ cwd: tmpDir });
    expect(result).toBe(join(homedir(), USER_STATE_DIR_NAME));
  });

  test("empty env value treated as unset", () => {
    process.env.CEREFOX_CONFIG_DIR = "";
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=bar\n");
    expect(resolveConfigDir({ cwd: tmpDir })).toBe(tmpDir);
  });

  test("whitespace-only env value treated as unset", () => {
    process.env.CEREFOX_CONFIG_DIR = "   ";
    writeFileSync(join(tmpDir, ".env"), "CEREFOX_FOO=bar\n");
    expect(resolveConfigDir({ cwd: tmpDir })).toBe(tmpDir);
  });
});

describe("resolveEnvFile", () => {
  test("returns .env under resolved dir", () => {
    writeFileSync(join(tmpDir, ".env"), "X=1\n");
    expect(resolveEnvFile({ cwd: tmpDir })).toBe(join(tmpDir, ".env"));
  });

  test("uses user-state dir in fallback", () => {
    expect(resolveEnvFile({ cwd: tmpDir })).toBe(
      join(homedir(), USER_STATE_DIR_NAME, ".env"),
    );
  });
});

describe("userStateDir", () => {
  test("returns ~/.cerefox", () => {
    expect(userStateDir()).toBe(join(homedir(), USER_STATE_DIR_NAME));
  });
});

describe("isDevMode", () => {
  test("true when .env in cwd", () => {
    writeFileSync(join(tmpDir, ".env"), "X=1\n");
    expect(isDevMode({ cwd: tmpDir })).toBe(true);
  });

  test("false when no .env in cwd", () => {
    expect(isDevMode({ cwd: tmpDir })).toBe(false);
  });

  test("false when env override set", () => {
    writeFileSync(join(tmpDir, ".env"), "X=1\n");
    const explicit = mkdtempSync(join(tmpdir(), "cerefox-explicit-"));
    try {
      process.env.CEREFOX_CONFIG_DIR = explicit;
      expect(isDevMode({ cwd: tmpDir })).toBe(false);
    } finally {
      rmSync(explicit, { recursive: true, force: true });
    }
  });
});
