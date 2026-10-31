/**
 * Markdown → PDF, in the browser, with pdfmake.
 *
 * Loaded on demand (`api/documents.ts` imports it dynamically): pdfmake and its
 * embedded Roboto font are about 2 MB, which the app does not pay on first
 * load. The definition builder ({@link markdownToPdfDefinition}) is a pure
 * function, tested without a browser; only {@link markdownToPdf} needs pdfmake.
 *
 * Roboto covers Latin, Greek and Cyrillic. Characters outside it (CJK, emoji)
 * print as blanks: the Word export keeps them, since Word picks its own fonts.
 * Code is set in Courier, one of the PDF standard fonts (nothing embedded),
 * when it fits Courier's Latin-1 range; anything else stays in Roboto, so a
 * Greek comment or an arrow in a code block still prints.
 */

import type { Content, ContentText, TDocumentDefinitions } from "pdfmake/interfaces";
import type { List, PhrasingContent, RootContent, Table as MdTable } from "mdast";

import { exportableUrl, parseMarkdown } from "./markdown";

const CODE_FILL = "#f2f2f2";

/**
 * Hard-wrap code lines that cannot fit the page. pdfmake breaks lines only at
 * spaces, so a long unbroken token (a hash, a URL, minified code) ran off the
 * page and was clipped. The width is the code block's: 90 Courier columns at
 * 9 pt, and a conservative 64 for proportional Roboto.
 */
export function wrapCode(text: string, columns: number): string {
  return text
    .split("\n")
    .map((line) => {
      const chars = Array.from(line);
      if (chars.length <= columns) return line;
      const parts: string[] = [];
      for (let i = 0; i < chars.length; i += columns) parts.push(chars.slice(i, i + columns).join(""));
      return parts.join("\n");
    })
    .join("\n");
}

/** Courier when every character is in its Latin-1 range; otherwise Roboto. */
export function codeFont(text: string): { font?: string } {
  return /^[\t\n\r\x20-\x7e\xa0-\xff]*$/.test(text) ? { font: "Courier" } : {};
}
const RULE = "#bbbbbb";

interface Marks {
  bold?: boolean;
  italics?: boolean;
  decoration?: "lineThrough";
}

type Inline = string | ContentText;

function inline(nodes: PhrasingContent[], marks: Marks = {}): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        // A newline inside a paragraph is a soft break: a space, not a new line.
        out.push({ text: node.value.replace(/\n/g, " "), ...marks });
        break;
      case "strong":
        out.push(...inline(node.children, { ...marks, bold: true }));
        break;
      case "emphasis":
        out.push(...inline(node.children, { ...marks, italics: true }));
        break;
      case "delete":
        out.push(...inline(node.children, { ...marks, decoration: "lineThrough" }));
        break;
      case "inlineCode":
        out.push({ text: node.value, ...marks, ...codeFont(node.value), background: CODE_FILL, fontSize: 9.5, preserveLeadingSpaces: true });
        break;
      case "break":
        out.push({ text: "\n" });
        break;
      case "link": {
        const url = exportableUrl(node.url);
        const children = inline(node.children, marks);
        if (url) {
          out.push({ text: children.length ? children : url, link: url, color: "#1a5fb4", decoration: "underline" });
        } else {
          out.push(...children);
        }
        break;
      }
      case "image":
        out.push({ text: `[image${node.alt ? `: ${node.alt}` : ""}]`, ...marks, italics: true });
        break;
      case "html":
        out.push({ text: node.value, ...marks });
        break;
      case "footnoteReference":
        out.push({ text: `[^${node.identifier}]`, ...marks, sup: true });
        break;
      default:
        if ("children" in node) out.push(...inline(node.children as PhrasingContent[], marks));
        else if ("value" in node) out.push({ text: String(node.value), ...marks });
    }
  }
  return out;
}

