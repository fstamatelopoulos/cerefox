/**
 * The Cerefox Local web service's s6 `finish` script (#335). An out-of-memory
 * kill used to leave nothing in the container log but the restart; the script
 * names it. s6 calls it with the exit code ($1, 256 when a signal killed the
 * process) and the signal ($2).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "../../../docker/local/s6/s6-rc.d/cerefox-server/finish");

function run(...args: string[]): { stderr: string; status: number | null } {
  const r = spawnSync("sh", [SCRIPT, ...args], { encoding: "utf8" });
  return { stderr: r.stderr, status: r.status };
}

describe("cerefox-server finish script (#335)", () => {
  test("SIGKILL names the out-of-memory killer and where to look", () => {
    const r = run("256", "9");
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("out-of-memory");
    expect(r.stderr).toContain("dmesg");
  });

  test("a normal stop (SIGTERM) or a clean exit says nothing", () => {
    expect(run("256", "15").stderr).toBe("");
    expect(run("0", "0").stderr).toBe("");
  });

  test("any other exit is reported with its status", () => {
    expect(run("1", "0").stderr).toContain("status 1");
    expect(run("256", "6").stderr).toContain("signal 6");
  });

  test("always exits 0, so s6 restarts the service", () => {
    expect(run("256", "9").status).toBe(0);
    expect(run("1", "0").status).toBe(0);
  });
});
