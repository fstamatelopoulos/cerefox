/**
 * Smoke tests for `cerefox reindex` (iter-25 Part 25G).
 *
 * Pre-v0.7 this command printed a deferred-message stub; v0.7 wires
 * the in-process reindex path. Tests cover the CLI surface (--help)
 * and the dry-run path against a live DB.
 *
 * Live tests probe-and-skip on Supabase reachability.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

function run(args: string[]): {
  stdout: string;
  stderr: string;
  status: number;
} {
  if (!existsSync(BIN)) {
    throw new Error(`Built bin not found at ${BIN}. Run \`bun run build\`.`);
  }
  const result = spawnSync("node", [BIN, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env },
    timeout: 30_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

// Probe via list-projects (the canonical "is the backend reachable" smoke).
const probe = run(["project", "list", "--json"]);
const LIVE_OK = probe.status === 0;

describe("cerefox reindex CLI", () => {
  test("--help advertises the v0.7 flags", () => {
    const { stdout, status } = run(["server", "reindex", "--help"]);
    expect(status).toBe(0);
    expect(stdout).toContain("Re-embed existing");
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--batch");
    expect(stdout).toContain("--dry-run");
    expect(stdout).toContain("--document-id");
  });

  test("invalid --batch errors out", () => {
    if (!LIVE_OK) {
      console.log("(skipped: Supabase unreachable)");
      return;
    }
    // Bad value — non-numeric → user error. Need a real DB connection
    // first; if Supabase is unreachable the test would fail for the
    // wrong reason (the DB-connect error fires before the batch
    // validation), hence the probe-and-skip.
    const { stderr, status } = run(["server", "reindex", "--batch", "not-a-number"]);
    expect(status).not.toBe(0);
    expect(stderr).toContain("Invalid --batch");
  });

  test("--dry-run runs without writing (live)", () => {
    if (!LIVE_OK) {
      console.log("(skipped: Supabase unreachable)");
      return;
    }
    const { stdout, status } = run(["server", "reindex", "--dry-run"]);
    expect(status).toBe(0);
    // Either "Reindexing N chunk(s) — DRY RUN" or "nothing to reindex"
    // depending on what the DB looks like. Both are valid outcomes.
    expect(stdout).toMatch(/Reindexing \d+ chunk|nothing to reindex/);
  });

  test("--all + --dry-run reports all chunks", () => {
    if (!LIVE_OK) return;
    const { stdout, status } = run(["server", "reindex", "--all", "--dry-run"]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/Reindexing \d+ chunk|nothing to reindex/);
    // --all path should mention "(--all)" tag, not "(stale only)"
    expect(stdout).not.toMatch(/stale only/);
  });

  test("--document-id with a fake UUID returns 'nothing to reindex'", () => {
    if (!LIVE_OK) return;
    const { stdout, status } = run([
      "server", "reindex",
      "--dry-run",
      "--document-id",
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("nothing to reindex");
  });
});
