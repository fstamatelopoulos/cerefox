/**
 * Partial document edits — pure string layer (iteration 34).
 *
 * Implements the position/anchor semantics of
 * `docs/specs/partial-document-edits-design.md` §3 exactly. No I/O, no client,
 * no runtime dependencies: everything here is testable against strings alone
 * and runs identically under Deno (Edge Function) and Node/Bun (local MCP,
 * CLI). The handlers in `_shared/mcp-tools/{insert,edit}.ts` compose this with
 * read → chunk → embed → `cerefox_ingest_document`.
 *
 * The one rule that governs every function: **never guess**. An absent anchor
 * is an error, an ambiguous anchor is an error carrying the candidates that
 * resolve it, and an ambiguous position (a section with both its own body and
 * child headings) is an error carrying both concrete insertion points. A
 * silent wrong-location write is strictly worse than a refusal (spec §3.7).
 */

/** One section in document order. Offsets are into the parsed string. */
export interface OutlineNode {
  /** Full heading line, trimmed — e.g. `### Notes`. */
  heading: string;
  /** 1–6. */
  level: number;
  /** ` > `-joined ancestor headings + own — the §3.7 anchor path form. */
  path: string;
  /** Offset of the heading line's first character. */
  start: number;
  /** Offset just past the heading line (start of the section's own body). */
  bodyStart: number;
  /** End of the section's own body: before its first child heading (== subtreeEnd for leaves). */
  ownBodyEnd: number;
  /** Before the next heading of equal-or-higher level (end of the whole subtree). */
  subtreeEnd: number;
  /** subtreeEnd - start: the per-section size reported by outline mode. */
  chars: number;
}

export type InsertPosition =
  | "end_of_document"
  | "end_of_section"
  | "after_heading"
  | "before_heading";

export type SectionPart = "own_body" | "subtree";

export type EditOperation =
  | {
      op: "insert";
      text: string;
      position: InsertPosition;
      anchor_heading?: string;
      section_part?: SectionPart;
    }
  | {
      op: "replace_section";
      text: string;
      anchor_heading: string;
      section_part?: SectionPart;
    }
  | {
      op: "delete_section";
      anchor_heading: string;
      scope?: "body_only" | "heading_and_body";
      section_part?: SectionPart;
    }
  | {
      op: "rename_section";
      anchor_heading: string;
      new_heading: string;
    };

/** Echo of one applied operation, for audit labels and response text. */
export interface AppliedOperation {
  op: "insert" | "replace_section" | "delete_section" | "rename_section";
  /** Resolved anchor path (or "(document)" for end_of_document). */
  path: string;
  /** Human summary: position / scope / section_part actually used. */
  detail: string;
}

/** Anchor matched nothing. The write must never fall back to appending. */
export class AnchorNotFoundError extends Error {
  /** `reads` — see AmbiguousPositionError: a read never attempted a write. */
  constructor(anchor: string, outline: OutlineNode[], reads = false) {
    const known = outline.length
      ? ` Known headings:\n${outline.map((n) => `  ${n.path}`).join("\n")}`
      : " The document has no headings.";
    super(
      `Anchor not found: "${anchor}".${reads ? "" : " No write was performed."}${known}\n` +
        `Anchors match a heading line exactly ("## Title") or a parent path ` +
        `("## Parent > ### Child").`,
    );
    this.name = "AnchorNotFoundError";
  }
}

/** Anchor matched more than one section. Candidates resolve the retry. */
export class AmbiguousAnchorError extends Error {
  readonly candidates: string[];
  /** `reads` — see AmbiguousPositionError: a read never attempted a write. */
  constructor(anchor: string, candidates: string[], reads = false) {
    super(
      `Ambiguous anchor: "${anchor}" matches ${candidates.length} sections. ` +
        `${reads ? "" : "No write was performed. "}Disambiguate by passing one of these paths as anchor_heading:\n` +
        candidates.map((c) => `  ${c}`).join("\n"),
    );
    this.name = "AmbiguousAnchorError";
    this.candidates = candidates;
  }
}

