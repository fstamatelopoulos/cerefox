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
  // Present, but spelled `-r, --requestor`; asserted separately below. (The
  // MCP schema names the caller `author` since v1.13.1; the CLI read flag
  // kept its spelling — a rename there would be a breaking change.)
  "author",
  "requestor",
]);

/** `section_part` → `--section-part` */
const toFlag = (param: string) => `--${param.replace(/_/g, "-")}`;

describe("metadata writes reach both surfaces (#204)", () => {
  // #201's lesson applied prospectively: the section read shipped on MCP alone
  // and was unreachable from a terminal for a whole release, because nothing
  // compared the two surfaces. This pair went out together; this keeps them
  // together.
  const CLI_META = readFileSync(
    join(import.meta.dir, "..", "src", "cli", "commands", "document-set-metadata.ts"),
    "utf8",
  );

  test("the CLI command exists and calls the same RPC", () => {
    expect(CLI_META).toContain("cerefox_set_document_metadata");
    expect(CLI_META).toContain('.command("set-metadata")');
  });

  test("the CLI offers merge, removal, and explicit replace", () => {
    expect(CLI_META).toContain("--set");
    expect(CLI_META).toContain("--remove");
    expect(CLI_META).toContain("--replace");
  });

  test("removal sends a null, matching RFC 7386 and the MCP contract", () => {
    // If the CLI stripped nulls or used a separate parameter, the two surfaces
    // would diverge on the one semantic that is easy to get wrong.
    expect(CLI_META).toMatch(/patch\[key\] = null/);
  });

  test("--set key=null is refused rather than silently storing the word", () => {
    // Found in review, and it is the exact divergence this file exists to
    // prevent: over MCP `{k: null}` REMOVES the key, while `--set k=null` stored
    // the literal string "null". The earlier assertion above passed throughout,
    // because it checked that a line of code EXISTS rather than what the command
    // does — a guard testing its own source instead of its behaviour.
    expect(CLI_META).toMatch(/raw === "null"/);
    expect(CLI_META).toContain("--remove");
    // The message has to name the alternative, or the refusal is just a wall.
    expect(CLI_META).toMatch(/is ambiguous/);
  });

  test("merge is the default on BOTH surfaces", () => {
    const schema = TOOLS_BY_NAME["cerefox_set_document_metadata"].inputSchema as {
      required?: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toEqual(["document_id", "metadata"]);
    // `replace` is optional, so omitting it merges.
    expect(schema.required).not.toContain("replace");
    expect(CLI_META).toContain("Boolean(options.replace)");
  });

  test("the command is registered under the document group", () => {
    const program = readFileSync(
      join(import.meta.dir, "..", "src", "cli", "program.ts"),
      "utf8",
    );
    expect(program).toContain("registerDocumentSetMetadata(document)");
  });
});

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
