/**
 * Smoke tests for `cerefox deploy-server` (iter-26 Part 26D).
 *
 * The real deploy (schema via Postgres + `npx supabase functions deploy`)
 * needs a linked Supabase project + the Supabase CLI, validated in the
 * staging walk. Here we cover the CLI surface + the pre-flight
 * remediation path (which is deterministic and needs no network).
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

function run(
  args: string[],
  env: Record<string, string> = {},
): { stdout: string; stderr: string; status: number } {
  if (!existsSync(BIN)) {
    throw new Error(`Built bin not found at ${BIN}. Run \`bun run build\` first.`);
  }
  const result = spawnSync("node", [BIN, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

describe("cerefox deploy-server CLI", () => {
  test("--help advertises the flags", () => {
    const { stdout, status } = run(["server", "deploy", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--schema-only");
    expect(stdout).toContain("--functions-only");
    // v0.8.2: --project-ref overrides the ref derived from CEREFOX_SUPABASE_URL.
    expect(stdout).toContain("--project-ref");
    // --reset was removed in v0.8.1 — it lives only in scripts/db_deploy.ts now.
    expect(stdout).not.toContain("--reset");
  });

  test("--schema-only --dry-run runs pre-flight + plan without deploying", () => {
    // Provide a DB URL so the schema pre-flight passes; --dry-run skips
    // the actual connection. Functions checks are skipped via --schema-only,
    // so this exercises the schema-side plan deterministically.
    const { stdout, status } = run(["server", "deploy", "--schema-only", "--dry-run"], {
      CEREFOX_DATABASE_URL: "postgresql://user:pass@localhost:5432/postgres",
    });
    expect(status).toBe(0);
    expect(stdout).toContain("pre-flight");
    expect(stdout).toContain("Plan:");
    expect(stdout).toContain("--dry-run");
  });

  test("missing CEREFOX_DATABASE_URL → pre-flight refuses with remediation", () => {
    // An empty string in the child env is not enough: the CLI calls loadEnv(),
    // which fills unset keys from the RESOLVED config file. Run this against a
    // scratch config dir with no .env at all, so nothing ambient can supply the
    // value. Without it the test fails under the documented staging invocation
    // (`CEREFOX_CONFIG_DIR=~/.cerefox/staging bun test`), because that .env
    // legitimately defines CEREFOX_DATABASE_URL — a red test caused by the
    // environment being correctly configured.
    const emptyConfigDir = mkdtempSync(join(tmpdir(), "cfx-nodburl-"));
    try {
      const { stdout, stderr, status } = run(["server", "deploy", "--schema-only"], {
        CEREFOX_DATABASE_URL: "",
        CEREFOX_CONFIG_DIR: emptyConfigDir,
      });
      expect(status).toBe(1);
      const all = stdout + stderr;
      expect(all).toContain("CEREFOX_DATABASE_URL");
      expect(all).toMatch(/prerequisite|Cannot deploy/i);
    } finally {
      rmSync(emptyConfigDir, { recursive: true, force: true });
    }
  });
});