/**
 * The anchored section has both its own body and child headings, so "the
 * section" has two defensible readings (spec §3.3). Never guessed.
 */
export class AmbiguousPositionError extends Error {
  readonly candidates: { section_part: SectionPart; description: string }[];
  /**
   * `reads` marks a caller that only inspects content (#198's section read).
   * The reassurance "No write was performed" is meant to stop an agent
   * retrying a half-applied batch — on a read it is noise at best, and at
   * worst it implies a write was attempted when none ever could be.
   */
  constructor(node: OutlineNode, firstChildHeading: string, opName: string, reads = false) {
    const candidates = [
      {
        section_part: "own_body" as const,
        description:
          `just this section's own content, stopping before its first child ` +
          `(${firstChildHeading}) — often only a line or two below the heading`,
      },
      {
        section_part: "subtree" as const,
        description:
          `the whole subtree, past everything nested under ${node.heading} — ` +
          `which can be a long way down`,
      },
    ];
    super(
      `Ambiguous position: "${node.path}" has child sections, so "the end of ` +
        `the section" could mean two different places and ${opName} will not guess. ` +
        `${reads ? "" : "No write was performed. "}Pass section_part to choose:\n` +
        candidates.map((c) => `  section_part: "${c.section_part}" — ${c.description}`).join("\n"),
    );
    this.name = "AmbiguousPositionError";
    this.candidates = candidates;
  }
}

/**
 * A rename asked to change the heading's LEVEL, not just its text.
 *
 * `## Q3 plan` → `### Q3 plan` re-parents everything under it: the section
 * stops being a sibling of its neighbours and becomes a child of whichever
 * section precedes it. That is a restructure with a different blast radius
 * from a rename, and doing it silently under the name "rename" is exactly the
 * kind of surprise this contract refuses (#197).
 */
