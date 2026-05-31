import { describe, expect, test } from "bun:test";

import { fileToMarkdown, needsConversion } from "../src/ingestion/file-to-markdown.ts";

describe("fileToMarkdown", () => {
  const md = "# Title\n\nbody text\n";

  test(".md / .txt / .markdown / no-extension pass through as UTF-8", async () => {
    expect(await fileToMarkdown("notes.md", Buffer.from(md))).toBe(md);
    expect(await fileToMarkdown("notes.txt", Buffer.from(md))).toBe(md);
    expect(await fileToMarkdown("notes.markdown", Buffer.from(md))).toBe(md);
    expect(await fileToMarkdown("README", Buffer.from(md))).toBe(md);
    // Case-insensitive on extension.
    expect(await fileToMarkdown("NOTES.MD", Buffer.from(md))).toBe(md);
  });

  test("PDF is rejected with a convert-upstream message", async () => {
    await expect(fileToMarkdown("doc.pdf", Buffer.from("%PDF-1.4"))).rejects.toThrow(
      /PDF ingestion isn't supported/,
    );
  });

  test("legacy .doc is rejected, pointing at .docx", async () => {
    await expect(fileToMarkdown("old.doc", Buffer.from("x"))).rejects.toThrow(/\.docx/);
  });

  test("needsConversion is true only for .docx", () => {
    expect(needsConversion("report.docx")).toBe(true);
    expect(needsConversion("report.DOCX")).toBe(true);
    expect(needsConversion("notes.md")).toBe(false);
    expect(needsConversion("scan.pdf")).toBe(false);
  });
});
