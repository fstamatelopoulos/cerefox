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
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
