/**
 * Heading-aware markdown chunker — TS port of
 * `src/cerefox/chunking/markdown.py`.
 *
 * **Byte-identical output to Python** for any input. The TS chunker
 * and the Python chunker must produce the same chunk count, same
 * `content` strings, same `heading_path` arrays, same `heading_level`
 * + `title`, and same `char_count` values for every fixture under
 * `packages/memory/test/fixtures/python-parity/chunking/`. Drift =
 * the existing corpus loses parity and would require re-embedding.
 *
 * Algorithm (mirrors Python; see `markdown.py` docstring for the
 * rationale of each step):
 *
 * 1. Short-circuit: documents ≤ max_chunk_chars return as a single
 *    chunk (heading_level=0, empty heading_path).
 * 2. Parse into H1/H2/H3 sections (H4-H6 stay as body text).
 * 3. Greedy accumulation: combine sections into a buffer until adding
 *    the next would exceed max_chunk_chars; then flush.
 * 4. Oversized single sections split at paragraph boundaries.
 * 5. No overlap between chunks (heading breadcrumb embedded in content
 *    provides context).
 *
 * Critical parity notes:
 * - **Length is code-point-based**, not UTF-16 code-unit-based.
 *   Python's `len("🎉")` is 1; JS's `"🎉".length` is 2. We use
 *   `codePointLength` everywhere `len()` is used in Python.
 * - **Trim semantics match Python's `.strip()`**: JS `.trim()` removes
 *   the same whitespace class (space, tab, \n, \r, \f, \v, plus
 *   Unicode whitespace) — verified parity-fixture-equivalent for the
 *   captured set.
 * - **Heading regex** is `/^(#{1,3})\s+(.+)$/gm` with the `m` flag,
 *   matching Python's `re.MULTILINE` behaviour. Captures hashes +
 *   heading text per match; trailing hashes stripped via `rstrip("#")`
 *   equivalent.
 * - **`text.split(regex)` with capture groups**: JS String.split with
 *   a capturing-group regex returns a flat array `[before, cap1, cap2,
 *   between, cap1, cap2, after]` — matches Python's `re.split` shape
 *   exactly. The chunker takes triples `(hashes, heading_text, body)`
 *   off the array, identical to Python.
 */