export class HeadingLevelChangeError extends Error {
  constructor(fromHeading: string, toHeading: string) {
    const from = (fromHeading.match(/^#+/) ?? [""])[0].length;
    const to = (toHeading.match(/^#+/) ?? [""])[0].length;
    super(
      `rename_section changes heading TEXT, not depth: "${fromHeading}" is level ` +
        `${from} and "${toHeading}" is level ${to}. No write was performed. ` +
        `Changing the level would re-parent every section nested under it. ` +
        `Pass a level-${from} heading (${"#".repeat(from)} ...), or restructure ` +
        `explicitly with delete_section + insert if that is what you meant.`,
    );
    this.name = "HeadingLevelChangeError";
  }
}

/** Structural validation failure of an operations array (before any parsing). */
export class InvalidOperationError extends Error {
  constructor(index: number, message: string) {
    super(`Invalid operation at index ${index}: ${message}. No write was performed.`);
    this.name = "InvalidOperationError";
  }
}

const ATX_HEADING = /^(#{1,6})[ \t]+(.*[^ \t#]|)[ \t]*#*[ \t]*$/;
const FENCE_OPEN = /^([ \t]{0,3})(`{3,}|~{3,})(.*)$/;

/**
 * Parse the outline of a markdown document in one pass.
 *
 * ATX headings only (the chunker's convention). Headings inside fenced code
 * blocks are content, not structure: the scanner tracks the open fence's
 * marker character and length, and only a closing fence at least as long, of
 * the same character, closes it (CommonMark). A decision log quoting markdown
 * WILL contain `#` lines inside fences; treating those as headings would
 * corrupt every anchor computed after them.
 */
export function parseOutline(content: string): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  const stack: OutlineNode[] = []; // open ancestors, strictly increasing level
  let fence: { char: string; len: number } | null = null;

  let offset = 0;
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStart = offset;
    offset += line.length + (i < lines.length - 1 ? 1 : 0);

    const fenceMatch = line.match(FENCE_OPEN);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[2][0] === fence.char &&
        fenceMatch[2].length >= fence.len &&
        fenceMatch[3].trim() === ""
      ) {
        fence = null; // closing fence
      }
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[2][0], len: fenceMatch[2].length };
      continue;
    }

    const m = line.match(ATX_HEADING);
    if (!m) continue;

    const level = m[1].length;
    const bodyStart = lineStart + line.length + (i < lines.length - 1 ? 1 : 0);

    // Close every open section at >= this level.
    while (stack.length && stack[stack.length - 1].level >= level) {
      const closed = stack.pop()!;
      closed.subtreeEnd = lineStart;
      if (closed.ownBodyEnd === -1) closed.ownBodyEnd = lineStart;
    }
    // This heading is the first child of the innermost still-open ancestor.
    if (stack.length && stack[stack.length - 1].ownBodyEnd === -1) {
      stack[stack.length - 1].ownBodyEnd = lineStart;
    }

    // CommonMark treats a trailing run of #s as decoration, so `## Title ##`
    // and `## Title` name the same section. Store the canonical form: an agent
    // that read the rendered document addresses it as `## Title`, and one that
    // pasted an outline path gets the same string back (resolveAnchor
    // canonicalises the incoming anchor too).
    const heading = `${m[1]} ${m[2].trim()}`.trim();
    const node: OutlineNode = {
      heading,
      level,
      path: [...stack.map((a) => a.heading), heading].join(" > "),
      start: lineStart,
      bodyStart,
      ownBodyEnd: -1, // resolved when the first child or the subtree end is seen
      subtreeEnd: -1,
      chars: 0,
    };
    nodes.push(node);
    stack.push(node);
  }

  const end = content.length;
  for (const open of stack) {
    open.subtreeEnd = end;
    if (open.ownBodyEnd === -1) open.ownBodyEnd = end;
  }
  for (const n of nodes) n.chars = n.subtreeEnd - n.start;
  return nodes;
}

/**
 * Resolve an anchor per spec §3.7: exact heading text, or a ` > ` parent path.
 * 0 matches → AnchorNotFoundError; 2+ → AmbiguousAnchorError with the paths.
 */
/** `## Title ##` and `## Title` name the same section (CommonMark decoration). */
function canonicalHeading(text: string): string {
  const m = text.trim().match(/^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/);
  return m ? `${m[1]} ${m[2].trim()}`.trim() : text.trim();
}

export function resolveAnchor(
  outline: OutlineNode[],
  anchorHeading: string,
  reads = false,
): OutlineNode {
  const anchor = canonicalHeading(anchorHeading);

  // Try the LITERAL heading first, always — including when the anchor contains
  // the path separator. Headings really do contain " > " (`## Draft > Review`,
  // `## A > B`), and treating any such anchor as a path made those sections
  // unaddressable by their own text: the agent would read `## A > B` from the
  // outline, pass it back verbatim, and be told the anchor does not exist while
  // the error listed it. Literal-first also keeps the outline's promise that
  // what it prints can be pasted straight back.
  const byHeading = outline.filter((n) => n.heading === anchor);
  if (byHeading.length === 1) return byHeading[0];
  if (byHeading.length > 1) {
    throw new AmbiguousAnchorError(anchor, byHeading.map((n) => n.path), reads);
  }

  // No heading matched literally: interpret it as a parent path.
  if (anchor.includes(" > ")) {
    const normalizedPath = anchor.split(" > ").map((seg) => canonicalHeading(seg)).join(" > ");
    const byPath = outline.filter((n) => n.path === normalizedPath);
    if (byPath.length === 1) return byPath[0];
    if (byPath.length > 1) {
      throw new AmbiguousAnchorError(anchor, byPath.map((n) => n.path), reads);
    }
  }

  throw new AnchorNotFoundError(anchor, outline, reads);
}

/**
 * The text a `replace_section` would overwrite — resolved through the SAME
 * functions the write uses (#198).
 *
 * v1.3.0 shipped `replace_section` with no way to see what it was about to
 * destroy: outline mode reports a section's *size*, never its *text*, so the
 * only safe preparation was a full `get_document` — the cost partial edits
 * exist to remove. `cerefox_insert` is guarded structurally (it cannot remove
 * anything); the destructive operation was guarded only by
 * `expected_content_hash`, which protects against a *concurrent* writer, not
 * against a writer who does not know what it is deleting.
 *
 * The binding requirement is that `text` is EXACTLY the extent
 * `replace_section` targets under the same `section_part`. If a read could
 * differ from the write it feeds, the feature would be worse than its absence:
 * absence at least announces itself. That is why this shares `resolveAnchor`
 * and `resolveSectionEnd` rather than reproducing their rules — including the
 * refusal on a section with children, which is the case most likely to diverge.
 *
 * `heading` is returned separately because it is context, not content:
 * `replace_section` keeps the heading, so it is not part of what would be
 * overwritten.
 */
export function extractSection(
  content: string,
  anchorHeading: string,
  sectionPart?: SectionPart,
): {
  heading: string;
  path: string;
  level: number;
  text: string;
  chars: number;
  section_part: SectionPart | null;
} {
  const outline = parseOutline(content);
  const node = resolveAnchor(outline, anchorHeading, true);
  // Same op label the write would raise under, so an ambiguity refusal reads
  // the same whether the caller was reading or replacing.
  const to = resolveSectionEnd(content, outline, node, sectionPart, "the section read", true);
  const text = content.slice(node.bodyStart, to);
  return {
    heading: node.heading,
    path: node.path,
    level: node.level,
    text,
    chars: text.length,
    section_part: sectionPart ?? null,
  };
}

function firstChild(outline: OutlineNode[], node: OutlineNode): OutlineNode | null {
  for (const n of outline) {
    if (n.start >= node.bodyStart && n.start < node.subtreeEnd) return n;
  }
  return null;
}

/**
 * Resolve the [from, to) range a replace/delete targets, and the end offset an
 * end_of_section insert lands at. Spec §3.3 + the freeze-pass rule: leaf →
 * unambiguous; body+children → require section_part; children-without-body →
 * subtree (the two readings coincide in intent: "everything under it").
 */
function resolveSectionEnd(
  content: string,
  outline: OutlineNode[],
  node: OutlineNode,
  sectionPart: SectionPart | undefined,
  opName: string,
  reads = false,
): number {
  const child = firstChild(outline, node);
  if (!child) return node.subtreeEnd; // leaf: unambiguous
  if (sectionPart === "own_body") return node.ownBodyEnd;
  if (sectionPart === "subtree") return node.subtreeEnd;

  // A section with children is ambiguous, full stop — whether or not it has
  // any body of its own, and whichever operation is asking.
  //
  // Two earlier versions of this function were wrong here, in opposite ways.
  // The first returned subtreeEnd for every children-only section, so
  // `delete_section` on a grouping heading silently removed every sub-section
  // under it — with `scope: "body_only"`, whose whole promise is to keep the
  // structure. A review caught that and the destructive path started refusing.
  //
  // The insert path kept the exemption, on the reasoning that "for an insert
  // the two readings coincide, both landing at the section's terminus". That
  // reasoning was simply false, and an agent editing a real document found it:
  // for `## Parent` with children and no body of its own, `own_body` lands
  // BEFORE the first child and `subtree` lands AFTER the last one. Those are
  // different places — potentially pages apart — and the code was choosing
  // silently. The agent's text went to the end of a long section, and it only
  // discovered that by re-reading the document, which is the cost this feature
  // exists to remove.
  //
  // So: no exemption. `hasOwnBody` no longer gates anything, because the
  // presence of children is what makes "the end of this section" ambiguous.
  throw new AmbiguousPositionError(node, child.heading, opName, reads);
}

/**
 * Splice `text` into `content` as a markdown block: exactly one blank line
 * separates it from any non-empty neighbour, existing surrounding blank runs
 * collapse rather than stack. Agents send content; the join owns whitespace.
 */
function spliceBlock(content: string, from: number, to: number, text: string): string {
  const before = content.slice(0, from).replace(/\n+$/, "");
  const after = content.slice(to).replace(/^\n+/, "").replace(/\n+$/, "");
  const block = text.replace(/^\n+/, "").replace(/\n+$/, "");

  const parts: string[] = [];
  if (before.length) parts.push(before);
  if (block.length) parts.push(block);
  if (after.length) parts.push(after);
  const joined = parts.join("\n\n");
  // Preserve a single trailing newline if the original ended with one.
  return content.endsWith("\n") && joined.length ? joined + "\n" : joined;
}

function applyOne(
  content: string,
  operation: EditOperation,
): { content: string; applied: AppliedOperation } {
  const outline = parseOutline(content);

  if (operation.op === "insert") {
    const { position, text } = operation;
    if (position === "end_of_document") {
      return {
        content: spliceBlock(content, content.length, content.length, text),
        applied: { op: "insert", path: "(document)", detail: "insert at end_of_document" },
      };
    }
    if (!operation.anchor_heading) {
      // Validated earlier for real callers; guarded here for direct users.
      throw new InvalidOperationError(0, `insert with position "${position}" requires anchor_heading`);
    }
    const node = resolveAnchor(outline, operation.anchor_heading);
    let at: number;
    let detail: string;
    if (position === "before_heading") {
      at = node.start;
      detail = "insert before_heading";
    } else if (position === "after_heading") {
      at = node.bodyStart;
      detail = "insert after_heading";
    } else {
      at = resolveSectionEnd(content, outline, node, operation.section_part, "end_of_section insert");
      detail =
        `insert at end_of_section` +
        (operation.section_part ? ` (${operation.section_part})` : "");
    }
    return {
      content: spliceBlock(content, at, at, text),
      applied: { op: "insert", path: node.path, detail },
    };
  }

  if (operation.op === "replace_section") {
    const node = resolveAnchor(outline, operation.anchor_heading);
    const to = resolveSectionEnd(content, outline, node, operation.section_part, "replace_section");
    return {
      content: spliceBlock(content, node.bodyStart, to, operation.text),
      applied: {
        op: "replace_section",
        path: node.path,
        detail:
          "replace_section body" + (operation.section_part ? ` (${operation.section_part})` : ""),
      },
    };
  }

  if (operation.op === "rename_section") {
    const node = resolveAnchor(outline, operation.anchor_heading);
    const next = canonicalHeading(operation.new_heading);
    const m = next.match(ATX_HEADING);
    if (!m) {
      throw new InvalidOperationError(
        0,
        `new_heading must be a markdown heading line like "## Title", got ${JSON.stringify(operation.new_heading)}`,
      );
    }
    if (m[1].length !== node.level) throw new HeadingLevelChangeError(node.heading, next);

    // Replace the heading LINE only. Not spliceBlock: that normalises
    // surrounding blank lines, which is right for a block of body text and
    // wrong for a single line whose neighbours are the section's own spacing.
    const hadNewline = content[node.bodyStart - 1] === "\n";
    const replacement = next + (hadNewline ? "\n" : "");
    return {
      content: content.slice(0, node.start) + replacement + content.slice(node.bodyStart),
      applied: {
        op: "rename_section",
        path: node.path,
        detail: `rename_section to ${next}`,
      },
    };
  }

  // delete_section
  const node = resolveAnchor(outline, operation.anchor_heading);
  const scope = operation.scope ?? "body_only";
  const to = resolveSectionEnd(content, outline, node, operation.section_part, "delete_section");
  const from = scope === "heading_and_body" ? node.start : node.bodyStart;
  return {
    content: spliceBlock(content, from, to, ""),
    applied: {
      op: "delete_section",
      path: node.path,
      detail:
        `delete_section (${scope})` + (operation.section_part ? ` (${operation.section_part})` : ""),
    },
  };
}

/** Structural validation of an operations array — index-precise, before any work. */
export function validateOperations(operations: unknown): EditOperation[] {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new InvalidOperationError(0, "operations must be a non-empty array");
  }
  return operations.map((raw, i) => {
    if (typeof raw !== "object" || raw === null) {
      throw new InvalidOperationError(i, "each operation must be an object");
    }
    const o = raw as Record<string, unknown>;
    const op = o.op;
    if (op === "insert") {
      const position = o.position;
      if (
        position !== "end_of_document" &&
        position !== "end_of_section" &&
        position !== "after_heading" &&
        position !== "before_heading"
      ) {
        throw new InvalidOperationError(
          i,
          "insert requires position: end_of_document | end_of_section | after_heading | before_heading",
        );
      }
      if (typeof o.text !== "string" || o.text.trim() === "") {
        throw new InvalidOperationError(i, "insert requires non-empty text");
      }
      if (position !== "end_of_document" && typeof o.anchor_heading !== "string") {
        throw new InvalidOperationError(i, `insert at ${position} requires anchor_heading`);
      }
      if (position === "end_of_document" && o.anchor_heading !== undefined) {
        throw new InvalidOperationError(i, "end_of_document takes no anchor_heading");
      }
    } else if (op === "replace_section") {
      if (typeof o.anchor_heading !== "string" || o.anchor_heading.trim() === "") {
        throw new InvalidOperationError(i, "replace_section requires anchor_heading");
      }
      if (typeof o.text !== "string" || o.text.trim() === "") {
        throw new InvalidOperationError(i, "replace_section requires non-empty text");
      }
    } else if (op === "delete_section") {
      if (typeof o.anchor_heading !== "string" || o.anchor_heading.trim() === "") {
        throw new InvalidOperationError(i, "delete_section requires anchor_heading");
      }
      if (o.scope !== undefined && o.scope !== "body_only" && o.scope !== "heading_and_body") {
        throw new InvalidOperationError(i, "scope must be body_only or heading_and_body");
      }
    } else if (op === "rename_section") {
      if (typeof o.anchor_heading !== "string" || o.anchor_heading.trim() === "") {
        throw new InvalidOperationError(i, "rename_section requires anchor_heading");
      }
      if (typeof o.new_heading !== "string" || o.new_heading.trim() === "") {
        throw new InvalidOperationError(i, "rename_section requires non-empty new_heading");
      }
      // A rename touches the heading line and nothing else, so a caller that
      // also passed body text has misunderstood which operation they want.
      // Silently ignoring it would lose the text without saying so.
      if (o.text !== undefined) {
        throw new InvalidOperationError(
          i,
          "rename_section changes only the heading and takes no text — use replace_section for the body, or both operations in one call",
        );
      }
      if (o.section_part !== undefined) {
        throw new InvalidOperationError(
          i,
          "rename_section takes no section_part: it replaces the heading line, so no extent is involved",
        );
      }
    } else {
      throw new InvalidOperationError(
        i,
        "op must be insert | replace_section | delete_section | rename_section",
      );
    }
    if (
      o.section_part !== undefined &&
      o.section_part !== "own_body" &&
      o.section_part !== "subtree"
    ) {
      throw new InvalidOperationError(i, "section_part must be own_body or subtree");
    }
    return raw as EditOperation;
  });
}

/**
 * Apply operations in order against the evolving text (spec §3.4). All or
 * nothing is upheld by construction: this function either returns the fully
 * assembled result or throws before the caller writes anything — the write
 * itself is a single ingest call downstream. Errors are re-thrown with the
 * failing index prefixed so a batch caller can report it.
 */
export function applyOperations(
  content: string,
  operations: EditOperation[],
): { content: string; applied: AppliedOperation[] } {
  let current = content;
  const applied: AppliedOperation[] = [];
  for (let i = 0; i < operations.length; i++) {
    try {
      const result = applyOne(current, operations[i]);
      current = result.content;
      applied.push(result.applied);
    } catch (err) {
      if (err instanceof InvalidOperationError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      const wrapped = new Error(`Operation ${i + 1} of ${operations.length} failed: ${msg}`);
      wrapped.name = err instanceof Error ? err.name : "Error";
      throw wrapped;
    }
  }
  return { content: current, applied };
}
