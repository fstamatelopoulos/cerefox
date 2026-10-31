/**
 * Markdown → syntax tree, shared by the Word and PDF exports.
 *
 * The same parser family the page renders with (react-markdown + remark-gfm),
 * so a document exports with the structure it shows: GFM tables, task lists,
 * strikethrough, autolinks. Raw HTML is kept as text, never interpreted.
 */

import type { Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export function parseMarkdown(markdown: string): Root {
  return fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

/**
 * The link targets an export may keep: absolute web and mail links. A relative
 * link (an `/api/v1/…` path, a `#anchor`) points at nothing once the file
 * leaves this server, and a `javascript:` link has no business in a document.
 */
export function exportableUrl(url: string): string | null {
  return /^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : null;
}

/** `notes.md` → `notes.docx`; a name with no extension gets one. */
export function withExtension(filename: string, ext: string): string {
  const stem = filename.replace(/\.(md|markdown|txt)$/i, "");
  return `${stem || "document"}.${ext}`;
}
