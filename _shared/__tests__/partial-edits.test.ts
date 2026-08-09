/**
 * Unit tests for `_shared/partial-edits/` — the pure string layer of the
 * partial-edits contract (spec: docs/specs/partial-document-edits-design.md §3).
 *
 * Every §3 semantic maps to a named test here; the live staging suite
 * (packages/memory/test/partial-edits-live.test.ts) covers the same contract
 * end-to-end through the RPC.
 */

import { describe, expect, test } from "bun:test";

import {
  AmbiguousAnchorError,
  AmbiguousPositionError,
  AnchorNotFoundError,
  applyOperations,
  InvalidOperationError,
  parseOutline,
  resolveAnchor,
  validateOperations,
  type EditOperation,
} from "../partial-edits/index.ts";

const DOC = `# Title

Intro paragraph.

## Intake

| time | item |
|------|------|
| 9:00 | coffee |

### Notes

Some notes.

## Totals

Calories: 1200

## Backlog

### Notes

Backlog notes.
`;

describe("parseOutline", () => {
  test("finds every heading with level and path", () => {
    const o = parseOutline(DOC);
    expect(o.map((n) => n.path)).toEqual([
      "# Title",
      "# Title > ## Intake",
      "# Title > ## Intake > ### Notes",
      "# Title > ## Totals",
      "# Title > ## Backlog",
      "# Title > ## Backlog > ### Notes",
    ]);
    expect(o[1].level).toBe(2);
    expect(o[2].level).toBe(3);
  });

  test("offsets reconstruct the section text", () => {
    const o = parseOutline(DOC);
    const totals = o.find((n) => n.heading === "## Totals")!;
    expect(DOC.slice(totals.start, totals.subtreeEnd)).toContain("Calories: 1200");
    expect(DOC.slice(totals.start, totals.subtreeEnd)).not.toContain("Backlog");
  });

  test("ownBodyEnd stops before the first child; subtreeEnd spans children", () => {
    const o = parseOutline(DOC);
    const intake = o.find((n) => n.heading === "## Intake")!;
    const ownBody = DOC.slice(intake.bodyStart, intake.ownBodyEnd);
    expect(ownBody).toContain("coffee");
    expect(ownBody).not.toContain("Some notes");
    const subtree = DOC.slice(intake.bodyStart, intake.subtreeEnd);
    expect(subtree).toContain("Some notes");
    expect(subtree).not.toContain("Calories");
  });

  test("leaf section: ownBodyEnd === subtreeEnd", () => {
    const o = parseOutline(DOC);
    const totals = o.find((n) => n.heading === "## Totals")!;
    expect(totals.ownBodyEnd).toBe(totals.subtreeEnd);
  });

  test("per-section chars are subtree sizes", () => {
    const o = parseOutline(DOC);
    const intake = o.find((n) => n.heading === "## Intake")!;
    expect(intake.chars).toBe(intake.subtreeEnd - intake.start);
    expect(intake.chars).toBeGreaterThan(0);
  });

  test("headings inside backtick fences are content, not structure", () => {
    const doc = "## Real\n\n```md\n## Fake heading\n### Also fake\n```\n\n## Also real\n";
    const o = parseOutline(doc);
    expect(o.map((n) => n.heading)).toEqual(["## Real", "## Also real"]);
  });

  test("headings inside tilde fences are content", () => {
    const doc = "## Real\n\n~~~\n# Fake\n~~~\n";
    expect(parseOutline(doc).map((n) => n.heading)).toEqual(["## Real"]);
  });

  test("a fence closes only on a matching, at-least-as-long marker", () => {
    // ```` opened; ``` does NOT close it (CommonMark), so ## Inside stays content.
    const doc = "## Real\n\n````\n```\n## Inside\n````\n\n## After\n";
    expect(parseOutline(doc).map((n) => n.heading)).toEqual(["## Real", "## After"]);
  });

  test("unclosed fence swallows the rest of the document", () => {
    const doc = "## Real\n\n```\n## Never a heading\n";
    expect(parseOutline(doc).map((n) => n.heading)).toEqual(["## Real"]);
  });

  test("no headings → empty outline", () => {
    expect(parseOutline("just prose\n\nno structure")).toEqual([]);
  });

  test("# inside a line is not a heading; #hashtag without space is not a heading", () => {
    const doc = "prose with # not a heading\n#nospace\n## Yes\n";
    expect(parseOutline(doc).map((n) => n.heading)).toEqual(["## Yes"]);
  });
});

