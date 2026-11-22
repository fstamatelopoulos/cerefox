/**
 * Search result shape (c), "passages" (#375): document results, ranked
 * exactly as the default `docs` search, where each document carries only its
 * best-matching chunks, best score first, up to a per-document cap.
 *
 * The selection happens in `cerefox_search_docs` (p_passages,
 * p_max_passage_chars; schema 0.23.0). This module holds what every client
 * shares around it: the cap's bounds, the old-server error, and the rendering
 * of a result as text, so the MCP tool and the CLI read the same.
 */

/** Per-document cap on passage text, in characters. Measured in #375. */
export const DEFAULT_PASSAGE_CHARS = 1500;
/** The RPC clamps to these too; clients clamp first so what they report is what ran. */
export const MIN_PASSAGE_CHARS = 200;
export const MAX_PASSAGE_CHARS = 20000;

/** The schema that introduced passages. */
export const PASSAGES_MIN_SCHEMA = "0.23.0";

export interface Passage {
  chunk_index: number;
  heading_path: string[];
  score: number;
  /** The kept text: the whole chunk, or, when `truncated`, an excerpt of it. */
  content: string;
  /** The chunk's full length, so a cut passage says how much it held. */
  chars: number;
  truncated: boolean;
  /** Truncated around the query's terms (fragments joined by " … "), rather
   *  than cut to the chunk's opening. */
  excerpt?: boolean;
}

export interface PassageRow {
  document_id?: string;
  doc_title?: string;
  passages?: Passage[] | null;
  matched_chunk_count?: number | null;
  total_chars?: number;
  is_partial?: boolean;
}

/**
 * The cap a caller asked for, clamped. `undefined` and anything non-numeric
 * give the default; a number is floored and clamped, never rejected, the way
 * `match_count` is.
 */
export function resolvePassageChars(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (raw === undefined || raw === null || raw === "" || !Number.isFinite(n)) return DEFAULT_PASSAGE_CHARS;
  return Math.min(Math.max(n, MIN_PASSAGE_CHARS), MAX_PASSAGE_CHARS);
}

/**
 * True when an RPC error says the server's `cerefox_search_docs` predates
 * p_passages (PostgREST finds no function with those parameter names).
 */
export function isPassagesUnsupported(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || /p_passages|p_max_passage_chars/.test(error.message ?? "");
}

export const PASSAGES_UNSUPPORTED_MESSAGE =
  `Matched passages (content "matches") need server schema ${PASSAGES_MIN_SCHEMA} or later, ` +
  `and this server does not have them yet. Update it with \`cerefox server deploy\` (Cerefox Local: ` +
  `\`cerefox-local upgrade\`), or search without it. If you have just deployed, the server's ` +
  `API may still be loading the new schema: retry in a minute.`;

/** Characters as the database counts them (code points), not UTF-16 units. */
function chars(s: string): number {
  return [...s].length;
}

/** A passage's section, without the document's own H1 when the path repeats it. */
export function passageSection(path: string[] | null | undefined, docTitle: string | undefined): string {
  const p = [...(path ?? [])];
  if (p.length > 0 && p[0] === docTitle) p.shift();
  return p.filter(Boolean).join(" › ");
}

/**
 * `2 of 6 matched passages, 1,372 of 4,116 chars`.
 *
 * `matched_chunk_count` counts the document's chunks among the search's
 * candidates (a pool ten times `match_count`), so it is a lower bound on how
 * many of its chunks match: the note below says "at least".
 */
export function passageSummary(row: PassageRow): string {
  const passages = row.passages ?? [];
  const matched = row.matched_chunk_count ?? passages.length;
  const kept = passages.reduce((n, p) => n + chars(p.content), 0);
  const total = row.total_chars ?? kept;
  const noun = matched === 1 ? "matched passage" : "matched passages";
  return `${passages.length} of ${matched} ${noun}, ${kept.toLocaleString()} of ${total.toLocaleString()} chars`;
}

/**
 * Said under a passage cut to its opening. That happens when the cap is below
 * the chunk's size and none of the query's terms occur in the chunk (a
 * semantic match), so the opening may not be the part that matched. An
 * excerpt around the terms needs no warning: it shows them.
 */
export const CUT_BELOW_CHUNK_NOTE =
  "max_passage_chars is smaller than this chunk, so this is its opening, " +
  "which may not hold the part that matched; raise max_passage_chars or read the section";

/** How a caller reads the rest: the MCP tool call by default, a CLI command for the CLI. */
export type ReadHint = (documentId: string) => string;

export const MCP_READ_HINT: ReadHint = (id) =>
  `cerefox_get_document("${id}") reads the whole document; ` +
  `with outline: true it lists the sections, and with section it reads one.`;

/**
 * The body of a passages result: each passage under its section and score,
 * then, when anything was left out, how much and how to read it. A cut is
 * never silent.
 */
export function renderPassagesBody(row: PassageRow, readHint: ReadHint = MCP_READ_HINT): string {
  const passages = row.passages ?? [];
  const parts = passages.map((p) => {
    const section = passageSection(p.heading_path, row.doc_title);
    const head = `### ${section || row.doc_title || "Untitled"} (score: ${p.score.toFixed(3)})`;
    const shown = `${chars(p.content).toLocaleString()} of ${p.chars.toLocaleString()} chars`;
    const cut = !p.truncated
      ? ""
      : p.excerpt
        ? `\n\n[… excerpt around the query's terms: ${shown} of this passage]`
        : `\n\n[… passage cut at ${shown}. ${CUT_BELOW_CHUNK_NOTE}]`;
    return `${head}\n\n${p.content}${cut}`;
  });
  if (row.is_partial) {
    const matched = row.matched_chunk_count ?? passages.length;
    const more = matched - passages.length;
    const lead = more > 0 ? `At least ${more} more matched passage${more === 1 ? "" : "s"}. ` : "";
    parts.push(`[${lead}${readHint(row.document_id ?? "<document id>")}]`);
  }
  return parts.join("\n\n");
}
