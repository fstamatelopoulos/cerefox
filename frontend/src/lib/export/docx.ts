/**
 * Markdown → Word (.docx), in the browser.
 *
 * Loaded on demand (`api/documents.ts` imports it dynamically), so the `docx`
 * library is not part of the app's first load. It maps the GFM syntax tree onto
 * Word's own structures: real headings (so the navigation pane and a table of
 * contents work), real lists, real tables, monospace code with shading.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import type { List, ListItem, PhrasingContent, RootContent, Table as MdTable } from "mdast";

import { exportableUrl, parseMarkdown } from "./markdown";

// Present on Windows, macOS and every Office install, unlike Consolas.
const MONO = "Courier New";
const CODE_FILL = "F2F2F2";
const ORDERED = "cfx-ordered";
const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6,
];

interface Marks {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  /** A character style, e.g. "Hyperlink" for runs inside a link. */
  style?: string;
}

interface Block {
  /** Nesting depth inside lists (0 at the top). */
  listLevel: number;
  /** Inside a blockquote: indented, with a bar on the left. */
  quote: boolean;
}

/** One numbering instance per ordered list, so each list restarts at 1. */
class Numbering {
  private next = 1;
  take(): number {
    return this.next++;
  }
}

function inline(nodes: PhrasingContent[], marks: Marks = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        // A newline inside a paragraph is a soft break: a space, not a new line.
        out.push(new TextRun({ text: node.value.replace(/\n/g, " "), ...marks }));
        break;
      case "strong":
        out.push(...inline(node.children, { ...marks, bold: true }));
        break;
      case "emphasis":
        out.push(...inline(node.children, { ...marks, italics: true }));
        break;
      case "delete":
        out.push(...inline(node.children, { ...marks, strike: true }));
        break;
      case "inlineCode":
        out.push(
          new TextRun({
            text: node.value,
            ...marks,
            font: MONO,
            shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: "auto" },
          }),
        );
        break;
      case "break":
        out.push(new TextRun({ break: 1 }));
        break;
      case "link": {
        const url = exportableUrl(node.url);
        if (url) {
          // The rendered runs, not a flattened string: an image inside the
          // link keeps its "[image: alt]" text.
          const runs = inline(node.children, { ...marks, style: "Hyperlink" });
          out.push(
            new ExternalHyperlink({
              link: url,
              children: runs.length ? runs : [new TextRun({ text: url, ...marks, style: "Hyperlink" })],
            }),
          );
        } else {
          out.push(...inline(node.children, marks));
        }
        break;
      }
      case "image":
        out.push(new TextRun({ text: `[image${node.alt ? `: ${node.alt}` : ""}]`, ...marks, italics: true }));
        break;
      case "html":
        out.push(new TextRun({ text: node.value, ...marks }));
        break;
      case "footnoteReference":
        out.push(new TextRun({ text: `[^${node.identifier}]`, ...marks, superScript: true }));
        break;
      default:
        // References are resolved into links and images by parseMarkdown.
        if ("children" in node) out.push(...inline(node.children as PhrasingContent[], marks));
        else if ("value" in node) out.push(new TextRun({ text: String(node.value), ...marks }));
    }
  }
  return out;
}

/** Indentation for a paragraph inside a list item or a blockquote. */
function blockStyle(ctx: Block) {
  if (ctx.quote) {
    return {
      indent: { left: 360 + ctx.listLevel * 720 },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: "BBBBBB", space: 8 } },
    };
  }
  return ctx.listLevel > 0 ? { indent: { left: ctx.listLevel * 720 } } : {};
}