describe("resolveAnchor (§3.7)", () => {
  const o = parseOutline(DOC);

  test("unique heading text resolves", () => {
    expect(resolveAnchor(o, "## Totals").heading).toBe("## Totals");
  });

  test("whitespace around the anchor is trimmed", () => {
    expect(resolveAnchor(o, "  ## Totals  ").heading).toBe("## Totals");
  });

  test("absent anchor → AnchorNotFoundError listing known headings, never a fallback", () => {
    expect(() => resolveAnchor(o, "## Nope")).toThrow(AnchorNotFoundError);
    try {
      resolveAnchor(o, "## Nope");
    } catch (e) {
      expect((e as Error).message).toContain("## Intake");
      expect((e as Error).message).toContain("No write was performed");
    }
  });

  test("duplicate heading → AmbiguousAnchorError carrying resolving paths", () => {
    try {
      resolveAnchor(o, "### Notes");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AmbiguousAnchorError);
      expect((e as AmbiguousAnchorError).candidates).toEqual([
        "# Title > ## Intake > ### Notes",
        "# Title > ## Backlog > ### Notes",
      ]);
    }
  });

  test("a parent path disambiguates a duplicate heading", () => {
    const n = resolveAnchor(o, "# Title > ## Backlog > ### Notes");
    expect(DOC.slice(n.bodyStart, n.subtreeEnd)).toContain("Backlog notes");
  });

  test("a heading containing the path separator is addressable by its own text", () => {
    // Real documents have headings like `## Draft > Review`. Treating every
    // anchor containing " > " as a path made these unaddressable: the outline
    // printed the heading, and passing it back said "not found" while listing
    // it. Found by adversarial testing against staging.
    const doc = "# R\n\n## A > B\n\nbody\n\n## Plain\n\nplain\n";
    const o = parseOutline(doc);
    expect(resolveAnchor(o, "## A > B").heading).toBe("## A > B");
    // The full path form still works for the same section.
    expect(resolveAnchor(o, "# R > ## A > B").heading).toBe("## A > B");
  });

  test("a literal heading match wins over a path interpretation", () => {
    const doc = "# R\n\n## A > B\n\nliteral\n\n## A\n\n### B\n\nnested\n";
    const o = parseOutline(doc);
    // "## A > B" is BOTH a literal heading and, read as a path, the nested
    // "# R > ## A > ### B". The literal reading is the less surprising one.
    expect(resolveAnchor(o, "## A > B").heading).toBe("## A > B");
  });

  test("path segments are individually trimmed", () => {
    const n = resolveAnchor(o, "# Title >  ## Backlog  > ### Notes");
    expect(n.path).toBe("# Title > ## Backlog > ### Notes");
  });
});

function apply(content: string, ops: EditOperation[]) {
  return applyOperations(content, validateOperations(ops));
}

