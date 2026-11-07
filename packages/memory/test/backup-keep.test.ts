/**
 * `cerefox backup create --keep <n>`.
 *
 * The retention rule is a pure function (`snapshotsToPrune`) and is tested
 * directly. The CLI half spawns the built bin against a scratch config dir
 * with no credentials, so the snapshot fails before any request: nothing
 * here can reach a real store.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { snapshotStamp, snapshotsToPrune } from "../src/cli/util/backup-prune.ts";

const NEW = "cerefox-20261107T030000Z.json";

function prune(
  filenames: string[],
  opts: { keep: number; label?: string; envLabel?: string; justWritten?: string },
): string[] {
  return snapshotsToPrune({
    filenames,
    justWritten: opts.justWritten ?? NEW,
    envLabel: opts.envLabel ?? "",
    label: opts.label,
    keep: opts.keep,
  });
}

describe("snapshotStamp", () => {
  test("parses the names backup create writes", () => {
    expect(snapshotStamp("cerefox-20261107T030000Z.json", "", undefined)).toBe("20261107T030000Z");
    expect(snapshotStamp("cerefox-20261107T030000Z-daily.json", "", "daily")).toBe("20261107T030000Z");
    expect(snapshotStamp("cerefox-staging-20261107T030000Z.json", "staging", undefined)).toBe(
      "20261107T030000Z",
    );
    expect(snapshotStamp("cerefox-staging-20261107T030000Z-a.b.json", "staging", "a.b")).toBe(
      "20261107T030000Z",
    );
  });

  test("label is matched literally, not as a pattern", () => {
    expect(snapshotStamp("cerefox-20261107T030000Z-aXb.json", "", "a.b")).toBeNull();
  });
});

describe("snapshotsToPrune", () => {
  test("keeps the newest n, deletes the rest, oldest included", () => {
    const files = [
      "cerefox-20261101T030000Z.json",
      "cerefox-20261105T030000Z.json",
      "cerefox-20261103T030000Z.json",
      NEW,
      "cerefox-20261106T030000Z.json",
    ];
    expect(prune(files, { keep: 3 }).sort()).toEqual([
      "cerefox-20261101T030000Z.json",
      "cerefox-20261103T030000Z.json",
    ]);
  });

  test("orders by the embedded stamp, not by list order", () => {
    const files = ["cerefox-20261106T030000Z.json", "cerefox-20250101T000000Z.json", NEW];
    expect(prune(files, { keep: 2 })).toEqual(["cerefox-20250101T000000Z.json"]);
  });

  test("keep 1 leaves only the snapshot just written", () => {
    const files = ["cerefox-20261101T030000Z.json", "cerefox-20261102T030000Z.json", NEW];
    expect(prune(files, { keep: 1 }).sort()).toEqual([
      "cerefox-20261101T030000Z.json",
      "cerefox-20261102T030000Z.json",
    ]);
  });

  test("the just-written file is never deleted, even if others carry a later stamp", () => {
    // Clock skew: an existing file claims to be newer than this run.
    const files = ["cerefox-20991231T000000Z.json", "cerefox-20991230T000000Z.json", NEW];
    const out = prune(files, { keep: 1 });
    expect(out).not.toContain(NEW);
    expect(out.sort()).toEqual(["cerefox-20991230T000000Z.json", "cerefox-20991231T000000Z.json"]);
    expect(prune(files, { keep: 2 })).toEqual(["cerefox-20991230T000000Z.json"]);
  });

  test("n larger than the count deletes nothing", () => {
    expect(prune(["cerefox-20261101T030000Z.json", NEW], { keep: 14 })).toEqual([]);
    expect(prune([NEW], { keep: 1 })).toEqual([]);
    expect(prune([], { keep: 3 })).toEqual([]);
  });

  test("without --label, labeled snapshots are untouched", () => {
    const files = [
      "cerefox-20261101T030000Z.json",
      "cerefox-20261101T030000Z-before-upgrade.json",
      "cerefox-20261102T030000Z-daily.json",
      NEW,
    ];
    expect(prune(files, { keep: 1 })).toEqual(["cerefox-20261101T030000Z.json"]);
  });

  test("with --label, only that exact label is pruned", () => {
    const justWritten = "cerefox-20261107T030000Z-daily.json";
    const files = [
      "cerefox-20261101T030000Z-daily.json",
      "cerefox-20261102T030000Z-daily.json",
      "cerefox-20261101T030000Z-daily-extra.json",
      "cerefox-20261101T030000Z-weekly.json",
      "cerefox-20261101T030000Z.json",
      justWritten,
    ];
    expect(prune(files, { keep: 2, label: "daily", justWritten })).toEqual([
      "cerefox-20261101T030000Z-daily.json",
    ]);
  });

  test("env label scopes pruning in both directions", () => {
    const files = [
      "cerefox-20261101T030000Z.json",
      "cerefox-staging-20261101T030000Z.json",
      "cerefox-staging-20261102T030000Z.json",
      "cerefox-lan-20261101T030000Z.json",
    ];
    const stg = "cerefox-staging-20261107T030000Z.json";
    expect(prune([...files, stg], { keep: 2, envLabel: "staging", justWritten: stg })).toEqual([
      "cerefox-staging-20261101T030000Z.json",
    ]);
    // An unlabeled environment never touches a labeled one's files.
    expect(prune([...files, NEW], { keep: 1 })).toEqual(["cerefox-20261101T030000Z.json"]);
  });

  test("unrelated and malformed names are ignored", () => {
    const files = [
      "notes.json",
      "cerefox.json",
      "cerefox-.json",
      "cerefox-20261101T030000Z.json.bak",
      "cerefox-20261101T030000Z.JSON",
      "cerefox-2026110T030000Z.json",
      "cerefox-20261101T030000.json",
      "cerefox-20261101-030000Z.json",
      "xcerefox-20261101T030000Z.json",
      "cerefox-20261101T030000Z-.json",
      ".env",
      ".git",
      NEW,
    ];
    expect(prune(files, { keep: 1 })).toEqual([]);
  });

  test("rejects keep below 1 or non-integer", () => {
    for (const keep of [0, -1, 1.5, Number.NaN]) {
      expect(() => prune([NEW], { keep })).toThrow(/integer >= 1/);
    }
  });
});

// ── CLI (built bin) ─────────────────────────────────────────────────────────

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

/** An environment with no Cerefox or Supabase settings from the runner. */
function isolatedEnv(configDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(CEREFOX_|SUPABASE_|OPENAI_)/.test(k)) continue;
    env[k] = v;
  }
  env.CEREFOX_CONFIG_DIR = configDir;
  return env;
}

