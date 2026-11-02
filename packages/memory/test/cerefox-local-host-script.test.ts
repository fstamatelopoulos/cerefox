/**
 * The host-side `cerefox-local` script must never ACT when asked for help, and
 * must refuse arguments it does not understand before touching Docker.
 *
 * Reported by an agent running two Local instances: `cerefox-local uninstall
 * --help` removed the container instead of printing help. Every host verb
 * ignored unknown arguments, and `uninstall --purge --help` would have deleted
 * the data volume. These tests run the real script against a stub `docker`
 * that only records its calls, so "did it act?" is a list we can inspect.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "docker", "local", "cerefox-local");
const dir = mkdtempSync(join(tmpdir(), "cfx-host-"));
const LOG = join(dir, "docker.log");
writeFileSync(
  join(dir, "docker"),
  `#!/bin/sh\necho "$*" >> "${LOG}"\ncase "$1" in inspect) echo false;; esac\nexit 0\n`,
);
chmodSync(join(dir, "docker"), 0o755);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(...args: string[]) {
  writeFileSync(LOG, "");
  const r = spawnSync("sh", [SCRIPT, ...args], {
    env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, CEREFOX_LOCAL_CONFIG_DIR: join(dir, "cfg") },
    encoding: "utf8",
    input: "", // not a terminal
  });
  const calls = readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean);
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), calls };
}

const destructive = (calls: string[]) => calls.filter((c) => /^(rm|volume rm|stop|restart|start|pull|run|create)\b/.test(c));

describe("cerefox-local: --help never acts", () => {
  for (const argv of [
    ["uninstall", "--help"],
    ["uninstall", "--purge", "--help"],
    ["uninstall", "--help", "--purge"],
    ["stop", "--help"],
    ["restart", "-h"],
    ["start", "--help"],
    ["upgrade", "--help"],
    ["init", "--help"],
    ["status", "--help"],
    ["logs", "--help"],
    ["api-key", "--help"],
  ]) {
    test(argv.join(" "), () => {
      const r = run(...argv);
      expect(r.status).toBe(0);
      expect(r.out).toContain("cerefox-local — manage");
      expect(destructive(r.calls)).toEqual([]);
    });
  }
});

describe("cerefox-local: unknown arguments are refused before Docker is touched", () => {
  for (const argv of [["uninstall", "--purg"], ["stop", "now"], ["restart", "--force"], ["status", "x"]]) {
    test(argv.join(" "), () => {
      const r = run(...argv);
      expect(r.status).not.toBe(0);
      expect(r.calls).toEqual([]);
    });
  }
});

describe("cerefox-local uninstall --purge", () => {
  test("without --yes and without a terminal, refuses and removes nothing", () => {
    const r = run("uninstall", "--purge");
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("Nothing was removed");
    expect(r.calls).toEqual([]);
  });

  test("with --yes, removes the container and the volume", () => {
    const r = run("uninstall", "--purge", "--yes");
    expect(r.status).toBe(0);
    expect(r.calls.some((c) => c.startsWith("rm -f cerefox-local"))).toBe(true);
    expect(r.calls.some((c) => c.startsWith("volume rm cerefox_local_pgdata"))).toBe(true);
  });

  test("plain uninstall removes the container and keeps the data", () => {
    const r = run("uninstall");
    expect(r.status).toBe(0);
    expect(r.calls.some((c) => c.startsWith("rm -f"))).toBe(true);
    expect(r.calls.some((c) => c.startsWith("volume rm"))).toBe(false);
  });
});

// #359: backups used to land in the container's own filesystem and vanish on
// the next recreate. A second stub plays a RUNNING container: `exec` prints
// what the in-container CLI prints, `cp` out of the container writes the file.
describe("cerefox-local backup (#359)", () => {
  const bdir = mkdtempSync(join(tmpdir(), "cfx-backup-"));
  const BLOG = join(bdir, "docker.log");
  const SNAP = "/var/lib/postgresql/data/.cerefox-backups/cerefox-20261102T000000Z.json";
  writeFileSync(
    join(bdir, "docker"),
    `#!/bin/sh
echo "$*" >> "${BLOG}"
case "$1" in
  inspect) echo true ;;
  exec) case "$*" in *"backup create"*) printf '\\033[32m✓ \\033[0mBackup written: ${SNAP}\\n' ;; esac ;;
  cp) case "$2" in cerefox-local:*) n="\${2#*:}"; : > "$3/\${n##*/}" ;; esac ;;
esac
exit 0
`,
  );
  chmodSync(join(bdir, "docker"), 0o755);
  afterAll(() => rmSync(bdir, { recursive: true, force: true }));
  const cfg = join(bdir, "cfg");

  function runUp(...args: string[]) {
    writeFileSync(BLOG, "");
    const r = spawnSync("sh", [SCRIPT, ...args], {
      env: { PATH: `${bdir}:/usr/bin:/bin`, HOME: bdir, CEREFOX_LOCAL_CONFIG_DIR: cfg },
      encoding: "utf8",
      input: "",
    });
    const calls = readFileSync(BLOG, "utf8").trim().split("\n").filter(Boolean);
    return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? ""), calls };
  }

  test("create copies the snapshot to this machine", () => {
    const r = runUp("backup", "create");
    expect(r.status).toBe(0);
    expect(r.calls).toContain(`cp cerefox-local:${SNAP} ${cfg}/backups/`);
    const host = join(cfg, "backups", "cerefox-20261102T000000Z.json");
    expect(r.out).toContain(`Copied to this machine: ${host}`);
    expect(statSync(host).mode & 0o777).toBe(0o600);
  });

  test("restore copies a file from this machine into the container, then cleans up", () => {
    const file = join(bdir, "snap.json");
    writeFileSync(file, "{}");
    const r = runUp("backup", "restore", "--dry-run", file);
    expect(r.status).toBe(0);
    expect(r.calls).toContain(`cp ${file} cerefox-local:/tmp/cerefox-restore/`);
    const restore = r.calls.find((c) => c.includes("backup restore"));
    expect(restore).toEndWith("backup restore --dry-run /tmp/cerefox-restore/snap.json");
    expect(r.calls.at(-1)).toBe("exec cerefox-local rm -rf /tmp/cerefox-restore");
  });

  test("restore passes a path that is not on this machine through unchanged", () => {
    const r = runUp("backup", "restore", SNAP);
    expect(r.status).toBe(0);
    expect(r.calls.some((c) => c.startsWith("cp "))).toBe(false);
    expect(r.calls.find((c) => c.includes("backup restore"))).toEndWith(`backup restore ${SNAP}`);
  });

  test("--help is answered by the container and copies nothing", () => {
    const r = runUp("backup", "create", "--help");
    expect(r.status).toBe(0);
    expect(r.calls.some((c) => c.startsWith("cp "))).toBe(false);
    expect(r.out).not.toContain("Could not find");
  });
});