function blocks(nodes: RootContent[], ctx: Block, numbering: Numbering): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        out.push(new Paragraph({ heading: HEADINGS[node.depth - 1], children: inline(node.children) }));
        break;
      case "paragraph":
        out.push(new Paragraph({ children: inline(node.children), ...blockStyle(ctx) }));
        break;
      case "blockquote":
        out.push(...blocks(node.children, { ...ctx, quote: true }, numbering));
        break;
      case "code": {
        const lines = node.value.split("\n");
        out.push(
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: CODE_FILL, color: "auto" },
            spacing: { before: 60, after: 120 },
            children: lines.map(
              (line, i) => new TextRun({ text: line, font: MONO, size: 19, break: i > 0 ? 1 : undefined }),
            ),
          }),
        );
        break;
      }
      case "list":
        out.push(...list(node, ctx, numbering));
        break;
      case "table":
        out.push(table(node));
        break;
      case "thematicBreak":
        out.push(
          new Paragraph({
            children: [],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } },
          }),
        );
        break;
      case "html":
        out.push(new Paragraph({ children: [new TextRun({ text: node.value, font: MONO })] }));
        break;
      case "footnoteDefinition": {
        // The label joins the first paragraph; any other first block (a
        // heading, code) gets the label on a line of its own and stays whole.
        const label = new TextRun({ text: `[^${node.identifier}] `, superScript: true });
        const [first, ...rest] = node.children;
        if (first && first.type === "paragraph") {
          out.push(new Paragraph({ children: [label, ...inline(first.children)] }), ...blocks(rest, ctx, numbering));
        } else {
          out.push(new Paragraph({ children: [label] }), ...blocks(node.children, ctx, numbering));
        }
        break;
      }
      default:
        // definition, yaml and the like: nothing to show.
        break;
    }
  }
  return out;
}

function list(node: List, ctx: Block, numbering: Numbering): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  const level = Math.min(ctx.listLevel, 8);
  // Word numbering restarts per instance; a list that starts elsewhere than 1
  // gets its numbers written out instead.
  const instance = node.ordered && (node.start ?? 1) === 1 ? numbering.take() : null;
  node.children.forEach((item: ListItem, index) => {
    const [first, ...rest] = item.children;
    const marker =
      item.checked === true ? "☒ " : item.checked === false ? "☐ " : "";
    const manual = node.ordered && instance === null ? `${(node.start ?? 1) + index}. ` : "";
    const lead = manual || marker ? [new TextRun({ text: manual + marker })] : [];
    const bulletOrNumber = !node.ordered
      ? { bullet: { level } }
      : instance !== null
        ? { numbering: { reference: ORDERED, level, instance } }
        : { indent: { left: 360 * (level + 1) } };
    if (first && first.type === "paragraph") {
      out.push(new Paragraph({ ...bulletOrNumber, children: [...lead, ...inline(first.children)] }));
    } else {
      out.push(new Paragraph({ ...bulletOrNumber, children: lead }));
      if (first) out.push(...blocks([first], { ...ctx, listLevel: ctx.listLevel + 1 }, numbering));
    }
    out.push(...blocks(rest, { ...ctx, listLevel: ctx.listLevel + 1 }, numbering));
  });
  return out;
}

function table(node: MdTable): Table {
  const align = node.align ?? [];
  const alignment = (i: number) =>
    align[i] === "center" ? AlignmentType.CENTER : align[i] === "right" ? AlignmentType.RIGHT : AlignmentType.LEFT;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: node.children.map(
      (row, r) =>
        new TableRow({
          tableHeader: r === 0,
          children: row.children.map(
            (cell, i) =>
              new TableCell({
                shading: r === 0 ? { type: ShadingType.CLEAR, fill: "EDEDED", color: "auto" } : undefined,
                children: [
                  new Paragraph({
                    alignment: alignment(i),
                    children: inline(cell.children, r === 0 ? { bold: true } : {}),
                  }),
                ],
              }),
          ),
        }),
    ),
  });
}

export function markdownToDocxDocument(markdown: string, title: string): Document {
  const numbering = new Numbering();
  const children = blocks(parseMarkdown(markdown).children, { listLevel: 0, quote: false }, numbering);
  return new Document({
    title,
    creator: "Cerefox",
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } } },
    },
    numbering: {
      config: [
        {
          reference: ORDERED,
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
          })),
        },
      ],
    },
    sections: [{ children: children.length ? children : [new Paragraph({ children: [] })] }],
  });
}

export function markdownToDocx(markdown: string, title: string): Promise<Blob> {
  return Packer.toBlob(markdownToDocxDocument(markdown, title));
}