/** Single chunk produced by the markdown chunker. Mirrors `ChunkData` in `markdown.py`. */
export interface ChunkData {
  chunk_index: number;
  heading_path: string[];
  /** 0 = no heading (preamble or merged piece); 1-3 = H1-H3 */
  heading_level: number;
  /** Last element of heading_path, or "" for preamble/merged */
  title: string;
  /** Full text (includes heading lines for non-preamble chunks) */
  content: string;
  char_count: number;
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Python-equivalent length (code points, not UTF-16 code units).
 * `"🎉".length` is 2 in JS but `len("🎉")` is 1 in Python.
 */
function cpLen(s: string): number {
  let n = 0;
  // String iteration in JS is code-point-based.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of s) n++;
  return n;
}

/** Strip trailing `#` characters (matches Python `str.rstrip("#")`). */
function rstripHash(s: string): string {
  let i = s.length;
  while (i > 0 && s[i - 1] === "#") i--;
  return s.slice(0, i);
}

// Heading match: H1/H2/H3 only. Multiline so `^`/`$` match line boundaries.
// Note: the `g` flag is needed for `String.prototype.split` with captures to
// return all matches across the string (JS-specific quirk).
const HEADING_RE = /^(#{1,3})\s+(.+)$/gm;

// Two or more consecutive newlines separate paragraphs.
const PARAGRAPH_SEP = /\n{2,}/;

/**
 * Split text into `(level, heading, body)` triples. `level === 0` for
 * preamble (content before the first H1/H2/H3 heading).
 *
 * Uses `String.prototype.split` with capture groups, which returns the
 * same flat shape Python's `re.split` does:
 *   [preamble, hashes, heading_text, body, hashes, heading_text, body, …]
 */
function parseSections(
  text: string,
): Array<readonly [number, string, string]> {
  const segments: Array<readonly [number, string, string]> = [];
  // Reset lastIndex defensively even though split doesn't use it.
  HEADING_RE.lastIndex = 0;
  const parts = text.split(HEADING_RE);

  const preamble = parts[0]?.trim() ?? "";
  if (preamble) {
    segments.push([0, "", preamble]);
  }

  // Remaining come in triples: (hashes, heading_text, body)
  for (let i = 1; i + 2 < parts.length + 1; i += 3) {
    if (i + 2 > parts.length) break;
    const hashes = parts[i] ?? "";
    const headingText = rstripHash(parts[i + 1] ?? "").trim();
    const body = (parts[i + 2] ?? "").trim();
    segments.push([hashes.length, headingText, body]);
  }
  return segments;
}

function appendChunk(
  chunks: ChunkData[],
  content: string,
  path: string[],
  level: number,
  heading: string,
  opts: { forceNew?: boolean; minChunkChars?: number } = {},
): void {
  const forceNew = opts.forceNew ?? true;
  const minChunkChars = opts.minChunkChars ?? 0;

  if (!forceNew && cpLen(content) < minChunkChars && chunks.length > 0) {
    const prev = chunks[chunks.length - 1];
    prev.content = `${prev.content}\n\n${content}`;
    prev.char_count = cpLen(prev.content);
    return;
  }

  const title = level > 0 ? heading : (path[path.length - 1] ?? "");
  chunks.push({
    chunk_index: chunks.length,
    heading_path: [...path],
    heading_level: level,
    title,
    content,
    char_count: cpLen(content),
  });
}

function splitParagraphs(text: string, maxChars: number): string[] {
  const paragraphs = text.split(PARAGRAPH_SEP).filter((p) => p.trim() !== "");
  if (paragraphs.length === 0) return [];

  const result: string[] = [];
  let currentParts: string[] = [];
  let currentLen = 0;

  for (const para of paragraphs) {
    const paraLen = cpLen(para);
    const addition = paraLen + (currentParts.length > 0 ? 2 : 0); // +2 for "\n\n"
    if (currentLen + addition <= maxChars) {
      currentParts.push(para);
      currentLen += addition;
    } else if (currentParts.length > 0) {
      result.push(currentParts.join("\n\n"));
      currentParts = [para];
      currentLen = paraLen;
    } else {
      // Single paragraph exceeds max_chars. Keep it WHOLE as one piece — never
      // split INSIDE a paragraph. `cerefox_reconstruct_doc` reassembles a document
      // by joining chunks with "\n\n", so any intra-paragraph split is lossy: it
      // inserts a spurious blank line at each seam (e.g. "Source" -> "Sour\n\nce",
      // and a markdown table gets a blank line mid-row, splitting the table). The
      // earlier `step = maxChars/2` char-slice ALSO overlapped, duplicating content
      // on reconstruction. Only splitting at paragraph ("\n\n") boundaries keeps the
      // join lossless — a whole oversized paragraph (typically a big markdown table)
      // is a valid single chunk, well within the embedder's token limit for realistic
      // inputs. (A pathologically huge single paragraph exceeding the embedder limit
      // is a separate, rare concern; we still keep it whole rather than corrupt it.)
      result.push(para);
      currentParts = [];
      currentLen = 0;
    }
  }

  if (currentParts.length > 0) {
    result.push(currentParts.join("\n\n"));
  }
  return result;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Split markdown text into heading-aware chunks. Mirror of Python's
 * `chunk_markdown` — see `markdown.py` for the algorithm narrative.
 *
 * @param text - Raw markdown.
 * @param maxChunkChars - Target maximum chunk size (default 4000).
 * @param minChunkChars - Min size for paragraph-level pieces produced by
 *   the oversized-section split (default 100). Pieces smaller than this
 *   are merged into the preceding piece.
 */
export function chunkMarkdown(
  text: string,
  maxChunkChars = 4000,
  minChunkChars = 100,
): ChunkData[] {
  const stripped = text.trim();
  if (!stripped) return [];

  // Short-circuit: small documents stay as one chunk.
  if (cpLen(stripped) <= maxChunkChars) {
    return [
      {
        chunk_index: 0,
        heading_path: [],
        heading_level: 0,
        title: "",
        content: stripped,
        char_count: cpLen(stripped),
      },
    ];
  }

  const sections = parseSections(stripped);
  const chunks: ChunkData[] = [];
  let headingStack: string[] = [];

  // Greedy accumulation buffer
  let bufParts: string[] = [];
  let bufPath: string[] = [];
  let bufLevel = 0;
  let bufHeading = "";
  let bufChars = 0;

  const flushBuf = (): void => {
    if (bufParts.length === 0) return;
    const content = bufParts.join("\n\n");
    appendChunk(chunks, content, bufPath, bufLevel, bufHeading, {
      forceNew: true,
    });
    bufParts = [];
    bufPath = [];
    bufLevel = 0;
    bufHeading = "";
    bufChars = 0;
  };

  for (const [level, heading, body] of sections) {
    let path: string[];
    if (level > 0) {
      headingStack = headingStack.slice(0, level - 1);
      headingStack.push(heading);
      path = [...headingStack];
    } else {
      path = [];
    }

    let content: string;
    if (level > 0) {
      const headerLine = "#".repeat(level) + " " + heading;
      content = body ? `${headerLine}\n\n${body}` : headerLine;
    } else {
      content = body;
    }

    if (content.trim() === "") continue;

    const contentLen = cpLen(content);

    // Oversized single section: flush, then paragraph-split.
    if (contentLen > maxChunkChars) {
      flushBuf();
      const headerPrefix =
        level > 0 ? `${"#".repeat(level)} ${heading}\n\n` : "";
      const pieces = splitParagraphs(body, maxChunkChars);
      for (let i = 0; i < pieces.length; i++) {
        const rawPiece = pieces[i];
        const piece = (i === 0 ? headerPrefix + rawPiece : rawPiece).trim();
        if (!piece) continue;
        appendChunk(chunks, piece, path, level, heading, {
          forceNew: i === 0,
          minChunkChars,
        });
      }
      if (pieces.length === 0) {
        // Body was empty — heading-only content exceeded max (very rare).
        appendChunk(chunks, content, path, level, heading, { forceNew: true });
      }
      continue;
    }

    // Section fits — try greedy accumulation.
    const addition = contentLen + (bufParts.length > 0 ? 2 : 0); // +2 for "\n\n"

    if (bufChars + addition <= maxChunkChars) {
      if (bufParts.length === 0) {
        bufPath = path;
        bufLevel = level;
        bufHeading = heading;
      }
      bufParts.push(content);
      bufChars += addition;
    } else {
      flushBuf();
      bufParts = [content];
      bufPath = path;
      bufLevel = level;
      bufHeading = heading;
      bufChars = contentLen;
    }
  }

  flushBuf();

  // Re-number after any merges.
  for (let i = 0; i < chunks.length; i++) {
    chunks[i].chunk_index = i;
  }
  return chunks;
}
