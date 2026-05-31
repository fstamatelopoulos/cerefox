/**
 * Convert a supported upload to Markdown for ingestion — used by the **CLI**
 * (`cerefox document ingest <file>`) and the **web upload** path only.
 *
 * The MCP path deliberately does NOT use this: agents read documents and ingest
 * the extracted Markdown themselves, so conversion is purely a human convenience
 * for "I have a file on disk, ingest it for me."
 *
 * Supported inputs:
 *   - `.md` / `.markdown` / `.txt` / no extension → decoded as UTF-8 text.
 *   - `.docx` → converted via `mammoth` (Word heading styles → Markdown headings),
 *     so the result chunks well under Cerefox's heading-aware splitter.
 *
 * Rejected (with a pointer to convert upstream):
 *   - `.pdf` → PDF is a layout format; text extraction loses the heading
 *     structure Cerefox relies on. Convert to Markdown first, then ingest the .md.
 *   - legacy `.doc` → save as `.docx` first.
 */

import { extname } from "node:path";

import mammoth from "mammoth";

/** Extensions that need binary conversion rather than a UTF-8 decode. */
export function needsConversion(filename: string): boolean {
  return extname(filename).toLowerCase() === ".docx";
}

/**
 * Strip mammoth's empty HTML bookmark anchors (`<a id="_xxx"></a>`) that it
 * emits before each heading from Word's internal bookmark ids. They're noise
 * and would otherwise leak into the chunk `heading_path` (and the title-boost
 * FTS weight). Real links survive — mammoth renders those as Markdown links,
 * not bare `<a id>` tags.
 */
export function stripDocxAnchors(markdown: string): string {
  return markdown.replace(/<a id="[^"]*"\s*><\/a>/g, "");
}

/** Convert a file's bytes to Markdown based on its extension. Throws a
 *  user-facing error for unsupported formats (PDF, legacy .doc). */
export async function fileToMarkdown(filename: string, data: Buffer): Promise<string> {
  const ext = extname(filename).toLowerCase();

  if (ext === ".docx") {
    const { value } = await mammoth.convertToMarkdown({ buffer: data });
    const markdown = stripDocxAnchors(value);
    if (markdown.trim() === "") {
      throw new Error(
        `Converted "${filename}" to empty Markdown — the .docx may be image-only or use no recognizable text styles.`,
      );
    }
    return markdown;
  }

  if (ext === ".pdf") {
    throw new Error(
      "PDF ingestion isn't supported. Convert it to Markdown first (e.g. with pandoc or your editor), " +
        "then ingest the .md — PDF text extraction loses the heading structure Cerefox relies on.",
    );
  }

  if (ext === ".doc") {
    throw new Error('Legacy ".doc" isn\'t supported — save it as ".docx" (or convert to Markdown), then ingest.');
  }

  // .md / .markdown / .txt / no extension → plain UTF-8 text.
  return data.toString("utf8");
}
