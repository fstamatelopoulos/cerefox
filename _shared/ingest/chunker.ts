/**
 * Exact-partition ("blind-stitch") markdown chunker — the single TS chunker
 * (iter-28D Phase 1). Consolidated: `_shared/mcp-tools/_chunker.ts` and the
 * `cerefox-ingest` Edge Function both import from here (the earlier duplicate
 * copies were removed).
 *
 * **The invariant:** `blindStitch(chunkMarkdown(doc)) === doc.trim()`, byte-for-
 * byte. Chunk `content` values are consecutive, gapless, non-overlapping slices
 * of the trimmed document, so reconstruction is a plain concatenation — no `\n\n`
 * separator is synthesized on read (the bug the old chunker+reconstruction had).
 * That is what lets a chunk boundary fall *anywhere* (including mid-paragraph at
 * a size limit) with zero corruption, which in turn lets us bound chunk size.
 *
 * These chunks are stored with `content_format = 2` and reconstructed by blind
 * concat (`STRING_AGG(content, '')`). Documents written before Phase 1 stay
 * `content_format = 1` and reconstruct with the legacy `\n\n`-join (see
 * `rpcs.sql`); they are untouched until re-written. Design:
 * `docs/specs/chunk-reconstruction-design.md`.
 *
 * Heading context is NOT stored in mid-section chunk content (that would break
 * the exact partition); it lives in `heading_path` metadata, and the embedding
 * input adds it back as a breadcrumb (`# {title}\n{breadcrumb}\n{content}`).
 *
 * Length is code-point-based (`cpLen`), matching the historical size semantics.
 */

/** Single chunk produced by the markdown chunker. */
export interface ChunkData {
  chunk_index: number;
  heading_path: string[];
  /** 0 = no heading (preamble); 1-3 = the innermost active H1-H3. */
  heading_level: number;
  /** Last element of heading_path, or "" for preamble. */
  title: string;
  /** Exact slice of the trimmed document (a gapless partition member). */
  content: string;
  char_count: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Code-point length (`"🎉".length` is 2 in JS but 1 code point). */
function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Strip trailing `#` (matches a markdown closing-hash heading). */
function rstripHash(s: string): string {
  let i = s.length;
  while (i > 0 && s[i - 1] === "#") i--;
  return s.slice(0, i);
}

interface HeadingMark {
  /** UTF-16 offset of the `#` in the trimmed doc. */
  offset: number;
  level: number;
  text: string;
}

/** All H1/H2/H3 heading lines in `doc`, in order (heading text on one line). */
function findHeadings(doc: string): HeadingMark[] {
  const out: HeadingMark[] = [];
  const re = /^(#{1,3})[ \t]+(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    out.push({ offset: m.index, level: m[1].length, text: rstripHash(m[2]).trim() });
  }
  return out;
}

/** The active H1/H2/H3 nesting stack at `offset` (headings at or before it). */
function activeHeadings(headings: HeadingMark[], offset: number): HeadingMark[] {
  const stack: HeadingMark[] = [];
  for (const h of headings) {
    if (h.offset > offset) break;
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    stack.push(h);
  }
  return stack;
}

/**
 * Split `s` into consecutive pieces of at most `maxCp` code points each, with
 * `pieces.join("") === s`. Never splits a code point (surrogate pair).
 */
function hardSplitCp(s: string, maxCp: number): string[] {
  const out: string[] = [];
  let buf = "";
  let n = 0;
  for (const ch of s) {
    if (n >= maxCp) {
      out.push(buf);
      buf = "";
      n = 0;
    }
    buf += ch;
    n++;
  }
  if (buf) out.push(buf);
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Split markdown into exact-partition chunks. `minChunkChars` is accepted for
 * signature compatibility but unused (tiny trailing atoms merge into the current
 * chunk naturally via greedy accumulation).
 */
export function chunkMarkdown(
  text: string,
  maxChunkChars = 4000,
  _minChunkChars = 100,
): ChunkData[] {
  const doc = text.trim();
  if (!doc) return [];

  if (cpLen(doc) <= maxChunkChars) {
    return [
      { chunk_index: 0, heading_path: [], heading_level: 0, title: "", content: doc, char_count: cpLen(doc) },
    ];
  }

  const headings = findHeadings(doc);

  // Atomize preserving every character: split on blank-line runs, attach each
  // separator to its PRECEDING block (so a separator never starts a chunk), then
  // hard-split any atom that alone exceeds the size limit. atoms.join("") === doc.
  const parts = doc.split(/(\n{2,})/); // [block, sep, block, sep, …, block]
  const atoms: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const unit = (parts[i] ?? "") + (parts[i + 1] ?? ""); // block + trailing separator
    if (unit === "") continue;
    if (cpLen(unit) > maxChunkChars) atoms.push(...hardSplitCp(unit, maxChunkChars));
    else atoms.push(unit);
  }

  const chunks: ChunkData[] = [];
  let buf = "";
  let bufCp = 0;
  let bufStart = 0;
  let offset = 0;

  const flush = (): void => {
    if (buf === "") return;
    const stack = activeHeadings(headings, bufStart);
    chunks.push({
      chunk_index: chunks.length,
      heading_path: stack.map((h) => h.text),
      heading_level: stack.length ? stack[stack.length - 1].level : 0,
      title: stack.length ? stack[stack.length - 1].text : "",
      content: buf,
      char_count: bufCp,
    });
    buf = "";
    bufCp = 0;
  };

  for (const atom of atoms) {
    const cp = cpLen(atom);
    if (buf === "") {
      bufStart = offset;
      buf = atom;
      bufCp = cp;
    } else if (bufCp + cp <= maxChunkChars) {
      buf += atom;
      bufCp += cp;
    } else {
      flush();
      bufStart = offset;
      buf = atom;
      bufCp = cp;
    }
    offset += atom.length; // UTF-16 length — same units as heading offsets
  }
  flush();
  return chunks;
}

/** Format-2 reconstruction: blind concatenation (mirrors the RPC's `STRING_AGG(content,'')`). */
export function blindStitch(chunks: Pick<ChunkData, "content">[]): string {
  return chunks.map((c) => c.content).join("");
}

/**
 * The document-content format this chunker produces. Stored on the document and
 * used by the reconstruction RPCs to pick the join strategy (2 = blind concat).
 */
export const CONTENT_FORMAT_BLIND_STITCH = 2;
