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
import { codeFont, markdownToPdf, markdownToPdfDefinition } from "./pdf";

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
