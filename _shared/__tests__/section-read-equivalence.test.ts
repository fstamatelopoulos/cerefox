/**
 * The section read must return EXACTLY what `replace_section` would overwrite
 * (#198).
 *
 * This is the property the whole feature rests on. A read that resolves extent
 * even slightly differently from the write it feeds is worse than no read at
 * all: today a caller knows it is blind, whereas a subtly-wrong read looks like
 * knowledge. The dangerous divergence is not exotic — it is a section with
 * child sections, where "the end" can mean before the first child or after the
 * last, and those can be pages apart.
 *
 * `extractSection` shares `resolveAnchor` and `resolveSectionEnd` with the write
 * path, so equivalence is structural rather than maintained by convention.
 * These tests exist to keep it that way if someone ever inlines either.
 *
 * The property is expressed as **read-after-write**: replace a section with a
 * sentinel, read it back, and you must get the sentinel. If read and write
 * disagreed about the extent by even one line, the read would return the
 * sentinel plus (or minus) whatever the disagreement covered.
 */

import { describe, expect, test } from "bun:test";

import {
  AmbiguousPositionError,
  applyOperations,
  extractSection,
  parseOutline,
} from "../partial-edits/index.ts";

const SENTINEL = "SENTINEL-BODY-9f3a";

/** Documents chosen for the shapes where extent resolution can differ. */
const DOCS: Record<string, string> = {
  flat: `# Root\n\nroot body\n\n## A\n\na body\n\n## B\n\nb body\n`,
  nested: `# Root\n\nroot body\n\n## Parent\n\nparent body\n\n### Child\n\nchild body\n\n## After\n\nafter body\n`,
  childrenOnly: `# Root\n\n## Parent\n\n### C1\n\nc1 body\n\n### C2\n\nc2 body\n\n## After\n\nafter\n`,
  lastSection: `# Root\n\nroot\n\n## Only\n\nonly body\n`,
  deep: `# R\n\nr\n\n## L2\n\ntwo\n\n### L3\n\nthree\n\n#### L4\n\nfour\n`,
  fenced: `# Root\n\n## Code\n\n\`\`\`md\n## Not A Heading\n\`\`\`\n\ntail\n\n## Real\n\nreal body\n`,
};

/** Every (document, heading) pair, with the section_part values that apply. */
function cases(): Array<{ doc: string; src: string; heading: string; part?: "own_body" | "subtree" }> {
  const out: Array<{ doc: string; src: string; heading: string; part?: "own_body" | "subtree" }> = [];
  for (const [doc, src] of Object.entries(DOCS)) {
    for (const node of parseOutline(src)) {
      // A section with children refuses without section_part — so enumerate
      // both readings for every heading and let the leaf case ignore them.
      out.push({ doc, src, heading: node.path });
      out.push({ doc, src, heading: node.path, part: "own_body" });
      out.push({ doc, src, heading: node.path, part: "subtree" });
    }
  }
  return out;
}

describe("section read returns exactly what replace_section overwrites (#198)", () => {
  test("read-after-write round-trips for every section and section_part", () => {
    let checked = 0;
    let refusedBoth = 0;

    for (const { doc, src, heading, part } of cases()) {
      let readBefore: string;
      try {
        readBefore = extractSection(src, heading, part).text;
      } catch (err) {
        // If the read refuses, the write MUST refuse for the same reason.
        // Compare substance, not text: the two messages differ deliberately —
        // `applyOperations` wraps failures with batch context ("Operation 1 of
        // 3 failed: …"), and the read omits "No write was performed", which
        // would imply it had attempted one. What must match is the anchor at
        // fault and the choice offered.
        let writeError: Error | null = null;
        try {
          applyOperations(src, [
            { op: "replace_section", anchor_heading: heading, section_part: part, text: SENTINEL },
          ]);
        } catch (e) {
          writeError = e as Error;
        }
        expect(writeError).not.toBeNull();
        const readMsg = (err as Error).message;
        const writeMsg = writeError!.message;
        for (const token of ["own_body", "subtree"]) {
          expect(readMsg.includes(token)).toBe(writeMsg.includes(token));
        }
        // Same failing anchor named in both.
        expect(writeMsg).toContain(heading.split(" > ").pop()!);
        expect(readMsg).toContain(heading.split(" > ").pop()!);
        // And the read never claims a write was involved.
        expect(readMsg).not.toContain("No write was performed");
        refusedBoth++;
        continue;
      }

      const { content: after } = applyOperations(src, [
        { op: "replace_section", anchor_heading: heading, section_part: part, text: SENTINEL },
      ]);

      const readAfter = extractSection(after, heading, part).text;
      expect(readAfter.trim()).toBe(SENTINEL);

      // And the text that was there is genuinely gone — but only assert it when
      // the body is distinctive enough for absence to mean anything. A
      // one-character body like "r" occurs inside "three" and "Root", so
      // asserting on it would test the fixture's vocabulary, not the code.
      const distinctive = readBefore.trim();
      const occursOnce = distinctive.length >= 4 && src.split(distinctive).length === 2;
      if (occursOnce && !distinctive.startsWith("#")) {
        expect(after.includes(distinctive)).toBe(false);
      }
      checked++;
    }

    // Guard against the enumeration silently collapsing to nothing.
    expect(checked).toBeGreaterThan(20);
    expect(refusedBoth).toBeGreaterThan(0);
  });

  test("a section with children refuses the read, with both options named", () => {
    // The exact case that made this feature necessary, and the one where a
    // read that guessed would be most damaging.
    expect(() => extractSection(DOCS.nested, "## Parent")).toThrow(AmbiguousPositionError);
    try {
      extractSection(DOCS.nested, "## Parent");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("own_body");
      expect(msg).toContain("subtree");
    }
  });

  test("own_body and subtree really differ, so choosing silently would be wrong", () => {
    const own = extractSection(DOCS.nested, "## Parent", "own_body").text;
    const sub = extractSection(DOCS.nested, "## Parent", "subtree").text;
    expect(own).not.toBe(sub);
    expect(own).toContain("parent body");
    expect(own).not.toContain("child body");
    expect(sub).toContain("child body");
  });

  test("the last section owns everything to EOF", () => {
    // The addressing rule behind #196: a trailing insert becomes part of the
    // last section, so the read must show it.
    const withAppend = DOCS.lastSection + "\nappended later\n";
    expect(extractSection(withAppend, "## Only").text).toContain("appended later");
  });

  test("a heading inside a fenced block is not a section boundary", () => {
    const text = extractSection(DOCS.fenced, "## Code").text;
    expect(text).toContain("## Not A Heading");
    expect(text).toContain("tail");
    expect(text).not.toContain("real body");
  });

  test("the heading is returned as context, not as replaceable content", () => {
    // replace_section keeps the heading, so it must not be inside `text`.
    const r = extractSection(DOCS.flat, "## A");
    expect(r.heading).toBe("## A");
    expect(r.text).not.toContain("## A");
    expect(r.text).toContain("a body");
    expect(r.chars).toBe(r.text.length);
  });

  test("anchor rules match the write path: bare heading, then path", () => {
    const bare = extractSection(DOCS.flat, "## A").text;
    const viaPath = extractSection(DOCS.flat, "# Root > ## A").text;
    expect(bare).toBe(viaPath);
  });
});
