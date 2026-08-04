/**
 * Live e2e regression tests for the 28I search-recall refinement (v1.0.3):
 *
 *   1. OR-fallback: a multi-term query where one term is absent from the
 *      target document (and the KB) must still find the document — the
 *      pre-28I AND-semantics returned nothing (one absent term vetoed all
 *      matching ones).
 *   2. Precision guard: a query whose terms ALL occur keeps matching, with
 *      no below-confidence banner.
 *   3. Below-confidence fallback: a query matching nothing lexically or
 *      semantically returns flagged best-effort candidates (or, on an empty
 *      corpus, a clean "No results found.") — never a silent failure.
 *
 * Uses invented tokens so nothing else in the target KB can interfere.
 * Auto-skips when Supabase isn't reachable, and when the deployed schema
 * predates 0.9.0 (the below_confidence return column).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { loadSettings } from "../../../_shared/config/index.ts";
import { createClient } from "../../../_shared/db-client/index.ts";

const E2E_TITLE_PREFIX = "[E2E v1.0.3-recall]";

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
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? -1 };
}

const probe = run(["project", "list", "--json"]);
const LIVE_OK = probe.status === 0;

// below_confidence ships with schema 0.9.0; the term-coverage gate with
// 0.9.1 — gate on 0.9.1 so the whole file tests the current contract.
const SCHEMA_OK = await (async () => {
  if (!LIVE_OK) return false;
  try {
    const settings = loadSettings();
    const client = createClient(settings);
    const ver = await client.rpc<string>("cerefox_schema_version", {});
    const [maj = 0, min = 0, patch = 0] = String(ver ?? "0.0.0").split(".").map(Number);
    return maj > 0 || min > 9 || (min === 9 && patch >= 1);
  } catch {
    return false;
  }
})();

async function hardPurgeE2eDocs(): Promise<void> {
  try {
    const settings = loadSettings();
    if (!settings.supabaseUrl || !settings.supabaseKey) return;
    const client = createClient(settings);
    await client.raw.from("cerefox_documents").delete().like("title", `${E2E_TITLE_PREFIX}%`);
  } catch {
    // best-effort
  }
}

describe("search recall refinement (28I, live)", () => {
  if (!LIVE_OK) {
    test.skip(`Supabase not reachable (probe exit ${probe.status}); skipping`, () => {});
    return;
  }
  if (!SCHEMA_OK) {
    test.skip("deployed schema < 0.9.0 (no below_confidence); skipping", () => {});
    return;
  }

  afterAll(async () => {
    await hardPurgeE2eDocs();
  });

  // Invented tokens: present-in-doc trio + one token absent everywhere.
  const PRESENT = ["zybrofen", "kaltrixon", "murvalade"];
  const ABSENT = "quexolint";

  test("OR-fallback finds a doc despite one absent query term", async () => {
    await hardPurgeE2eDocs(); // clear any prior-run leftovers first

    const dir = mkdtempSync(join(tmpdir(), "cfx-recall-"));
    const file = join(dir, "recall-seed.md");
    writeFileSync(
      file,
      `# ${E2E_TITLE_PREFIX} Recall Seed\n\n` +
        `Notes about ${PRESENT[0]} integration: the ${PRESENT[1]} pipeline ` +
        `feeds the ${PRESENT[2]} reports for the quarterly review.\n`,
    );
    const ingest = run(["document", "ingest", file, "--title", `${E2E_TITLE_PREFIX} Recall Seed`, "--author", "e2e-test"]);
    rmSync(dir, { recursive: true, force: true });
    expect(ingest.status).toBe(0);

    // Pre-28I: plainto AND-semantics — the absent 4th term returned nothing.
    const q = [...PRESENT, ABSENT].join(" ");
    const res = run(["search", q]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Recall Seed");
    // FTS matched (3 of 4 terms) → a real pass, not a below-confidence rescue.
    expect(res.stdout).not.toContain("confidence threshold");
  });

  test("precision guard: all-terms query matches, unflagged", () => {
    const res = run(["search", PRESENT.join(" ")]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Recall Seed");
    expect(res.stdout).not.toContain("confidence threshold");
  });

  test("fts mode gets the OR-fallback too", () => {
    const res = run(["search", [...PRESENT, ABSENT].join(" "), "--mode", "fts"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Recall Seed");
  });

  test("coverage gate: one real term among nonsense is never a confident hit (v1.0.4)", () => {
    // 1-of-5 coverage — the post-1.0.3 over-relaxation returned these as
    // unflagged results; now they must be flagged fallback or empty.
    const res = run(["search", `${PRESENT[0]} zzqix vvbot kktle wmtos`, "--json"]);
    expect(res.status).toBe(0);
    const results = JSON.parse(res.stdout).results as Array<{ below_confidence?: boolean }>;
    if (results.length > 0) {
      expect(results.every((r) => r.below_confidence === true)).toBe(true);
    }
  });

  test("nothing-matches query: flagged candidates or clean no-results — never an error", () => {
    const res = run(["search", `${ABSENT} vandrobar plixofene`]);
    expect(res.status).toBe(0);
    const flagged = res.stdout.includes("confidence threshold");
    const empty = res.stdout.includes("No results found.");
    expect(flagged || empty).toBe(true);
    if (flagged) {
      // Scores must stay visible so the caller can judge.
      expect(res.stdout).toMatch(/score/i);
    }
  });
});
