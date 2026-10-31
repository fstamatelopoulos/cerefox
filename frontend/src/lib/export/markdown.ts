/**
 * Markdown → syntax tree, shared by the Word and PDF exports.
 *
 * The same parser family the page renders with (react-markdown + remark-gfm),
 * so a document exports with the structure it shows: GFM tables, task lists,
 * strikethrough, autolinks. Raw HTML is kept as text, never interpreted.
 */

import type { Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

export function parseMarkdown(markdown: string): Root {
  const root = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  resolveReferences(root);
  return root;
}

/**
 * Turn reference-style links and images (`[text][id]`, `![alt][id]` with a
 * `[id]: url` definition elsewhere) into plain links and images, so the
 * converters handle one form and neither the target nor the alt text is lost.
 */
function resolveReferences(root: Root): void {
  const urls = new Map<string, string>();
  const collect = (node: Nodes) => {
    if (node.type === "definition") urls.set(node.identifier.toLowerCase(), node.url);
    if ("children" in node) for (const child of node.children) collect(child);
  };
  collect(root);

  const rewrite = (node: Nodes) => {
    if (!("children" in node)) return;
    const children = node.children as Nodes[];
    children.forEach((child, i) => {
      if (child.type === "linkReference") {
        children[i] = { type: "link", url: urls.get(child.identifier.toLowerCase()) ?? "", children: child.children };
      } else if (child.type === "imageReference") {
        children[i] = { type: "image", url: urls.get(child.identifier.toLowerCase()) ?? "", alt: child.alt };
      }
      rewrite(children[i]);
    });
  };
  rewrite(root);
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