describe("insert positions (§3.1, §3.3)", () => {
  test("end_of_document appends as a block", () => {
    const { content } = apply(DOC, [
      { op: "insert", position: "end_of_document", text: "## New\n\nTail." },
    ]);
    expect(content.endsWith("## New\n\nTail.\n")).toBe(true);
    expect(content).toContain("Backlog notes");
  });

  test("end_of_section on a leaf lands before the next heading", () => {
    const { content } = apply(DOC, [
      { op: "insert", position: "end_of_section", anchor_heading: "## Totals", text: "Protein: 80g" },
    ]);
    const totalsIdx = content.indexOf("Calories: 1200");
    const insertIdx = content.indexOf("Protein: 80g");
    const backlogIdx = content.indexOf("## Backlog");
    expect(insertIdx).toBeGreaterThan(totalsIdx);
    expect(insertIdx).toBeLessThan(backlogIdx);
  });

  test("end_of_section on body+children WITHOUT section_part errors with both candidates (§3.3)", () => {
    try {
      apply(DOC, [
        { op: "insert", position: "end_of_section", anchor_heading: "## Intake", text: "| 12:00 | lunch |" },
      ]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).name).toBe("AmbiguousPositionError");
      expect((e as Error).message).toContain("own_body");
      expect((e as Error).message).toContain("subtree");
      expect((e as Error).message).toContain("### Notes");
    }
  });

  test("section_part: own_body inserts before the first child", () => {
    const { content } = apply(DOC, [
      { op: "insert", position: "end_of_section", anchor_heading: "## Intake", section_part: "own_body", text: "| 12:00 | lunch |" },
    ]);
    expect(content.indexOf("| 12:00 | lunch |")).toBeLessThan(content.indexOf("### Notes"));
    expect(content.indexOf("| 12:00 | lunch |")).toBeGreaterThan(content.indexOf("| 9:00 | coffee |"));
  });

  test("section_part: subtree inserts after the last child", () => {
    const { content } = apply(DOC, [
      { op: "insert", position: "end_of_section", anchor_heading: "## Intake", section_part: "subtree", text: "End of intake." },
    ]);
    expect(content.indexOf("End of intake.")).toBeGreaterThan(content.indexOf("Some notes."));
    expect(content.indexOf("End of intake.")).toBeLessThan(content.indexOf("## Totals"));
  });

  test("children-without-own-body is NOT ambiguous: goes to subtree end", () => {
    const doc = "## Parent\n\n### A\n\na body\n\n### B\n\nb body\n";
    const { content } = apply(doc, [
      { op: "insert", position: "end_of_section", anchor_heading: "## Parent", text: "Tail." },
    ]);
    expect(content.indexOf("Tail.")).toBeGreaterThan(content.indexOf("b body"));
  });

  test("after_heading inserts between heading and body", () => {
    const { content } = apply(DOC, [
      { op: "insert", position: "after_heading", anchor_heading: "## Totals", text: "(lead-in)" },
    ]);
    const rel = content.slice(content.indexOf("## Totals"));
    expect(rel.indexOf("(lead-in)")).toBeLessThan(rel.indexOf("Calories"));
  });

  test("before_heading inserts a block above the section", () => {
    const { content } = apply(DOC, [
      { op: "insert", position: "before_heading", anchor_heading: "## Totals", text: "## Remaining\n\nTBD" },
    ]);
    expect(content.indexOf("## Remaining")).toBeLessThan(content.indexOf("## Totals"));
    expect(content.indexOf("## Remaining")).toBeGreaterThan(content.indexOf("Some notes."));
  });

  test("the §1 scope-confusion guarantee: insert never removes a byte of existing content", () => {
    const inserts: EditOperation[] = [
      { op: "insert", position: "end_of_document", text: "X" },
      { op: "insert", position: "end_of_section", anchor_heading: "## Totals", text: "X" },
      { op: "insert", position: "after_heading", anchor_heading: "## Backlog", text: "X" },
      { op: "insert", position: "before_heading", anchor_heading: "# Title > ## Intake > ### Notes", text: "X" },
    ];
    for (const ins of inserts) {
      const { content } = apply(DOC, [ins]);
      // Every original non-empty line survives verbatim.
      for (const line of DOC.split("\n").filter((l) => l.trim().length)) {
        expect(content).toContain(line);
      }
      expect(content.length).toBeGreaterThan(DOC.length);
    }
  });
});

describe("replace_section (§3.5)", () => {
  test("replaces a leaf body, keeps the heading", () => {
    const { content } = apply(DOC, [
      { op: "replace_section", anchor_heading: "## Totals", text: "Calories: 1450\n\nProtein: 90g" },
    ]);
    expect(content).toContain("## Totals");
    expect(content).toContain("Calories: 1450");
    expect(content).not.toContain("Calories: 1200");
    expect(content).toContain("## Backlog"); // neighbours untouched
  });

  test("body+children without section_part errors (freeze-pass rule)", () => {
    expect(() =>
      apply(DOC, [{ op: "replace_section", anchor_heading: "## Intake", text: "new" }]),
    ).toThrow(/section_part/);
  });

  test("own_body replace keeps children", () => {
    const { content } = apply(DOC, [
      { op: "replace_section", anchor_heading: "## Intake", section_part: "own_body", text: "| new table |" },
    ]);
    expect(content).toContain("| new table |");
    expect(content).toContain("Some notes."); // child survived
    expect(content).not.toContain("coffee");
  });

  test("subtree replace removes children", () => {
    const { content } = apply(DOC, [
      { op: "replace_section", anchor_heading: "## Intake", section_part: "subtree", text: "flattened" },
    ]);
    expect(content).toContain("flattened");
    expect(content).not.toContain("Some notes.");
    expect(content).toContain("## Totals");
  });
});

