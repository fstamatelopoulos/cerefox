/**
 * A read mode added to `cerefox_get_document` must reach the CLI too (#201).
 *
 * v1.4.0 shipped `section` / `section_part` on the MCP tool and not on
 * `document get`, so the feature was unreachable from a terminal for a whole
 * release. Nothing failed: the MCP suites passed, the Edge Function served it,
 * and the CLI simply had no flag.
 *
 * The asymmetry that caused it is worth stating, because it decides which
 * additions are at risk:
 *
 * - `document edit-parts` takes an **opaque JSON operations array** and hands
 *   it to `validateOperations`. A new OPERATION therefore reaches the CLI for
 *   free — `rename_section` (#197) worked from the terminal the day it landed,
 *   with no CLI change at all.
 * - `document get` takes **declared flags**. A new READ MODE does not arrive on
 *   its own, and will be silently missing until somebody tries it.
 *
 * So this guards the flag-declared surface specifically. It is deliberately
 * narrow: a general "every MCP parameter needs a CLI flag" rule would be wrong
 * (`requestor` is shared, `document_id` is a positional argument), and a rule
 * with false positives is one people learn to suppress.
 *
 * Pure text analysis. No network.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TOOLS_BY_NAME } from "../../../_shared/mcp-tools/index.ts";

const CLI_SRC = readFileSync(
  join(import.meta.dir, "..", "src", "cli", "commands", "get-doc.ts"),
  "utf8",
);

/** MCP parameters that intentionally have no `--flag` counterpart. */
const NOT_FLAGS = new Set([
  // Positional `<document-id>` on the CLI.
  "document_id",
  // Present, but spelled `-r, --requestor`; asserted separately below.
  "requestor",
]);

/** `section_part` → `--section-part` */
const toFlag = (param: string) => `--${param.replace(/_/g, "-")}`;

describe("get_document read modes reach both surfaces (#201)", () => {
  const schema = TOOLS_BY_NAME["cerefox_get_document"].inputSchema as {
    properties: Record<string, unknown>;
  };
  const params = Object.keys(schema.properties);

  test("every MCP parameter has a CLI flag", () => {
    const missing = params
      .filter((p) => !NOT_FLAGS.has(p))
      .filter((p) => !CLI_SRC.includes(toFlag(p)));

    // This is the #201 regression: `section` and `section_part` existed on the
    // MCP tool for an entire release with no way to reach them from a terminal.
    expect(missing).toEqual([]);
  });

  test("the parameter list is non-trivial, so this cannot pass vacuously", () => {
    expect(params.length).toBeGreaterThanOrEqual(5);
    expect(params).toContain("section");
    expect(params).toContain("outline");
  });

  test("requestor is present under its own spelling", () => {
    expect(CLI_SRC).toContain("--requestor");
  });

  test("the CLI refuses the same combinations the MCP tool refuses", () => {
    // Symmetry of refusals, not just of capability: outline+section together,
    // and section_part without section.
    expect(CLI_SRC).toContain("not both");
    expect(CLI_SRC).toContain("only applies together with --section");
  });

  test("the CLI resolves extent through the shared extractSection", () => {
    // The equivalence property of #198 only holds if both surfaces use the same
    // resolver. A hand-rolled slice here would drift silently.
    expect(CLI_SRC).toContain("extractSection");
  });
});
