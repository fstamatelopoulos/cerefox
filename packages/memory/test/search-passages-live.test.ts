/**
 * Live: `cerefox search --content matches` (#375) through the real
 * cerefox_search_docs (schema 0.23.0), on a staging-labeled target.
 *
 * The unit tests pin what the client sends and how it renders; only a real
 * database can show what the RPC selects. This seeds one long document whose
 * sections match the query to different degrees, then checks:
 *
 *  - the documents and their order are exactly those of the default search;
 *  - passages come back best score first, and stay within the cap (only the
 *    best one may exceed it, cut and flagged);
 *  - a small cap cuts the best passage and says so;
 *  - the chunk modes refuse the option instead of ignoring it.
 *
 * Invented tokens, so nothing else in the store can interfere. Skips when the
 * target is unreachable, unlabeled (production), or older than 0.23.0.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSettings } from "../../../_shared/config/index.ts";
import { createClient } from "../../../_shared/db-client/index.ts";
import { probeSupabase } from "./_live-probe.ts";
import { mayWriteToLiveTarget } from "./_live-target-guard.ts";
import { liveTest } from "./_live-test.ts";

const PREFIX = "[E2E passages]";
const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  if (!existsSync(BIN)) throw new Error(`Built bin not found at ${BIN}. Run \`bun run build\` first.`);
  const r = spawnSync("node", [BIN, ...args], { encoding: "utf8", cwd: REPO_ROOT, env: { ...process.env } });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status ?? -1 };
}

const LIVE_OK = probeSupabase() && mayWriteToLiveTarget();

const SCHEMA_OK = await (async () => {
  if (!LIVE_OK) return false;
  try {
    const ver = await createClient(loadSettings()).rpc<string>("cerefox_schema_version", {});
    const [maj = 0, min = 0] = String(ver ?? "0.0.0").split(".").map(Number);
    return maj > 0 || min >= 23;
  } catch {
    return false;
  }
})();

const createdIds: string[] = [];

async function purge(): Promise<void> {
  if (createdIds.length === 0) return;
  try {
    const raw = createClient(loadSettings()).raw as unknown as {
      from: (t: string) => { delete: () => { in: (c: string, v: string[]) => Promise<unknown> } };
    };
    await raw.from("cerefox_audit_log").delete().in("document_id", createdIds);
    await raw.from("cerefox_documents").delete().in("id", createdIds);
  } catch {
    // best-effort
  }
}

interface Passage {
  score: number;
  content: string;
  chars: number;
  truncated: boolean;
  heading_path: string[];
}
interface Row {
  document_id: string;
  full_content: string | null;
  is_partial: boolean;
  passages?: Passage[];
  matched_chunk_count?: number;
}

function search(args: string[]): Row[] {
  const r = run(["search", ...args, "--json", "--author", "e2e-test"]);
  expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: expect.any(String) });
  return JSON.parse(r.stdout).results as Row[];
}

// The query, and how strongly each section matches it.
const Q = "glorvantic mirelspan tessobrine";
const filler = (tag: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${tag} paragraph ${i}: ${"ordinary planning prose ".repeat(6)}`).join("\n\n");

describe("search --content matches (#375, live)", () => {
  if (!LIVE_OK) {
    test.skip("no writable staging target; skipping", () => {});
    return;
  }
  if (!SCHEMA_OK) {
    test.skip("deployed schema < 0.23.0 (no p_passages); skipping", () => {});
    return;
  }

  afterAll(purge);

  liveTest("seed a long document whose sections match the query to different degrees", () => {
    const dir = mkdtempSync(join(tmpdir(), "cfx-passages-"));
    const file = join(dir, "seed.md");
    writeFileSync(
      file,
      [
        `# ${PREFIX} Field Notes`,
        `## Background\n\n${filler("background", 8)}\n\nA passing mention of glorvantic.`,
        `## The Core Finding\n\nThe glorvantic mirelspan tessobrine result: glorvantic mirelspan tessobrine ` +
          `holds across every run, and the glorvantic mirelspan tessobrine effect is the headline.\n\n${filler("core", 6)}`,
        `## Logistics\n\n${filler("logistics", 10)}`,
        `## Follow-up\n\nNext, check mirelspan tessobrine on the second rig.\n\n${filler("followup", 8)}`,
      ].join("\n\n"),
    );
    const r = run(["document", "ingest", file, "--title", `${PREFIX} Field Notes`, "--author", "e2e-test"]);
    // A short note, one chunk, that the passages hold whole.
    const small = join(dir, "small.md");
    writeFileSync(small, `# ${PREFIX} Short Note\n\nOn glorvantic mirelspan tessobrine, in brief.\n`);
    const r2 = run(["document", "ingest", small, "--title", `${PREFIX} Short Note`, "--author", "e2e-test"]);
    // One chunk of long single-word tokens around the match: a word-sized
    // headline runs past a small cap, and cutting it to its opening lost the
    // matched term (found by review).
    const longTokens = join(dir, "long-tokens.md");
    const words = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + (i % 26)).repeat(70)).join(" ");
    writeFileSync(longTokens, `# ${PREFIX} Long Tokens\n\n${words(18)} glorvantic ${words(18)}\n`);
    const r3 = run(["document", "ingest", longTokens, "--title", `${PREFIX} Long Tokens`, "--author", "e2e-test"]);
    rmSync(dir, { recursive: true, force: true });
    for (const out of [r, r2, r3]) {
      const id = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/.exec(out.stdout);
      if (id) createdIds.push(id[1]);
    }
    expect([r.status, r2.status, r3.status]).toEqual([0, 0, 0]);
  });

  liveTest("the same documents in the same order as the default search", () => {
    const full = search([Q]);
    const matches = search([Q, "--content", "matches"]);
    expect(matches.map((r) => r.document_id)).toEqual(full.map((r) => r.document_id));
    expect(matches.map((r) => r.document_id)).toContain(createdIds[0]);
  });

  liveTest("passages are best first, within the cap, with no document body", () => {
    const row = search([Q, "--content", "matches"]).find((r) => r.document_id === createdIds[0])!;
    const ps = row.passages!;
    expect(ps.length).toBeGreaterThan(0);
    expect(row.full_content ?? "").toBe("");
    for (let i = 1; i < ps.length; i++) expect(ps[i - 1].score).toBeGreaterThanOrEqual(ps[i].score);
    const kept = ps.reduce((n, p) => n + p.content.length, 0);
    if (ps.length > 1) expect(kept).toBeLessThanOrEqual(1500);
    expect(ps.slice(1).every((p) => !p.truncated)).toBe(true);
    // The best passage is the section that matches the whole query.
    expect(ps[0].content).toContain("glorvantic mirelspan tessobrine");
    expect(row.matched_chunk_count).toBeGreaterThanOrEqual(ps.length);
  });

  liveTest("a small cap cuts the best passage and flags it", () => {
    const row = search([Q, "--content", "matches", "--max-passage-chars", "200"]).find(
      (r) => r.document_id === createdIds[0],
    )!;
    expect(row.passages!.length).toBe(1);
    const [best] = row.passages!;
    expect(best.content.length).toBeLessThanOrEqual(200);
    expect(best.truncated).toBe(true);
    expect(best.chars).toBeGreaterThan(200);
    expect(row.is_partial).toBe(true);
  });

  liveTest("the text output names what was left out and how to read it", () => {
    const r = run(["search", Q, "--content", "matches", "--author", "e2e-test"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/matched passages?, [\d,]+ of [\d,]+ chars/);
    // The best chunk opens with the unrelated Background section; the
    // excerpt must show the part that matched instead.
    expect(r.stdout).toContain("glorvantic mirelspan tessobrine");
    expect(r.stdout).not.toContain("background paragraph 0");
    // The CLI's own command, not the MCP call.
    expect(r.stdout).toContain(`document get ${createdIds[0]}\` reads the whole document; --outline lists its sections`);
    expect(r.stdout).not.toContain("cerefox_get_document(");
  });

  liveTest("a document the passages hold whole is not partial and gets no note", () => {
    const rows = search([Q, "--content", "matches"]);
    const row = rows.find((r) => r.document_id === createdIds[1])!;
    expect(row).toBeDefined();
    expect(row.is_partial).toBe(false);
    expect(row.passages!.every((p) => !p.truncated)).toBe(true);
    const text = run(["search", Q, "--content", "matches", "--author", "e2e-test"]).stdout;
    const block = text.slice(text.indexOf(`${PREFIX} Short Note`));
    expect(block.slice(0, block.indexOf("════"))).not.toContain("reads the whole document");
  });

  liveTest("an excerpt keeps the matched term even when long tokens surround it", () => {
    for (const cap of ["200", "300", "1500"]) {
      const row = search(["glorvantic", "--content", "matches", "--max-passage-chars", cap]).find(
        (r) => r.document_id === createdIds[2],
      )!;
      expect(row).toBeDefined();
      const [best] = row.passages!;
      expect(best.truncated).toBe(true);
      expect(best.content.length).toBeLessThanOrEqual(Number(cap));
      expect(best.content).toContain("glorvantic");
      expect(best.content).not.toMatch(/[\uE000\uE001]/);
    }
  });

  liveTest("a stopword-only query does not fail", () => {
    const r = run(["search", "the and of", "--content", "matches", "--author", "e2e-test"]);
    expect(r.status).toBe(0);
  });

  liveTest("the chunk modes refuse the option instead of ignoring it", () => {
    for (const mode of ["hybrid", "fts"]) {
      const r = run(["search", Q, "--mode", mode, "--content", "matches"]);
      expect(r.status).not.toBe(0);
      expect(r.stderr + r.stdout).toContain("applies to --mode docs only");
    }
  });
});
