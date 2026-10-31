/**
 * Word and PDF export (markdown → .docx / pdfmake definition), no browser.
 *
 * The Word side is checked by unzipping the generated file and reading Word's
 * own XML, so a mapping that silently drops content fails here, not in Word.
 */

import { describe, expect, test } from "bun:test";
import { Packer } from "docx";
import JSZip from "jszip";

import { markdownToDocxDocument } from "./docx";
import { exportableUrl, withExtension } from "./markdown";
import { codeColumns, codeFont, markdownToPdf, markdownToPdfDefinition, wrapCode } from "./pdf";

const SAMPLE = `# Title

Intro with **bold**, *italic*, ~~gone~~, \`code\` and a [link](https://example.com).

## Lists

- one
- two
  - nested
- [x] done
- [ ] todo

1. first
2. second

Then:

5. five
6. six

> quoted text

\`\`\`ts
const x = 1;
  indented();
\`\`\`

| Name | Count |
|:-----|------:|
| a    | 1     |

---

Unsafe [js](javascript:alert(1)) and [relative](/api/v1/documents/x) links.

Γειά σου κόσμε.
`;

async function documentXml(markdown: string): Promise<string> {
  const buffer = await Packer.toBuffer(markdownToDocxDocument(markdown, "Sample"));
  const zip = await JSZip.loadAsync(buffer);
  return zip.file("word/document.xml")!.async("string");
}

