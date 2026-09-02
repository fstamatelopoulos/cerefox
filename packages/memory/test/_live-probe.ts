/**
 * The one "is the live backend reachable?" probe.
 *
 * ## Why this is a shared module and not three copies
 *
 * It was three copies, and two of them rotted. The probe spawned
 * `cerefox list-projects --json` and treated a non-zero exit as "backend
 * unreachable". **v0.9.0 renamed that verb to `project list`**, leaving
 * `list-projects` as a deliberate husk that prints a pointer and exits 1.
 *
 * The husk worked exactly as designed. The probe read its exit code as
 * "Supabase is unreachable" and skipped. From v0.9.0 to v1.10.1 the entire
 * `web-integration/` HTTP-boundary suite and the live half of
 * `stdio-smoke.test.ts` reported success while running nothing. Eleven
 * releases, a green suite, and no coverage — found only because a new test
 * in that directory skipped when it should have run.
 *
 * Two lessons are baked in below:
 *
 *  1. **One implementation.** A probe copied into each file is a list that has
 *     to match another list (the CLI's verbs), and that shape has now produced
 *     four incidents on this project.
 *  2. **A probe must not be able to fail silently.** "The backend is
 *     unreachable" and "I asked the CLI something it does not understand" are
 *     different answers, and only the first justifies a skip. The second is a
 *     broken harness and must be loud. `probeSupabase()` throws on it.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PKG_ROOT = join(HERE, "..");
export const REPO_ROOT = join(PKG_ROOT, "..", "..");
export const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

/**
 * The probe command. `project list` is cheap, read-only, and touches the Data
 * API — which is exactly the reachability question.
 */
export const PROBE_ARGV = ["project", "list", "--json"] as const;

/**
 * Output that means the CLI did not understand us, rather than that the
 * backend is down. A renamed-verb husk and commander's unknown-command error
 * both land here.
 */
const HARNESS_BROKEN = /was renamed|unknown command|unknown option|display help/i;

export interface ProbeResult {
  ok: boolean;
  status: number;
  output: string;
}

/** Run the probe once and return the raw result, without interpreting it. */
export function runProbe(): ProbeResult {
  if (!existsSync(BIN)) return { ok: false, status: -1, output: "" };
  const result = spawnSync("node", [BIN, ...PROBE_ARGV], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    timeout: 10_000,
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return { ok: result.status === 0, status: result.status ?? -1, output };
}

/**
 * `true` when the live backend answered. `false` means genuinely unreachable
 * or unconfigured, which is a legitimate reason to skip.
 *
 * **Throws** when the CLI rejected the probe command itself. That is a broken
 * test harness, and the whole point of this module is that it can no longer
 * be mistaken for an absent backend.
 */
export function probeSupabase(): boolean {
  const probe = runProbe();
  if (probe.ok) return true;
  if (HARNESS_BROKEN.test(probe.output)) {
    throw new Error(
      `Live probe is broken: \`cerefox ${PROBE_ARGV.join(" ")}\` was rejected by the CLI ` +
        `(exit ${probe.status}). This is NOT an unreachable backend — it means the probe ` +
        `command no longer exists under that name, which is how the web-integration suite ` +
        `silently skipped from v0.9.0 to v1.10.1. Fix PROBE_ARGV.\n\nCLI said:\n${probe.output.trim()}`,
    );
  }
  return false;
}
