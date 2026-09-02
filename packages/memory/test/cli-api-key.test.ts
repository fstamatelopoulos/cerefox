/**
 * `cerefox api-key` (#229) — driven through the built bin against a scratch
 * config dir, so nothing touches the caller's real `.env`.
 *
 * The refusal cases are the reason this file exists. `userError()` RETURNS a
 * CliError rather than throwing it, so `userError(...)` without `throw` is a
 * silent no-op that exits 0 — which is exactly what the first version of this
 * command did. The type checker cannot see it (a discarded return value is
 * legal), and a test that only checked the happy path would not have either.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BIN = join(import.meta.dir, "..", "dist", "bin", "cerefox.js");

let dir: string;

function run(args: string[]) {
  return spawnSync("node", [BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, CEREFOX_CONFIG_DIR: dir, NO_COLOR: "1" },
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cerefox-apikey-"));
  writeFileSync(join(dir, ".env"), "CEREFOX_SUPABASE_URL=https://example.supabase.co\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("cerefox api-key", () => {
  test("show reports an ungated server before any key exists", () => {
    const r = run(["api-key", "show"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("none set");
    // The state matters more than the absence: an operator reading this should
    // learn what it means, not just that a variable is unset.
    expect(r.stdout).toContain("not gated");
  });

  test("generate mints a prefixed key and writes it to the resolved .env", () => {
    const r = run(["api-key", "generate"]);
    expect(r.status).toBe(0);
    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env).toContain("CEREFOX_API_KEY=cfx_lak_");
    // Printed in full exactly once — a key nobody can copy is a key nobody
    // configures.
    const printed = r.stdout.match(/cfx_lak_[A-Za-z0-9_-]+/)?.[0] ?? "";
    expect(printed.length).toBeGreaterThan(20);
    expect(env).toContain(printed);
  });

  test("generate REFUSES when a key already exists, non-zero and loudly", () => {
    expect(run(["api-key", "generate"]).status).toBe(0);
    const second = run(["api-key", "generate"]);
    expect(second.status).not.toBe(0);
    expect(`${second.stdout}${second.stderr}`).toContain("already set");
    // And it must not have silently replaced the key it refused to overwrite.
    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env.match(/CEREFOX_API_KEY=/g)?.length).toBe(1);
  });

  test("rotate REFUSES when there is nothing to rotate", () => {
    const r = run(["api-key", "rotate"]);
    expect(r.status).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("nothing to rotate");
  });

  test("rotate replaces the key with a different one", () => {
    run(["api-key", "generate"]);
    const before = readFileSync(join(dir, ".env"), "utf8").match(/cfx_lak_[A-Za-z0-9_-]+/)?.[0];
    const r = run(["api-key", "rotate"]);
    expect(r.status).toBe(0);
    const after = readFileSync(join(dir, ".env"), "utf8").match(/cfx_lak_[A-Za-z0-9_-]+/)?.[0];
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
    // Still exactly one key line — a rotation that appends rather than
    // replaces would leave the old key accepted forever.
    const env = readFileSync(join(dir, ".env"), "utf8");
    expect(env.match(/^CEREFOX_API_KEY=/gm)?.length).toBe(1);
  });

  test("show prints the key in full, for pasting into a client", () => {
    run(["api-key", "generate"]);
    const key = readFileSync(join(dir, ".env"), "utf8").match(/cfx_lak_[A-Za-z0-9_-]+/)?.[0];
    const r = run(["api-key", "show"]);
    expect(r.status).toBe(0);
    // Deliberately unmasked, unlike `token list`: the command exists to hand
    // the value to a caller, and it reads a file that caller can already read.
    expect(r.stdout).toContain(key);
  });

  test("--dry-run writes nothing", () => {
    const r = run(["api-key", "generate", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(readFileSync(join(dir, ".env"), "utf8")).not.toContain("CEREFOX_API_KEY");
  });
});
