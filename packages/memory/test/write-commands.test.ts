/**
 * Live e2e tests for the v0.5 write commands (ingest, ingest-dir, delete-doc).
 *
 * Each test creates documents in a dedicated `_e2e-v0.5` project and
 * cleans them up at the end. Names are prefixed `[E2E v0.5-test]` so any
 * orphan from a failed run is easy to find + purge by hand.
 *
 * Auto-skipped when the maintainer's Supabase isn't reachable (probes
 * `list-projects --json`).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { loadSettings } from "../../../_shared/config/index.ts";
import { createClient } from "../../../_shared/db-client/index.ts";

const E2E_TITLE_PREFIX = "[E2E v0.5-test]";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

interface RunResult {
  stdout: string;
  stderr: string;
  status: number;
}

function run(args: string[], opts: { stdin?: string } = {}): RunResult {
  if (!existsSync(BIN)) {
    throw new Error(`Built bin not found at ${BIN}. Run \`bun run build\` first.`);
  }
  const result = spawnSync("node", [BIN, ...args], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env: { ...process.env },
    input: opts.stdin,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

function parseIdFromIngestMessage(message: string): string | null {
  const m = message.match(/\(id:\s*([0-9a-f-]{36})\)/i);
  return m ? m[1] : null;
}

/**
 * Hard-purge any leftover `[E2E v0.5-test]` documents (iter-26 Part 26K).
 *
 * The CLI `delete-doc` is soft-delete only, and the v0.7 ingestion
 * pipeline's content-hash collision check considers soft-deleted docs —
 * so leftovers from a prior run caused "Identical content already exists"
 * flakes. A direct hard delete on `cerefox_documents` cascades to chunks +
 * versions + project memberships (all ON DELETE CASCADE), clearing the
 * collision. Best-effort: never throws.
 */
async function hardPurgeE2eDocs(): Promise<void> {
  try {
    const settings = loadSettings();
    if (!settings.supabaseUrl || !settings.supabaseKey) return;
    const client = createClient(settings);
    await client.raw
      .from("cerefox_documents")
      .delete()
      .like("title", `${E2E_TITLE_PREFIX}%`);
  } catch {
    // best-effort
  }
}

// Probe whether Supabase is reachable.
const probe = run(["list-projects", "--json"]);
const LIVE_OK = probe.status === 0;

// Track docs we create so we can clean them up regardless of test
// success / failure.
const createdIds: string[] = [];

