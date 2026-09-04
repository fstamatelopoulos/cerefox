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

import { liveTest } from "./_live-test.ts";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { loadSettings } from "../../../_shared/config/index.ts";
import { createClient } from "../../../_shared/db-client/index.ts";
import { liveWriteSkipReason, mayWriteToLiveTarget } from "./_live-target-guard.ts";

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
const probe = run(["project", "list", "--json"]);
const LIVE_REACHABLE = probe.status === 0;
// Reachability is the wrong question — production is the most reachable
// target there is. Gate on the environment LABEL instead.
const LIVE_OK = LIVE_REACHABLE && mayWriteToLiveTarget();

// iter-32 gate: content updates require the v0.5.0 schema
// (p_expected_content_hash / p_last_write_wins on cerefox_ingest_document).
// Against an older deployed server the update-flow test skips instead of
// failing with "function not found".
const SCHEMA_OK = await (async () => {
  if (!LIVE_OK) return false;
  try {
    const settings = loadSettings();
    const client = createClient(settings);
    const ver = await client.rpc<string>("cerefox_schema_version", {});
    const [maj = 0, min = 0] = String(ver ?? "0.0.0").split(".").map(Number);
    return maj > 0 || min >= 6;
  } catch {
    return false;
  }
})();

// Track docs we create so we can clean them up regardless of test
// success / failure.
const createdIds: string[] = [];

