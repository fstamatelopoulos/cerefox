/**
 * Smoke tests for the v0.7 TS-ported scripts:
 *   - `scripts/db_deploy.ts`
 *   - `scripts/db_migrate.ts`
 *   - `scripts/reindex_all.ts`
 *
 * Each script gets:
 *   - `--help` exit-0 + usage line
 *   - Error message + non-zero exit when CEREFOX_DATABASE_URL is unset
 *
 * Live paths (probe-and-skip on Supabase reachability):
 *   - `db_deploy.ts --dry-run` should walk all 4 steps
 *   - `db_migrate.ts --status` should list applied + pending counts
 *
 * Mirrors the smoke-test discipline established by the v0.3 script
 * ports (`sync_docs.test.ts`, `db_status.test.ts`).
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv } from "../config/index.js";

loadEnv();

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

function runScript(
  script: string,
  args: string[],
  opts: { unsetDbUrl?: boolean; timeoutMs?: number } = {},
): { stdout: string; stderr: string; status: number } {
  const env = { ...process.env };
  if (opts.unsetDbUrl) {
    // Empty string (not delete) so loadEnv() — which only fills
    // unset vars — doesn't repopulate from ~/.cerefox/.env. The
    // scripts treat "" as unset.
    env.CEREFOX_DATABASE_URL = "";
  }
  const result = spawnSync("bun", [`scripts/${script}`, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env,
    timeout: opts.timeoutMs ?? 30_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

const LIVE_OK = (process.env.CEREFOX_DATABASE_URL ?? "").length > 0;

// ── db_deploy.ts ────────────────────────────────────────────────────────────

describe("scripts/db_deploy.ts", () => {
  test("--help prints usage and exits 0", () => {
    const { stdout, status } = runScript("db_deploy.ts", ["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--reset");
  });

  test("errors out when CEREFOX_DATABASE_URL is unset", () => {
    const { stderr, status } = runScript("db_deploy.ts", [], { unsetDbUrl: true });
    expect(status).not.toBe(0);
    expect(stderr).toContain("CEREFOX_DATABASE_URL");
  });

  test("--dry-run walks all 4 steps without writing (live)", () => {
    if (!LIVE_OK) {
      console.log("(skipped: CEREFOX_DATABASE_URL unset)");
      return;
    }
    const { stdout, status } = runScript("db_deploy.ts", ["--dry-run"]);
    expect(status).toBe(0);
    expect(stdout).toContain("DRY-RUN");
    // The 4 expected steps:
    expect(stdout).toContain("Enable extensions");
    expect(stdout).toContain("Apply schema");
    expect(stdout).toContain("Apply RPCs");
    expect(stdout).toContain("Stamp migration files");
    expect(stdout).toContain("Dry-run complete");
  });
});

// ── db_migrate.ts ───────────────────────────────────────────────────────────

describe("scripts/db_migrate.ts", () => {
  test("--help prints usage and exits 0", () => {
    const { stdout, status } = runScript("db_migrate.ts", ["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--status");
  });

  test("errors out when CEREFOX_DATABASE_URL is unset", () => {
    const { stderr, status } = runScript("db_migrate.ts", [], { unsetDbUrl: true });
    expect(status).not.toBe(0);
    expect(stderr).toContain("CEREFOX_DATABASE_URL");
  });

  test("--status lists applied + pending counts (live)", () => {
    if (!LIVE_OK) {
      console.log("(skipped: CEREFOX_DATABASE_URL unset)");
      return;
    }
    const { stdout, status } = runScript("db_migrate.ts", ["--status"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Cerefox DB Migrate");
    // Summary line: "N total  |  N applied  |  N pending"
    expect(stdout).toMatch(/\d+ total\s+\|\s+\d+ applied\s+\|\s+\d+ pending/);
  });
});

// ── reindex_all.ts ──────────────────────────────────────────────────────────

describe("scripts/reindex_all.ts", () => {
  test("--help prints usage and exits 0", () => {
    const { stdout, status } = runScript("reindex_all.ts", ["--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--batch");
  });

  test("unknown arg errors out", () => {
    const { stderr, status } = runScript("reindex_all.ts", ["--bogus"]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("Unknown arg");
  });
});