function blocks(nodes: RootContent[]): Content[] {
  const out: Content[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        out.push({ text: inline(node.children), style: `h${node.depth}` });
        break;
      case "paragraph":
        out.push({ text: inline(node.children), style: "p" });
        break;
      case "blockquote":
        out.push({
          table: { widths: ["*"], body: [[{ stack: blocks(node.children), italics: true, color: "#555555" }]] },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: (i: number) => (i === 0 ? 2 : 0),
            vLineColor: () => RULE,
            paddingLeft: () => 10,
          },
          margin: [0, 2, 0, 8],
        });
        break;
      case "code":
        out.push({
          table: {
            widths: ["*"],
            body: [
              [
                {
                  text: wrapCode(node.value, codeFont(node.value).font ? 90 : 64),
                  ...codeFont(node.value),
                  fontSize: 9,
                  preserveLeadingSpaces: true,
                  lineHeight: 1.3,
                },
              ],
            ],
          },
          layout: {
            hLineWidth: () => 0,
            vLineWidth: () => 0,
            fillColor: () => CODE_FILL,
            paddingLeft: () => 8,
            paddingRight: () => 8,
            paddingTop: () => 6,
            paddingBottom: () => 6,
          },
          margin: [0, 2, 0, 8],
        });
        break;
      case "list":
        out.push(list(node));
        break;
      case "table":
        out.push(table(node));
        break;
      case "thematicBreak":
        out.push({
          canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: RULE }],
          margin: [0, 6, 0, 10],
        });
        break;
      case "html":
        out.push({ text: node.value, style: "p", fontSize: 9, preserveLeadingSpaces: true });
        break;
      case "footnoteDefinition":
        out.push({ stack: [{ text: `[^${node.identifier}]`, sup: true }, ...blocks(node.children)], fontSize: 9 });
        break;
      default:
        break;
    }
  }
  return out;
}

function list(node: List): Content {
  const items: Content[] = node.children.map((item) => {
    const marker = item.checked === true ? "[x] " : item.checked === false ? "[ ] " : "";
    const [first, ...rest] = item.children;
    const head: Content =
      first && first.type === "paragraph"
        ? { text: [marker, ...inline(first.children)], margin: [0, 0, 0, 2] }
        : { text: marker };
    const tail = first && first.type === "paragraph" ? blocks(rest) : blocks(item.children);
    return tail.length ? { stack: [head, ...tail] } : head;
  });
  return node.ordered
    ? { ol: items, start: node.start ?? 1, margin: [0, 0, 0, 8] }
    : { ul: items, margin: [0, 0, 0, 8] };
}

function table(node: MdTable): Content {
  const columns = Math.max(1, ...node.children.map((row) => row.children.length));
  const align = node.align ?? [];
  const alignment = (i: number) => (align[i] === "center" ? "center" : align[i] === "right" ? "right" : "left");
  return {
    table: {
      headerRows: 1,
      widths: Array.from({ length: columns }, () => "*"),
      body: node.children.map((row, r) =>
        Array.from({ length: columns }, (_, i) => {
          const cell = row.children[i];
          return {
            text: cell ? inline(cell.children, r === 0 ? { bold: true } : {}) : "",
            alignment: alignment(i),
            fillColor: r === 0 ? "#ededed" : undefined,
          };
        }),
      ),
    },
    layout: "lightHorizontalLines",
    margin: [0, 2, 0, 10],
  };
}

export function markdownToPdfDefinition(markdown: string, title: string): TDocumentDefinitions {
  const content = blocks(parseMarkdown(markdown).children);
  return {
    info: { title, creator: "Cerefox", producer: "Cerefox" },
    pageSize: "A4",
    pageMargins: [40, 48, 40, 48],
    content: content.length ? content : [{ text: "" }],
    defaultStyle: { font: "Roboto", fontSize: 10.5, lineHeight: 1.25 },
    styles: {
      p: { margin: [0, 0, 0, 7] },
      h1: { fontSize: 20, bold: true, margin: [0, 10, 0, 8] },
      h2: { fontSize: 16, bold: true, margin: [0, 10, 0, 6] },
      h3: { fontSize: 13.5, bold: true, margin: [0, 8, 0, 5] },
      h4: { fontSize: 12, bold: true, margin: [0, 6, 0, 4] },
      h5: { fontSize: 11, bold: true, margin: [0, 6, 0, 4] },
      h6: { fontSize: 10.5, bold: true, italics: true, margin: [0, 6, 0, 4] },
    },
    footer: (page: number, pages: number) => ({
      text: `${page} / ${pages}`,
      alignment: "center",
      fontSize: 8,
      color: "#888888",
      margin: [0, 16, 0, 0],
    }),
  };
}

export async function markdownToPdf(markdown: string, title: string): Promise<Blob> {
  const [{ default: pdfMake }, { default: vfs }, { default: courier }] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
    import("pdfmake/build/standard-fonts/Courier"),
  ]);
  pdfMake.addVirtualFileSystem(vfs);
  pdfMake.addFontContainer(courier);
  pdfMake.setFonts({
    Roboto: {
      normal: "Roboto-Regular.ttf",
      bold: "Roboto-Medium.ttf",
      italics: "Roboto-Italic.ttf",
      bolditalics: "Roboto-MediumItalic.ttf",
    },
    Courier: {
      normal: "Courier",
      bold: "Courier-Bold",
      italics: "Courier-Oblique",
      bolditalics: "Courier-BoldOblique",
    },
  });
  return pdfMake.createPdf(markdownToPdfDefinition(markdown, title)).getBlob();
}