describe("cerefox write commands (live)", () => {
  if (!LIVE_OK) {
    test.skip(`Supabase not reachable (probe exit ${probe.status}); skipping live tests`, () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      LIVE_OK;
    });
    return;
  }

  // Hard-purge leftovers from any prior interrupted run BEFORE the suite,
  // so soft-deleted [E2E] docs can't trip the v0.7 content-hash collision
  // check (the iter-25 flake). Also purge after, replacing the old
  // soft-delete loop so nothing lingers for the next run.
  beforeAll(async () => {
    await hardPurgeE2eDocs();
  });

  afterAll(async () => {
    await hardPurgeE2eDocs();
    // hardPurgeE2eDocs only removes documents; reap the `_e2e-v0.5` project
    // row too so it doesn't leak across runs. `--force` deletes even if a
    // doc link lingers (the project row goes; doc rows stay).
    run(["delete-project", "_e2e-v0.5", "--yes", "--force"]);
  });

  test("ingest --paste: title required", () => {
    const { status, stderr } = run(["ingest", "--paste"], { stdin: "# hi\n" });
    expect(status).toBe(1);
    expect(stderr).toContain("--title");
  });

  test("ingest --paste: creates doc and prints id", () => {
    const title = "[E2E v0.5-test] paste-mode-ingest";
    const { stdout, status } = run(
      [
        "ingest",
        "--paste",
        "--title",
        title,
        "--project-name",
        "_e2e-v0.5",
        "--metadata",
        '{"type":"e2e","case":"paste"}',
        "--author",
        "v0.5-test",
        "--author-type",
        "agent",
      ],
      { stdin: `# Paste mode\n\nIngest test ${Date.now()}\n` },
    );
    expect(status).toBe(0);
    const id = parseIdFromIngestMessage(stdout);
    expect(id).not.toBeNull();
    expect(stdout).toContain(title);
    if (id) createdIds.push(id);
  });

  test("ingest --paste: empty stdin → exit 1", () => {
    const { status, stderr } = run(
      ["ingest", "--paste", "--title", "[E2E v0.5-test] empty"],
      { stdin: "" },
    );
    expect(status).toBe(1);
    expect(stderr).toContain("Empty paste");
  });

  test("ingest: missing file → exit 1", () => {
    const { status, stderr } = run(["ingest", "/tmp/nonexistent-file-xyz.md", "--title", "t"]);
    expect(status).toBe(1);
    expect(stderr).toContain("Cannot read");
  });

  test("ingest + update-if-exists: skips identical content, updates on change", () => {
    const title = "[E2E v0.5-test] update-flow";
    // First ingest.
    const r1 = run(
      [
        "ingest",
        "--paste",
        "--title",
        title,
        "--project-name",
        "_e2e-v0.5",
        "--update-if-exists",
        "--author",
        "v0.5-test",
        "--author-type",
        "agent",
      ],
      { stdin: "# Update flow\nV1 content.\n" },
    );
    expect(r1.status).toBe(0);
    const id = parseIdFromIngestMessage(r1.stdout);
    expect(id).not.toBeNull();
    if (id) createdIds.push(id);

    // Re-ingest with same content → up-to-date.
    const r2 = run(
      [
        "ingest",
        "--paste",
        "--title",
        title,
        "--project-name",
        "_e2e-v0.5",
        "--update-if-exists",
        "--author",
        "v0.5-test",
        "--author-type",
        "agent",
      ],
      { stdin: "# Update flow\nV1 content.\n" },
    );
    expect(r2.status).toBe(0);
    expect(r2.stdout).toContain("up-to-date");

    // Re-ingest with changed content → updated.
    const r3 = run(
      [
        "ingest",
        "--paste",
        "--title",
        title,
        "--project-name",
        "_e2e-v0.5",
        "--update-if-exists",
        "--author",
        "v0.5-test",
        "--author-type",
        "agent",
      ],
      { stdin: "# Update flow\nV2 content.\n" },
    );
    expect(r3.status).toBe(0);
    expect(r3.stdout).toContain("updated");
  });

  test("ingest-dir: walks tree and ingests matching files", () => {
    const dir = mkdtempSync(join(tmpdir(), "cerefox-e2e-"));
    try {
      writeFileSync(
        join(dir, "[E2E v0.5-test] dir-a.md"),
        "# Dir A\nFirst.\n",
      );
      writeFileSync(
        join(dir, "[E2E v0.5-test] dir-b.md"),
        "# Dir B\nSecond.\n",
      );
      // A non-md file should be ignored by default.
      writeFileSync(join(dir, "ignored.csv"), "ignore,me\n");

      const { stdout, status } = run([
        "ingest-dir",
        dir,
        "--project-name",
        "_e2e-v0.5",
        "--update-if-exists",
        "--author",
        "v0.5-test",
        "--author-type",
        "agent",
      ]);
      expect(status).toBe(0);
      expect(stdout).toContain("Summary: 2 ok");

      // Look up the resulting IDs for cleanup via the same _e2e-v0.5 project.
      const listing = run([
        "list-docs",
        "--project",
        "_e2e-v0.5",
        "--limit",
        "100",
        "--json",
      ]);
      const docs = JSON.parse(listing.stdout) as Array<{ id: string; title: string }>;
      for (const d of docs) {
        if (d.title.startsWith("[E2E v0.5-test] dir-")) {
          createdIds.push(d.id);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("delete-doc: bogus UUID → exit 3", () => {
    const { status, stderr } = run([
      "delete-doc",
      "00000000-0000-0000-0000-000000000000",
      "--yes",
    ]);
    expect(status).toBe(3);
    expect(stderr).toContain("not found");
  });
});