describe("cerefox write commands (live)", () => {
  if (!LIVE_OK) {
    test.skip(
      LIVE_REACHABLE
        ? liveWriteSkipReason()
        : `Supabase not reachable (probe exit ${probe.status}); skipping live tests`, () => {
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
    run(["project", "delete", "_e2e-v0.5", "--yes", "--force"]);
  });

  liveTest("ingest --paste: title required", () => {
    const { status, stderr } = run(["document", "ingest", "--paste"], { stdin: "# hi\n" });
    expect(status).toBe(1);
    expect(stderr).toContain("--title");
  });

  liveTest("ingest --paste: creates doc and prints id", () => {
    const title = "[E2E v0.5-test] paste-mode-ingest";
    const { stdout, status } = run(
      [
        "document", "ingest",
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

  liveTest("ingest --paste: empty stdin → exit 1", () => {
    const { status, stderr } = run(
      ["document", "ingest", "--paste", "--title", "[E2E v0.5-test] empty"],
      { stdin: "" },
    );
    expect(status).toBe(1);
    expect(stderr).toContain("Empty paste");
  });

  liveTest("ingest: missing file → exit 1", () => {
    const { status, stderr } = run(["document", "ingest", "/tmp/nonexistent-file-xyz.md", "--title", "t"]);
    expect(status).toBe(1);
    expect(stderr).toContain("Cannot read");
  });

  liveTest("ingest + update-if-exists: skips identical content, updates on change", () => {
    const title = "[E2E v0.5-test] update-flow";
    // First ingest.
    const r1 = run(
      [
        "document", "ingest",
        "--paste",
        "--title",
        title,
        "--project-name",
        "_e2e-v0.5",
        "--metadata",
        '{"type":"e2e-flow","keep":"me"}',
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
        "document", "ingest",
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

    if (!SCHEMA_OK) {
      console.log(
        "(update-flow steps skipped: deployed schema < 0.6.0 — run `cerefox server deploy --schema-only`)",
      );
      return;
    }

    // Re-ingest with changed content but NO concurrency token → rejected
    // (iter-32: content updates require --expected-content-hash or
    // --last-write-wins).
    const r3 = run(
      [
        "document", "ingest",
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
    expect(r3.status).not.toBe(0);
    expect(r3.stderr + r3.stdout).toContain("CEREFOX_TOKEN_REQUIRED");

    // Fetch the current hash (the token) via `document get --json`.
    const rGet = run(["document", "get", id!, "--json"]);
    expect(rGet.status).toBe(0);
    const currentHash = (JSON.parse(rGet.stdout) as { content_hash?: string })
      .content_hash;
    expect(currentHash).toBeTruthy();

    // Changed content WITH the token → updated.
    const r4 = run(
      [
        "document", "ingest",
        "--paste",
        "--title",
        title,
        "--project-name",
        "_e2e-v0.5",
        "--update-if-exists",
        "--expected-content-hash",
        currentHash!,
        "--author",
        "v0.5-test",
        "--author-type",
        "agent",
      ],
      { stdin: "# Update flow\nV2 content.\n" },
    );
    expect(r4.status).toBe(0);
    expect(r4.stdout).toContain("updated");

    // Re-using the now-STALE token → conflict.
    const r5 = run(
      [
        "document", "ingest",
        "--paste",
        "--title",
        title,
        "--update-if-exists",
        "--expected-content-hash",
        currentHash!,
        "--author",
        "v0.5-test",
        "--author-type",
        "agent",
      ],
      { stdin: "# Update flow\nV3 content.\n" },
    );
    expect(r5.status).not.toBe(0);
    expect(r5.stderr + r5.stdout).toContain("CEREFOX_CONFLICT");

    // --last-write-wins bypasses the check.
    const r6 = run(
      [
        "document", "ingest",
        "--paste",
        "--title",
        title,
        "--update-if-exists",
        "--last-write-wins",
        "--author",
        "v0.5-test",
        "--author-type",
        "agent",
      ],
      { stdin: "# Update flow\nV4 content.\n" },
    );
    expect(r6.status).toBe(0);
    expect(r6.stdout).toContain("updated");

    // v0.11.1: none of the four content updates above passed --metadata, so
    // the metadata set at creation must have survived all of them (the old
    // `?? {}` default wiped tags on every update).
    const rList = run(["document", "list", "--project", "_e2e-v0.5", "--json"]);
    expect(rList.status).toBe(0);
    const row = (JSON.parse(rList.stdout) as Array<{ id: string; metadata: Record<string, unknown> }>)
      .find((d) => d.id === id);
    expect(row?.metadata).toEqual({ type: "e2e-flow", keep: "me" });
    // Six CLI invocations (four with live embedding calls) — well beyond
    // bun's 5s default test timeout.
  }, 60_000);

  liveTest("metadata search: --project-name alone lists docs (v0.11.1 parity)", () => {
    const r = run(["metadata", "search", "--project-name", "_e2e-v0.5", "--json"]);
    expect(r.status).toBe(0);
    const rows = JSON.parse(r.stdout) as unknown[];
    expect(rows.length).toBeGreaterThan(0);
  });

  liveTest("metadata search: no criteria at all → exit 1 with guidance", () => {
    const r = run(["metadata", "search"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("at least one of");
  });

  liveTest("ingest-dir: walks tree and ingests matching files", () => {
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
        "document", "ingest-dir",
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
        "document", "list",
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
    // Three CLI invocations, two of them live embedding calls — same reason
    // the flow test above carries a budget. Without one this inherits bun's
    // 5s default and fails whenever the embedding API is having a slow day
    // (observed: 22s, in the v1.11.0 staging pass).
  }, 60_000);

  liveTest("delete-doc: bogus UUID → exit 3", () => {
    const { status, stderr } = run([
      "document", "delete",
      "00000000-0000-0000-0000-000000000000",
      "--yes",
    ]);
    expect(status).toBe(3);
    expect(stderr).toContain("not found");
  });

  // ── v0.9.x commands: live round-trips (self-cleaning) ──────────────────────

  liveTest("project create → edit → delete round-trip", () => {
    const name = "[E2E v0.5-test] proj-roundtrip";
    const renamed = "[E2E v0.5-test] proj-renamed";
    const create = run(["project", "create", name, "--description", "tmp"]);
    expect(create.status).toBe(0);
    expect(create.stdout).toContain(name);

    const edit = run(["project", "edit", name, "--name", renamed, "--description", "edited"]);
    expect(edit.status).toBe(0);
    expect(edit.stdout).toContain(renamed);

    const del = run(["project", "delete", renamed, "--yes", "--force"]);
    expect(del.status).toBe(0);
  });

  liveTest("project create: duplicate name → exit non-zero", () => {
    const name = "[E2E v0.5-test] proj-dup";
    const first = run(["project", "create", name]);
    expect(first.status).toBe(0);
    const dup = run(["project", "create", name]);
    expect(dup.status).not.toBe(0);
    run(["project", "delete", name, "--yes", "--force"]); // cleanup
  });

  liveTest("document edit: non-destructive metadata patch (keep / set / unset)", async () => {
    const title = "[E2E v0.5-test] edit-patch";
    const ingest = run(
      [
        "document", "ingest", "--paste", "--title", title,
        "--project-name", "_e2e-v0.5",
        "--metadata", '{"keep":"yes","drop":"old"}',
        "--author", "v0.5-test", "--author-type", "agent",
      ],
      { stdin: `# Edit patch\n\nbody ${Date.now()}\n` },
    );
    expect(ingest.status).toBe(0);
    const id = parseIdFromIngestMessage(ingest.stdout);
    expect(id).not.toBeNull();
    if (!id) return;
    createdIds.push(id);

    const edit = run([
      "document", "edit", id,
      "--set-meta", "status=approved",
      "--set-meta", "count=3",
      "--unset-meta", "drop",
      "--author", "v0.5-test", "--author-type", "agent",
    ]);
    expect(edit.status).toBe(0);

    // `document get` returns reconstructed content, not metadata — verify the
    // patch directly against the row (same client hardPurgeE2eDocs uses).
    const client = createClient(loadSettings());
    const { data } = await client.raw
      .from("cerefox_documents")
      .select("metadata")
      .eq("id", id)
      .maybeSingle();
    const meta = ((data?.metadata as Record<string, unknown>) ?? {});
    expect(meta.keep).toBe("yes"); // preserved
    expect(meta.drop).toBeUndefined(); // unset
    expect(meta.status).toBe("approved"); // set
    expect(meta.count).toBe(3); // JSON-parsed to a number
  });

  liveTest("document delete → restore clears + re-sets deleted_at", async () => {
    const title = "[E2E v0.5-test] restore-flow";
    const ingest = run(
      [
        "document", "ingest", "--paste", "--title", title,
        "--project-name", "_e2e-v0.5",
        "--author", "v0.5-test", "--author-type", "agent",
      ],
      { stdin: `# Restore flow\n\nbody ${Date.now()}\n` },
    );
    expect(ingest.status).toBe(0);
    const id = parseIdFromIngestMessage(ingest.stdout);
    expect(id).not.toBeNull();
    if (!id) return;
    createdIds.push(id);

    const client = createClient(loadSettings());
    const deletedAt = async (): Promise<unknown> => {
      const { data } = await client.raw
        .from("cerefox_documents")
        .select("deleted_at")
        .eq("id", id)
        .maybeSingle();
      return data?.deleted_at ?? null;
    };

    expect(run(["document", "delete", id, "--yes", "--author", "v0.5-test", "--author-type", "agent"]).status).toBe(0);
    expect(await deletedAt()).not.toBeNull(); // soft-deleted

    const restore = run(["document", "restore", id, "--author", "v0.5-test", "--author-type", "agent"]);
    expect(restore.status).toBe(0);
    expect(await deletedAt()).toBeNull(); // restored
  });
});
