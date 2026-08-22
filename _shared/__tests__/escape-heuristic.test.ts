/**
 * The #222 escaped-content heuristic. Calibrated on real forensic data:
 * corrupted documents ran 50–70% literals-to-real-newlines; legitimate
 * documents that DISCUSS escaping sit far below 1%. The test names encode
 * the contract: warn on the corruption profile, stay quiet on legitimate
 * escaping, never block anything (the helper only returns a string).
 */

import { describe, expect, test } from "bun:test";

import { escapedContentNote, measureEscapes } from "../mcp-tools/escape-heuristic.ts";

describe("measureEscapes", () => {
  test("counts literal \\n, literal \\\" and real newlines independently", () => {
    const m = measureEscapes('a\\nb\\nc\\"d\ne\nf');
    expect(m).toEqual({ literalNewlines: 2, literalQuotes: 1, realNewlines: 2 });
  });
});

describe("escapedContentNote", () => {
  test("clean multi-line content: quiet", () => {
    expect(escapedContentNote("# T\n\nline\n\nline\n")).toBeNull();
  });

  test("the observed corruption profile warns (literals rival real newlines)", () => {
    // 14 literals vs 20 real — the actual worst case from the incident.
    const content = "# T\n" + "real line\n".repeat(19) + 'x\\n'.repeat(14);
    expect(escapedContentNote(content)).toContain("14 literal \\n");
  });

  test("legitimate escaping documentation stays quiet (ratio, not count)", () => {
    // 6 literals among 1500+ real newlines — the bundled-guides profile.
    const content = "line\n".repeat(1569) + 'the E"\\n\\n"-join uses \\n\\n literals \\n \\n';
    expect(escapedContentNote(content)).toBeNull();
  });

  test("literal quotes count toward the signal", () => {
    const content = 'He said \\"yes\\" and \\"no\\" twice\nend\n';
    expect(escapedContentNote(content)).toContain('literal \\"');
  });

  test("below the floor (fewer than 3 literals): quiet even with few newlines", () => {
    expect(escapedContentNote("short\\nnote")).toBeNull();
  });

  test("fully collapsed single-line corruption warns", () => {
    const content = "# Title\\n\\nBody paragraph one.\\n\\nBody two.";
    const note = escapedContentNote(content)!;
    expect(note).toContain("4 literal \\n");
    expect(note).toContain("0 real newline");
  });
});