function runBackup(args: string[], configDir: string): { out: string; status: number } {
  if (!existsSync(BIN)) throw new Error(`Built bin not found at ${BIN}. Run \`bun run build\` first.`);
  const r = spawnSync("node", [BIN, "backup", "create", ...args], {
    encoding: "utf8",
    env: isolatedEnv(configDir),
    cwd: configDir,
    timeout: 30_000,
  });
  return { out: (r.stdout ?? "") + (r.stderr ?? ""), status: r.status ?? -1 };
}

describe("backup create --keep (built bin)", () => {
  function scratch(): { root: string; config: string; out: string } {
    const root = mkdtempSync(join(tmpdir(), "cerefox-backup-keep-"));
    const config = join(root, "config");
    mkdirSync(config);
    return { root, config, out: join(root, "backups") };
  }

  test("invalid --keep values fail before any work", () => {
    const s = scratch();
    try {
      for (const v of ["0", "-1", "1.5", "abc", "2x"]) {
        const r = runBackup(["--output-dir", s.out, `--keep=${v}`], s.config);
        expect(r.status).toBe(1);
        expect(r.out).toContain("--keep");
        // Nothing was done: not even the output dir was created.
        expect(existsSync(s.out)).toBe(false);
      }
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  });

  test("--keep with --git is refused", () => {
    const s = scratch();
    try {
      const r = runBackup(["--output-dir", s.out, "--keep", "3", "--git"], s.config);
      expect(r.status).toBe(1);
      expect(r.out).toContain("--keep cannot be combined with --git");
      expect(existsSync(s.out)).toBe(false);
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  });

  const OLD = ["cerefox-20200101T000000Z.json", "cerefox-20200102T000000Z.json"];

  function seed(dir: string): void {
    mkdirSync(dir, { recursive: true });
    for (const n of OLD) writeFileSync(join(dir, n), "{}");
  }

  test("a failed snapshot (no credentials) prunes nothing", () => {
    const s = scratch();
    try {
      seed(s.out);
      const r = runBackup(["--output-dir", s.out, "--keep", "1"], s.config);
      expect(r.status).not.toBe(0);
      expect(readdirSync(s.out).sort()).toEqual(OLD);
    } finally {
      rmSync(s.root, { recursive: true, force: true });
    }
  });
});
