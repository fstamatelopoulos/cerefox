/**
 * Keep every documented tool count honest against `ALL_TOOLS`.
 *
 * The tool count is a fact repeated across a dozen documents, and it drifted
 * badly: at one point **8, 10, 12 and 16 were all in circulation** — README and
 * connect-agents said 10, CLAUDE.md said 8, the quick reference said 16, and
 * two docs I had just edited said 12. Agents reading the docs noticed and
 * complained, which is the right outcome but the wrong way to find out.
 *
 * Fixing the numbers is not the fix; they will drift again the next time a tool
 * is added. This asserts them against the code instead:
 *
 *   CORE  = tools always visible                    (currently 12)
 *   ALL   = CORE + the dormant relation tools       (currently 16)
 *
 * A doc may claim either number. Anything else fails, naming the file and line,
 * so adding a tool means updating the docs in the same change rather than
 * discovering the gap months later.
 *
 * **CHANGELOG.md and docs/plans/history.md are excluded on purpose.** Both are
 * historical records: "14 tools" in the v1.2.0 entry was true when written, and
 * rewriting history to match the present would be the actual error.
 *
 * Pure text analysis. No DB, no network.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { ALL_TOOLS } from "../mcp-tools/index.ts";
import { RELATION_TOOL_NAMES } from "../mcp-tools/feature-flags.ts";

const REPO = join(import.meta.dir, "..", "..");

const ALL_COUNT = ALL_TOOLS.length;
const CORE_COUNT = ALL_COUNT - RELATION_TOOL_NAMES.size;

/** Records of what shipped, not statements about what exists now. */
const HISTORICAL = ["CHANGELOG.md", join("docs", "plans", "history.md")];

/**
 * Git-tracked markdown only. `packages/memory/{docs,AGENT_*.md}` are gitignored
 * copies produced by `bundle_package_docs.ts` at release time — a stale count
 * there means the bundle is old, which is a regeneration concern, not a
 * documentation one, and scanning them would fail this test on a dirty
 * working tree.
 */
function markdownFiles(): string[] {
  return execFileSync("git", ["ls-files", "*.md"], { cwd: REPO, encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((f) => join(REPO, f));
}

/**
 * "12 tools", "12 core tools", "12 MCP tools", "**16 MCP tools**" …
 *
 * The lookbehind rejects a preceding `.`, digit or `v`, which is what keeps
 * section numbering ("3.2 Tool definitions") and version strings ("v0.4 MCP
 * tool audit") out — both matched on the first attempt and would have made this
 * test noise rather than signal.
 */
const COUNT_CLAIM = /(?<![\d.vV-])(\d+)\s+(?:core\s+)?(?:MCP\s+)?tools?\b/gi;

describe("documented tool counts match ALL_TOOLS", () => {
  test("the split is what the docs describe", () => {
    // If this fails, the docs are not wrong — the shape of the tool surface
    // changed, and the numbers below need rethinking rather than bumping.
    expect(ALL_COUNT).toBe(16);
    expect(CORE_COUNT).toBe(12);
    expect(RELATION_TOOL_NAMES.size).toBe(4);
  });

  test("no live document states a stale count", () => {
    const offenders: string[] = [];
    for (const file of markdownFiles()) {
      const rel = relative(REPO, file);
      if (HISTORICAL.some((h) => rel === h)) continue;

      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const m of line.matchAll(COUNT_CLAIM)) {
          const n = Number.parseInt(m[1], 10);
          if (n !== CORE_COUNT && n !== ALL_COUNT) {
            offenders.push(`${rel}:${i + 1} claims "${m[0]}"`);
          }
        }
      });
    }
    // Reported all at once: fixing them one failure at a time is how the
    // inconsistency survived this long.
    expect(offenders).toEqual([]);
  });
});
