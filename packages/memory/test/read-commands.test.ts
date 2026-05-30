/**
 * Smoke + integration tests for the 8 v0.5 read commands.
 *
 * For the non-trivial commands (search, list-docs, metadata-search) we
 * spawn the built bin against the maintainer's real Supabase and assert
 * a sensible shape. This catches:
 *   - PostgREST column-name typos (caught the `doc_metadata` vs
 *     `metadata` mistake during 23B build).
 *   - RPC signature drift (Python CLI's arg names vs the TS port).
 *   - --json shape consistency.
 *
 * Skipped automatically when the maintainer's Supabase isn't reachable
 * (e.g. on CI without secrets) — same pattern the v0.4 stdio-smoke
 * test uses.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  if (!existsSync(BIN)) {
    throw new Error(`Built bin not found at ${BIN}. Run \`bun run build\` first.`);
  }
  const result = spawnSync("node", [BIN, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env },
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

// Probe once at module load. If Supabase isn't configured, skip the live
// section instead of failing the whole suite.
const probe = run(["project", "list", "--json"]);
const LIVE_OK = probe.status === 0;

describe("cerefox read commands (live)", () => {
  if (!LIVE_OK) {
    test.skip(`Supabase not reachable (probe exit ${probe.status}); skipping live tests`, () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      LIVE_OK;
    });
    return;
  }

  test("list-projects: JSON shape", () => {
    const { stdout, status } = run(["project", "list", "--json"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as Array<{ id: string; name: string }>;
    expect(Array.isArray(parsed)).toBe(true);
    if (parsed.length > 0) {
      expect(typeof parsed[0].id).toBe("string");
      expect(typeof parsed[0].name).toBe("string");
    }
  });

  test("list-projects: table mode has a header line", () => {
    const { stdout, status } = run(["project", "list"]);
    expect(status).toBe(0);
    // Header is `id  name  description`; not all columns must appear,
    // but at least "id" + "name".
    expect(stdout).toContain("id");
    expect(stdout).toContain("name");
  });

  test("list-docs: respects --limit", () => {
    const { stdout, status } = run(["document", "list", "--limit", "3", "--json"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as unknown[];
    expect(parsed.length).toBeLessThanOrEqual(3);
  });

  test("list-docs: bogus project → exit 1", () => {
    const { status, stderr } = run([
      "document", "list",
      "--project",
      "definitely-not-a-real-project-name",
    ]);
    expect(status).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("list-metadata-keys: returns key/doc_count/example_values", () => {
    const { stdout, status } = run(["metadata", "keys", "--json"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as Array<{
      key: string;
      doc_count: number;
      example_values: string[];
    }>;
    expect(Array.isArray(parsed)).toBe(true);
    // The maintainer's KB has at least a handful of keys.
    if (parsed.length > 0) {
      expect(typeof parsed[0].key).toBe("string");
      expect(typeof parsed[0].doc_count).toBe("number");
    }
  });

  test("get-doc: bogus UUID → exit 3", () => {
    const { status, stderr } = run([
      "document", "get",
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(status).toBe(3);
    expect(stderr).toContain("not found");
  });

  test("get-audit-log --limit 1 returns at most one row", () => {
    const { stdout, status } = run(["audit", "list", "--limit", "1", "--json"]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as unknown[];
    expect(parsed.length).toBeLessThanOrEqual(1);
  });

  test("metadata-search: missing --metadata-filter → exit 1", () => {
    // commander treats a missing required option as exit 1
    const { status } = run(["metadata", "search"]);
    expect(status).toBe(1);
  });

  test("metadata-search: invalid JSON in --metadata-filter → exit 1", () => {
    const { status, stderr } = run([
      "metadata", "search",
      "--metadata-filter",
      "not-json",
    ]);
    expect(status).toBe(1);
    expect(stderr).toContain("not valid JSON");
  });

  test("metadata-search: empty object → exit 1", () => {
    const { status, stderr } = run(["metadata", "search", "--metadata-filter", "{}"]);
    expect(status).toBe(1);
    expect(stderr).toContain("non-empty");
  });

  test("search: empty query → exit 1", () => {
    const { status } = run(["search", ""]);
    expect(status).toBe(1);
  });

  test("search: --mode fts requires no embedding", () => {
    // FTS-only path skips the embedding call; should work even if the
    // OpenAI key were missing. We just verify it doesn't crash and the
    // result list is JSON-parseable.
    const { stdout, status } = run([
      "search",
      "the",
      "--mode",
      "fts",
      "--match-count",
      "1",
      "--max-bytes",
      "5000",
      "--json",
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as { results: unknown[]; mode: string };
    expect(parsed.mode).toBe("fts");
  });
});