describe("helpers", () => {
  test("only absolute web and mail links survive an export", () => {
    expect(exportableUrl("https://example.com")).toBe("https://example.com");
    expect(exportableUrl("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(exportableUrl("javascript:alert(1)")).toBeNull();
    expect(exportableUrl("/api/v1/documents/x")).toBeNull();
    expect(exportableUrl("#section")).toBeNull();
  });

  test("withExtension swaps .md, keeps other names", () => {
    expect(withExtension("notes.md", "docx")).toBe("notes.docx");
    expect(withExtension("My Doc v2 - 2026-10-30.md", "pdf")).toBe("My Doc v2 - 2026-10-30.pdf");
    expect(withExtension("README", "pdf")).toBe("README.pdf");
    expect(withExtension(".md", "pdf")).toBe("document.pdf");
  });
});

describe("Word export", () => {
  test("every piece of text lands in the document", async () => {
    const xml = await documentXml(SAMPLE);
    for (const text of ["Title", "bold", "italic", "gone", "code", "link", "nested", "done", "todo", "quoted text",
      "const x = 1;", "indented();", "Name", "Count", "Γειά σου κόσμε."]) {
      expect(xml).toContain(text);
    }
  });

  test("headings are Word headings, lists are Word lists, the table is a table", async () => {
    const xml = await documentXml(SAMPLE);
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('w:val="Heading2"');
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("<w:strike/>");
  });

  test("a list starting at 5 is numbered from 5", async () => {
    const xml = await documentXml(SAMPLE);
    expect(xml).toContain("5. ");
    expect(xml).toContain("6. ");
  });

  test("code keeps its leading spaces", async () => {
    const xml = await documentXml(SAMPLE);
    expect(xml).toMatch(/xml:space="preserve">\s{2}indented\(\);/);
  });

  test("unsafe and relative links lose their target, keep their text", async () => {
    const buffer = await Packer.toBuffer(markdownToDocxDocument(SAMPLE, "Sample"));
    const zip = await JSZip.loadAsync(buffer);
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain("https://example.com");
    expect(rels).not.toContain("javascript:");
    expect(rels).not.toContain("/api/v1/");
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain(">js<");
    expect(xml).toContain(">relative<");
  });

  test("an empty document still produces a valid file", async () => {
    expect((await documentXml("")).length).toBeGreaterThan(0);
  });
});

describe("PDF definition", () => {
  const def = markdownToPdfDefinition(SAMPLE, "Sample");
  const json = JSON.stringify(def);

  test("title in the metadata, every piece of text in the content", () => {
    expect(def.info?.title).toBe("Sample");
    for (const text of ["Title", "bold", "nested", "quoted text", "indented();", "Count", "Γειά σου κόσμε."]) {
      expect(json).toContain(text);
    }
  });

  test("structure: heading styles, native lists with their start, a table, task markers", () => {
    expect(json).toContain('"style":"h1"');
    expect(json).toContain('"style":"h2"');
    expect(json).toContain('"ul"');
    expect(json).toContain('"ol"');
    expect(json).toContain('"start":5');
    expect(json).toContain('"headerRows":1');
    expect(json).toContain("[x] ");
    expect(json).toContain("[ ] ");
  });

  test("only the safe link keeps a target", () => {
    expect(json).toContain('"link":"https://example.com"');
    expect(json).not.toContain("javascript:");
    expect(json).not.toContain('"link":"/api');
  });

  test("a soft line break inside a paragraph is a space", () => {
    expect(JSON.stringify(markdownToPdfDefinition("one\ntwo", "x"))).toContain("one two");
  });

  test("code is Courier when it fits Latin-1, Roboto otherwise", () => {
    expect(codeFont("docker run --name x \\\n  -p 8000:8000")).toEqual({ font: "Courier" });
    expect(codeFont("café")).toEqual({ font: "Courier" });
    expect(codeFont("a → b")).toEqual({});
    expect(codeFont("// Γειά")).toEqual({});
  });

  test("an empty document still has content", () => {
    expect(markdownToPdfDefinition("", "x").content).toEqual([{ text: "" }]);
  });
});

describe("PDF file", () => {
  test("pdfmake renders the sample into a real PDF", async () => {
    const blob = await markdownToPdf(SAMPLE, "Sample");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(5_000);
  });
});

// Codex review of #349: each case below lost content before its fix.
describe("content that must survive both exports", () => {
  const TRICKY = `See [the ref][r] and ![REF ALT][img].

[![LINKED ALT](https://example.org/i.png)](https://example.org)

Body[^h].

[^h]:
    # FOOTHEAD

    footnote tail

\`\`\`
${"X".repeat(300)}TAIL
\`\`\`

[r]: https://ref.example/page
[img]: https://ref.example/i.png
`;

  test("Word: reference link keeps its target, reference and linked images their alt", async () => {
    const buffer = await Packer.toBuffer(markdownToDocxDocument(TRICKY, "T"));
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain("https://ref.example/page");
    expect(xml).toContain("the ref");
    expect(xml).toContain("REF ALT");
    expect(xml).toContain("LINKED ALT");
  });

  test("Word: a footnote whose first block is not a paragraph keeps it", async () => {
    const xml = await documentXml(TRICKY);
    expect(xml).toContain("FOOTHEAD");
    expect(xml).toContain("footnote tail");
  });

  test("PDF: references resolved, alt kept, long code wrapped with nothing lost", () => {
    const def = markdownToPdfDefinition(TRICKY, "T");
    const json = JSON.stringify(def);
    expect(json).toContain('"link":"https://ref.example/page"');
    expect(json).toContain("REF ALT");
    expect(json).toContain("LINKED ALT");
    expect(json).toContain("FOOTHEAD");
    const code = /"text":"(X+[^"]*TAIL)"/.exec(json)?.[1] ?? "";
    const lines = code.split("\\n");
    expect(lines.every((l) => l.length <= 90)).toBe(true);
    expect(lines.join("")).toBe(`${"X".repeat(300)}TAIL`);
  });

  test("wrapCode wraps only lines past the width, by characters not code units", () => {
    expect(wrapCode("short\nline", 10)).toBe("short\nline");
    expect(wrapCode("abcdefghij", 4)).toBe("abcd\nefgh\nij");
    expect(wrapCode("😀😀😀", 2)).toBe("😀😀\n😀");
  });
});

// Codex round 2 of #349.
describe("round 2", () => {
  test("the first of two definitions for a label wins, as in CommonMark", () => {
    const json = JSON.stringify(
      markdownToPdfDefinition("[go][r]\n\n[r]: https://first.example\n[r]: https://second.example\n", "x"),
    );
    expect(json).toContain("https://first.example");
    expect(json).not.toContain("https://second.example");
  });

  test("code inside nested quotes and lists wraps to the narrower width", () => {
    const deep = `${"> ".repeat(6)}\`\`\`\n${"> ".repeat(6)}${"X".repeat(300)}\n${"> ".repeat(6)}\`\`\``;
    const json = JSON.stringify(markdownToPdfDefinition(deep, "x"));
    const code = /"text":"(X[X\\n]*)"/.exec(json)?.[1] ?? "";
    const lines = code.split("\\n");
    expect(lines.join("")).toBe("X".repeat(300));
    expect(Math.max(...lines.map((l) => l.length))).toBe(codeColumns("X", 6 * 16));
    expect(codeColumns("X", 6 * 16)).toBeLessThan(codeColumns("X", 0));
    expect(codeColumns("Γ", 0)).toBeLessThan(codeColumns("X", 0));
  });
});