describe("delete_section (§3.6)", () => {
  test("default scope body_only keeps the heading", () => {
    const { content } = apply(DOC, [{ op: "delete_section", anchor_heading: "## Totals" }]);
    expect(content).toContain("## Totals");
    expect(content).not.toContain("Calories: 1200");
  });

  test("heading_and_body removes the heading too", () => {
    const { content } = apply(DOC, [
      { op: "delete_section", anchor_heading: "## Totals", scope: "heading_and_body" },
    ]);
    expect(content).not.toContain("## Totals");
    expect(content).not.toContain("Calories: 1200");
    expect(content).toContain("## Backlog");
  });

  test("nested target requires section_part; subtree delete takes children", () => {
    expect(() =>
      apply(DOC, [{ op: "delete_section", anchor_heading: "## Intake", scope: "heading_and_body" }]),
    ).toThrow(/section_part/);
    const { content } = apply(DOC, [
      { op: "delete_section", anchor_heading: "## Intake", scope: "heading_and_body", section_part: "subtree" },
    ]);
    expect(content).not.toContain("## Intake");
    expect(content).not.toContain("Some notes.");
    expect(content).toContain("## Totals");
  });
});

describe("batches (§3.4)", () => {
  test("operations apply in order against the evolving document", () => {
    const { content, applied } = apply(DOC, [
      { op: "insert", position: "end_of_document", text: "## Day 2" },
      // Anchors a section created by op 1 — only works if op 2 sees op 1's result.
      { op: "insert", position: "end_of_section", anchor_heading: "## Day 2", text: "Entry." },
      { op: "replace_section", anchor_heading: "## Totals", text: "Calories: 1450" },
    ]);
    expect(content).toContain("## Day 2");
    const rel = content.slice(content.indexOf("## Day 2"));
    expect(rel).toContain("Entry.");
    expect(content).toContain("Calories: 1450");
    expect(applied).toHaveLength(3);
    expect(applied.map((a) => a.op)).toEqual(["insert", "insert", "replace_section"]);
  });

  test("session 4's motivating shape: row + totals + revision in one batch", () => {
    const { content } = apply(DOC, [
      { op: "insert", position: "end_of_section", anchor_heading: "## Intake", section_part: "own_body", text: "| 14:20 | snack |" },
      { op: "replace_section", anchor_heading: "## Totals", text: "Calories: 1450" },
      { op: "replace_section", anchor_heading: "# Title > ## Backlog > ### Notes", text: "Remaining to target: 550" },
    ]);
    expect(content).toContain("| 14:20 | snack |");
    expect(content).toContain("Calories: 1450");
    expect(content).toContain("Remaining to target: 550");
    expect(content).toContain("Some notes."); // Intake's child untouched
  });

  test("a failing op reports its 1-based index and applies nothing (all-or-nothing)", () => {
    try {
      apply(DOC, [
        { op: "insert", position: "end_of_document", text: "ok" },
        { op: "replace_section", anchor_heading: "## Missing", text: "x" },
      ]);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("Operation 2 of 2 failed");
      expect((e as Error).message).toContain("## Missing");
    }
  });

  test("validation failures are index-precise and precede any application", () => {
    expect(() => validateOperations([])).toThrow(InvalidOperationError);
    expect(() => validateOperations([{ op: "insert", position: "sideways", text: "x" }])).toThrow(
      /index 0/,
    );
    expect(() =>
      validateOperations([
        { op: "insert", position: "end_of_document", text: "ok" },
        { op: "delete_section", anchor_heading: "## X", scope: "everything" },
      ]),
    ).toThrow(/index 1/);
    expect(() =>
      validateOperations([{ op: "insert", position: "end_of_document", text: "x", anchor_heading: "## Y" }]),
    ).toThrow(/no anchor_heading/);
  });
});

describe("block separation normalization", () => {
  test("insert is separated by exactly one blank line on each side", () => {
    const doc = "## A\n\nbody a\n\n## B\n\nbody b\n";
    const { content } = apply(doc, [
      { op: "insert", position: "end_of_section", anchor_heading: "## A", text: "\n\n\nnew\n\n\n" },
    ]);
    expect(content).toContain("body a\n\nnew\n\n## B");
  });

  test("delete collapses the residual gap", () => {
    const doc = "## A\n\nbody a\n\n## B\n\nbody b\n\n## C\n\nbody c\n";
    const { content } = apply(doc, [
      { op: "delete_section", anchor_heading: "## B", scope: "heading_and_body" },
    ]);
    expect(content).toContain("body a\n\n## C");
    expect(content).not.toContain("\n\n\n");
  });

  test("document without trailing newline keeps its convention", () => {
    const doc = "## A\n\nbody";
    const { content } = apply(doc, [{ op: "insert", position: "end_of_document", text: "tail" }]);
    expect(content.endsWith("tail")).toBe(true);
    expect(content.endsWith("\n")).toBe(false);
  });
});
