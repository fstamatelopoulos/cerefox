/**
 * Nothing Cerefox tells a user to run may name a renamed CLI verb.
 *
 * The v0.9.0 renames left the old flat verbs registered as hidden husks that
 * exit non-zero with a pointer (`RENAMED_VERBS` in `program.ts`). That keeps
 * old scripts failing loudly, but it also means a stale `cerefox ingest` in a
 * hint, a banner or a first-run tip looks plausible and fails when followed.
 * Several did, for many releases: the web UI's schema banner still said
 * `cerefox deploy-server --schema-only`, and both `cerefox` with no arguments
 * and `cerefox init` ended by suggesting `cerefox ingest <file>`.
 *
 * Scope: a text scan of shipped source (`packages/memory/src`, `frontend/src`,
 * `_shared`), tests excluded. Comment lines are skipped: they name old verbs
 * as history, and nobody runs a comment. The verb list is derived from
 * `RENAMED_VERBS`, so a future rename is covered without editing this file.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { RENAMED_VERBS } from "../src/cli/program.ts";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ROOTS = ["packages/memory/src", "frontend/src", "_shared"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `cerefox <old-verb>` followed by a space, a closing quote/backtick (escaped or
// not), or the end of the line, so `cerefox docs` matches and `cerefox
// docs-site` would not.
const STALE = new RegExp(
  `\\bcerefox (${RENAMED_VERBS.map(([old]) => escape(old)).join("|")})(?=[\\s\`"'\\\\]|$)`,
);

const isComment = (line: string) => /^\s*(\/\/|\/\*|\*)/.test(line);

export function staleLines(source: string): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];
  source.split("\n").forEach((text, i) => {
    if (!isComment(text) && STALE.test(text)) hits.push({ line: i + 1, text: text.trim() });
  });
  return hits;
}

describe("stale command names", () => {
  test("the detector fires on the shapes it exists to catch", () => {
    expect(staleLines(`    cerefox deploy-server --schema-only`)).toHaveLength(1);
    expect(staleLines(`println(c.dim("  cerefox ingest <file>  # add a doc"));`)).toHaveLength(1);
    expect(staleLines("hint: \"Run `cerefox list-projects` to see names.\"")).toHaveLength(1);
    expect(staleLines("Run \\`cerefox sync-self-docs\\` manually")).toHaveLength(1);
  });

  test("the detector leaves current forms and comments alone", () => {
    expect(staleLines(`    cerefox server deploy --schema-only`)).toHaveLength(0);
    expect(staleLines(`"  cerefox document ingest <file>"`)).toHaveLength(0);
    expect(staleLines(`"cerefox guides ingest"`)).toHaveLength(0);
    expect(staleLines(` * \`cerefox ingest [path]\` — the pre-v0.9 name`)).toHaveLength(0);
    expect(staleLines(`// renamed from cerefox deploy-server`)).toHaveLength(0);
  });

  test("no shipped source tells a user to run a renamed verb", () => {
    const files = ROOTS.flatMap((r) => sourceFiles(join(REPO, r)));
    // A scan that silently found nothing to scan would pass vacuously.
    expect(files.length).toBeGreaterThan(200);
    const offenders = files.flatMap((f) =>
      staleLines(readFileSync(f, "utf8")).map((h) => `${relative(REPO, f)}:${h.line}  ${h.text}`),
    );
    expect(offenders).toEqual([]);
  });
});
