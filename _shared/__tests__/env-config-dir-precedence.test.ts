/**
 * CEREFOX_CONFIG_DIR must beat an ambient .env.
 *
 * Bun auto-loads `.env` from the working directory, so a contributor running
 * `bun scripts/*.ts` inside a repo clone already has that file's values in
 * `process.env` before `loadEnv()` runs. Because loadEnv only filled *unset*
 * keys, the named config dir was silently ignored:
 *
 *   CEREFOX_CONFIG_DIR=~/.cerefox/staging bun scripts/db_migrate.ts --status
 *
 * reported production. The same path through `db_deploy.ts --reset` would have
 * wiped production while naming staging on the command line.
 *
 * These run in a subprocess on purpose: the bug only exists when the ambient
 * environment is populated before module load, which is exactly what Bun's
 * auto-dotenv does and what an in-process test cannot reproduce.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONFIG_MOD = join(import.meta.dir, "..", "config", "index.ts");

const roots: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "cfx-env-"));
  roots.push(d);
  return d;
}
afterAll(() => {
  for (const d of roots) rmSync(d, { recursive: true, force: true });
});

/** Resolve CEREFOX_SUPABASE_URL the way a real command would. */
function resolveUrl(opts: { cwd: string; env: Record<string, string> }): string {
  const proc = Bun.spawnSync({
    cmd: [
      "bun",
      "-e",
      `import { loadEnv } from ${JSON.stringify(CONFIG_MOD)};` +
        `loadEnv(); console.log(process.env.CEREFOX_SUPABASE_URL ?? "");`,
    ],
    cwd: opts.cwd,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...opts.env },
  });
  return proc.stdout.toString().trim();
}

describe("loadEnv + CEREFOX_CONFIG_DIR precedence", () => {
  test("the named config dir wins over an auto-loaded working-directory .env", () => {
    const repo = tempDir();
    writeFileSync(join(repo, ".env"), "CEREFOX_SUPABASE_URL=https://production.example\n");

    const staging = tempDir();
    writeFileSync(join(staging, ".env"), "CEREFOX_SUPABASE_URL=https://staging.example\n");

    expect(resolveUrl({ cwd: repo, env: { CEREFOX_CONFIG_DIR: staging } })).toBe(
      "https://staging.example",
    );
  });

  test("without the override, the working-directory .env still applies", () => {
    const repo = tempDir();
    writeFileSync(join(repo, ".env"), "CEREFOX_SUPABASE_URL=https://production.example\n");

    expect(resolveUrl({ cwd: repo, env: {} })).toBe("https://production.example");
  });

  test("the config dir does not rewrite CEREFOX_CONFIG_DIR itself", () => {
    const staging = tempDir();
    writeFileSync(
      join(staging, ".env"),
      "CEREFOX_CONFIG_DIR=/somewhere/else\nCEREFOX_SUPABASE_URL=https://staging.example\n",
    );

    // Still reads staging's file — a self-referential value cannot redirect it.
    expect(resolveUrl({ cwd: tempDir(), env: { CEREFOX_CONFIG_DIR: staging } })).toBe(
      "https://staging.example",
    );
  });
});
