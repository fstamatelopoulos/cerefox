/**
 * `cerefox_search` — hybrid (FTS + semantic) search over the knowledge base.
 *
 * Three modes:
 * - `docs` (default) — document-level hybrid via `cerefox_search_docs`.
 * - `hybrid` — chunk-level hybrid via `cerefox_hybrid_search`.
 * - `fts` — FTS-only via `cerefox_fts_search` (no embedding needed).
 *
 * Embedding is computed for `docs` and `hybrid` modes via the shared
 * embedder. Results respect a per-call `max_bytes` budget capped at
 * `MAX_RESPONSE_BYTES`; whole rows are dropped to fit the budget.
 *
 * Mirrors `supabase/functions/cerefox-mcp/tools/search.ts` byte-for-byte
 * in response shape so v0.4.0 can keep agents on the same on-the-wire
 * format whether they go through the remote MCP or the new local TS one.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { getEmbedding, resolveEmbedderKind } from "../embeddings/index.ts";
import { getConfiguredMinSearchScore, getConfiguredSearchAlpha,
  getMaxResponseBytes, getMinTermCoverage, logUsage , resolveByteBudget } from "./_utils.ts";
import { lookupProjectId } from "./_projects.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";
import { AUTHOR_PARAM_READ, callerIdentity } from "./identity.ts";

interface SearchRow {
  document_id?: string;
  doc_title?: string;
  /** Document-level modes (`docs`) return this… */
  full_content?: string;
  /** …while `hybrid` and `fts` return the chunk text under this name. */
  content?: string;
  /** Chunk-mode identity: the RPCs return several chunks OF THE SAME document. */
  chunk_id?: string;
  chunk_index?: number;
  /** The chunk's own heading, and its full path from the document root. */
  title?: string;
  heading_path?: string[];
  best_score?: number;
  score?: number;
  is_partial?: boolean;
  chunk_count?: number;
  total_chars?: number;
  content_hash?: string;
  below_confidence?: boolean;
}

/** The row's text, under whichever column name this search mode returns. */
export function rowContent(row: SearchRow): string {
  return row.full_content ?? row.content ?? "";
}

/**
 * `Document Title › Section` for a chunk row, `Document Title` for a document
 * row, plus the ids that identify it.
 *
 * The chunk RPCs return several chunks OF THE SAME document, so without the
 * section and the index those results are indistinguishable (#261). Shared by
 * the rendered path and the degraded one, where identical headings would be
 * the entire answer.
 */
function rowHeading(row: SearchRow): string {
  const doc = row.doc_title ?? "Untitled";
  // `heading_path` normally opens with the document's own H1, so the FIRST
  // element is dropped when it repeats the title. Only the first: a section
  // legitimately named after the document must still appear (#261).
  const path = [...(row.heading_path ?? [])];
  if (path.length > 0 && path[0] === doc) path.shift();
  const section = path.length
    ? path.filter(Boolean).join(" › ")
    : row.title && row.title !== doc
      ? row.title
      : "";
  const docId = row.document_id ? ` [id: ${row.document_id}]` : "";
  const chunk = row.chunk_index != null ? ` (chunk ${row.chunk_index})` : "";
  return `${doc}${section ? ` › ${section}` : ""}${docId}${chunk}`;
}

/**
 * A short label for a row in the truncation footer: the leaf section, the
 * chunk index, and the document id.
 *
 * Shorter than the rendered heading, which carries the whole breadcrumb — the
 * footer names up to five rows, and full headings pushed the reply over the
 * budget it was reporting on (#263). The id stays, because chunk modes span
 * documents too and two documents sharing a title and a section name are
 * otherwise indistinguishable, with no way to fetch either (#265). The footer
 * is inside the budget and drops names it cannot afford, so it is accounted
 * for either way.
 */
function shortLabel(row: SearchRow): string {
  const doc = row.doc_title ?? "Untitled";
  const path = [...(row.heading_path ?? [])];
  if (path.length > 0 && path[0] === doc) path.shift();
  const leaf = path.filter(Boolean).at(-1) ?? (row.title && row.title !== doc ? row.title : "");
  const chunk = row.chunk_index != null ? ` (chunk ${row.chunk_index})` : "";
  // Always the id. Chunk modes are not single-document either, so two
  // documents sharing a title and a section name would otherwise produce
  // byte-identical entries with no way to fetch either (#265). The footer is
  // inside the budget now and drops names it cannot afford, so carrying the
  // id costs nothing that is not accounted for.
  const id = row.document_id ? ` [id: ${row.document_id}]` : "";
  return `${leaf ? `${doc} › ${leaf}` : doc}${chunk}${id}`;
}

/** One rendered result: heading, score, then the row's text. */
function renderRow(row: SearchRow): string {
  const raw = row.best_score ?? row.score;
  const score = raw != null ? ` (score: ${raw.toFixed(3)})` : "";
  const partial = row.is_partial
    ? ` -- partial (${row.chunk_count} of ${(row.total_chars ?? 0).toLocaleString()} chars)`
    : "";
  // content_hash = the concurrency token for cerefox_ingest updates (iter-32).
  const hash = row.content_hash ? `\nhash: ${row.content_hash}` : "";
  // Whichever column this mode returns (#259): `cerefox_search_docs` gives
  // `full_content`, the chunk RPCs give `content`, and reading only the first
  // rendered every hybrid/fts result as a title with an empty body.
  return `## ${rowHeading(row)}${score}${partial}${hash}\n\n${rowContent(row)}`;
}

/** `## Title [id: …] (score: …) -- 20,297 chars` — everything but the content. */
function headerLine(row: SearchRow): string {
  const raw = row.best_score ?? row.score;
  const score = raw != null ? ` (score: ${raw.toFixed(3)})` : "";
  const size = row.total_chars != null ? ` -- ${row.total_chars.toLocaleString()} chars` : "";
  const hash = row.content_hash ? `\nhash: ${row.content_hash}` : "";
  return `## ${rowHeading(row)}${score}${size}${hash}`;
}

/**
 * What to say when results matched but none fit `max_bytes` (#254).
 *
 * Never "no results": that is the one answer an agent acts on irreversibly.
 * The headers are listed while they fit the same budget, so the response
 * still honours the limit the caller asked for; if even one header does not
 * fit, the count and the remedy alone still beat silence.
 */
function degradedToHeaders(
  matched: SearchRow[],
  rendered: string[],
  maxBytes: number,
  belowConfidence: boolean,
): string {
  // Rendered bytes, not JSON: the fit decision that reaches here is made in
  // rendered bytes, and quoting a JSON size produced messages saying the
  // largest result was 490 bytes and did not fit a 600-byte budget (#265).
  // Sizes come from the render the caller already paid for — re-rendering
  // whole documents here just to measure them tripled peak memory.
  const biggest = Math.max(...rendered.map((t) => new TextEncoder().encode(t).length));
  // A degraded response must not silently promote 28I's weak-signal
  // candidates into real matches: an agent told "N result(s) matched" about
  // rows that cleared no threshold would trust them.
  const confidence = belowConfidence
    ? "None of these cleared the confidence threshold — they are the closest " +
      "candidates, so judge relevance from the scores. "
    : "";
  const lead =
    `⚠ ${matched.length} result(s) matched, but none fit max_bytes=${maxBytes} ` +
    `(the largest is ${biggest.toLocaleString()} bytes). ${confidence}This is NOT an ` +
    `empty knowledge base. Listing what matched, without content — raise max_bytes ` +
    `to read it, or read one document with cerefox_get_document (outline: true for ` +
    `structure, or section: "## Heading" for one part).`;

  const lines: string[] = [];
  let used = new TextEncoder().encode(lead).length;
  for (const row of matched) {
    const line = headerLine(row);
    const size = new TextEncoder().encode(line).length + 2;
    if (used + size > maxBytes) break;
    lines.push(line);
    used += size;
  }
  return lines.length > 0 ? `${lead}\n\n${lines.join("\n\n")}` : lead;
}

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const query = args.query as string;
  const project_name = args.project_name as string | undefined;
  // Sanitised, then clamped, exactly as the Edge Function does it. Clamping
  // alone left `NaN` for a non-numeric value, which serialises to JSON null,
  // and `LIMIT NULL` in Postgres means NO limit — the unbounded work the
  // clamp exists to prevent, reachable because the local MCP server passes
  // tool arguments through unvalidated (#265).
  const match_count = Math.min(Math.max(1, Math.floor(Number(args.match_count)) || 5), 200);
  const mode = (args.mode as string | undefined) ?? "docs";
  // #133: omit unconfigured tunables so the server resolves them from
  // cerefox_config (one setting governs every access path).
  const alpha = (args.alpha as number | undefined) ?? getConfiguredSearchAlpha();
  const min_score =
    (args.min_score as number | undefined) ?? getConfiguredMinSearchScore();
  // v1.0.4: coverage gate default from CEREFOX_MIN_TERM_COVERAGE; only sent
  // when configured (see getMinTermCoverage — keeps pre-0.9.1 servers working).
  const min_term_coverage =
    (args.min_term_coverage as number | undefined) ?? getMinTermCoverage();
  const coverageParam =
    min_term_coverage !== undefined ? { p_min_term_coverage: min_term_coverage } : {};
  // Omitted keys let the RPC apply its cerefox_config → built-in chain (#133).
  const scoreParam = min_score !== undefined ? { p_min_score: min_score } : {};
  const alphaParam = alpha !== undefined ? { p_alpha: alpha } : {};
  const metadata_filter =
    (args.metadata_filter as Record<string, string> | null | undefined) ?? null;
  const requested_max_bytes = args.max_bytes as number | undefined;

  const ceiling = getMaxResponseBytes();
  // Sanitised before clamping, for the reason `match_count` is: `NaN` makes
  // every `> max_bytes` comparison below false, so a non-numeric value emitted
  // every row unbounded — the ceiling bypassed by passing it a word (#266).
  // A NUMBER of 0 or less still means "almost no budget", as it always did:
  // falling back to the ceiling there would hand a caller whose remaining
  // allowance ran out the largest possible reply (#267). Only a missing or
  // non-numeric value defaults to the ceiling.
  const max_bytes = resolveByteBudget(requested_max_bytes, ceiling);

  if (
    metadata_filter !== null &&
    metadata_filter !== undefined &&
    (typeof metadata_filter !== "object" || Array.isArray(metadata_filter))
  ) {
    throw new McpInvalidParams("metadata_filter must be a JSON object or null");
  }

  if (!query?.trim()) throw new McpInvalidParams("query is required");

  if (mode !== "fts" && !ctx.openaiApiKey && resolveEmbedderKind() !== "local") {
    throw new Error(
      "OpenAI API key not configured. Set OPENAI_API_KEY (Edge Function) or CEREFOX_OPENAI_API_KEY (.env, local).",
    );
  }

  // Resolve project name to UUID if provided
  let projectId: string | null = null;
  if (project_name) {
    projectId = await lookupProjectId(supabase, project_name);
    if (!projectId) throw new Error(`Project not found: ${project_name}`);
  }

  // FTS mode doesn't need an embedding
  let embedding: number[] | null = null;
  if (mode !== "fts") {
    embedding = await getEmbedding(query, ctx.openaiApiKey ?? "");
  }

  const metaFilterParam =
    metadata_filter && Object.keys(metadata_filter).length > 0
      ? { p_metadata_filter: metadata_filter }
      : {};

  let rpcName: string;
  let rpcParams: Record<string, unknown>;

  if (mode === "fts") {
    rpcName = "cerefox_fts_search";
    rpcParams = {
      p_query_text: query,
      p_match_count: match_count,
      p_project_id: projectId,
      ...metaFilterParam,
      ...coverageParam,
    };
  } else if (mode === "hybrid") {
    rpcName = "cerefox_hybrid_search";
    rpcParams = {
      p_query_text: query,
      p_query_embedding: embedding,
      p_match_count: match_count,
      p_use_upgrade: false,
      p_project_id: projectId,
      ...alphaParam,
      ...scoreParam,
      ...metaFilterParam,
      ...coverageParam,
    };
  } else {
    rpcName = "cerefox_search_docs";
    rpcParams = {
      p_query_text: query,
      p_query_embedding: embedding,
      p_match_count: match_count,
      p_project_id: projectId,
      ...alphaParam,
      ...scoreParam,
      ...metaFilterParam,
      ...coverageParam,
    };
  }

  const { data, error } = await supabase.rpc(rpcName, rpcParams);

  if (error) throw new Error(`RPC error: ${error.message}`);

  const matched = (data ?? []) as SearchRow[];

  // 28I: nothing cleared the relevance threshold, so the server returned its
  // best-effort candidates flagged below_confidence rather than an empty set
  // (which agents misread as "this knowledge does not exist"). The flag is
  // all-or-nothing per response, so it is read from what MATCHED.
  const belowConfidence = matched.length > 0 && matched.every((r) => r.below_confidence === true);

  if (matched.length === 0) {
    logUsage(supabase, {
      operation: "search",
      accessPath: ctx.accessPath,
      requestor: callerIdentity(args),
      query_text: query,
      project_id: projectId,
      result_count: 0,
    });
    return "No results found.";
  }

  // ── Fit the reply to max_bytes, in the units the caller receives ──────────
  //
  // The budget is spent on RENDERED text, not on the JSON the RPC returned:
  // `applyByteBudget` measures `JSON.stringify(row)`, which is the right unit
  // for the Edge Function (it ships JSON) and the wrong one here (this returns
  // markdown). Reserving rendered bytes out of a JSON-measured budget
  // guaranteed nothing, and neither the below-confidence preamble (~185 bytes)
  // nor the footer was counted by anything (#265).
  //
  // So: render, then take as many rows as the whole assembled reply can carry.
  // Assembling and measuring is the only way to be sure, because the preamble
  // and the footer both depend on how many rows were kept.
  const rendered = matched.map(renderRow);
  const size = (t: string) => new TextEncoder().encode(t).length;
  const SEP = "\n\n---\n\n";

  // The 28I advisory, long and short. It is charged to the budget like
  // everything else, but it must never displace the answer it is advising
  // about: a ~190-byte banner that pushes the only result out of a small reply
  // leaves the caller with a warning and no content (#265). The short form is
  // the floor — the contract is that weak candidates are never presented as
  // confident ones, and that survives in six words.
  const banner = (take: number, short: boolean) =>
    !belowConfidence
      ? ""
      : short
        ? `⚠ Below the confidence threshold — judge relevance from the scores.\n\n`
        : `⚠ No results cleared the confidence threshold. Showing the closest ${take} ` +
          `candidate(s) with scores — judge relevance yourself; a low score means weak ` +
          `signal, not necessarily absent knowledge.\n\n`;

  /**
   * The whole reply for a set of kept rows.
   *
   * Everything but the results is optional, in this order: the long advisory
   * gives way first, then the named list of what was dropped, then the bare
   * footer. What is NOT optional is saying that results were dropped — a
   * reply that quietly returns 1 of 5 hits leaves the caller believing they
   * saw everything, which is the failure this whole file is about (#266).
   */
  const assemble = (keptCount: number, short: boolean): string => {
    const kept = keptIdx.slice(0, keptCount);
    const body = banner(keptCount, short) + kept.map((i) => rendered[i]!).join(SEP);
    if (kept.length === matched.length) return body;

    const droppedRows = matched.filter((_, i) => !kept.includes(i));
    const room = max_bytes - size(body);
    const footer = (named: number) => {
      const labels = droppedRows.slice(0, named).map(shortLabel);
      const rest = droppedRows.length - labels.length;
      const naming = labels.length
        ? `: ${labels.join(", ")}${rest > 0 ? ` and ${rest} more` : ""}`
        : "";
      return (
        `\n\n[${kept.length} of ${matched.length} result(s) shown; ${droppedRows.length} did ` +
        `not fit max_bytes=${max_bytes}${naming}. Raise max_bytes, narrow the query, or ` +
        `lower match_count.]`
      );
    };
    for (let named = Math.min(5, droppedRows.length); named >= 1; named--) {
      const candidate = footer(named);
      if (size(candidate) <= room) return body + candidate;
    }
    const bare = footer(0);
    if (size(bare) <= room) return body + bare;
    // The floor, ~25 bytes, never dropped: the caller must know there is more.
    return body + `\n\n[${kept.length} of ${matched.length} shown; raise max_bytes]`;
  };

  // Which rows the budget can carry, in rank order. Rows that do not fit are
  // SKIPPED rather than ending the scan: one oversized top hit used to suppress
  // every smaller result behind it, and the reply then claimed nothing fit when
  // rows two and three would have fitted comfortably (#266).
  const sepBytes = size(SEP);
  const keptIdx: number[] = [];
  let acc = 0;
  for (let i = 0; i < rendered.length; i++) {
    const add = size(rendered[i]!) + (keptIdx.length > 0 ? sepBytes : 0);
    if (acc + add > max_bytes) continue;
    acc += add;
    keptIdx.push(i);
  }

  // Not one result fits (#254) — the only case that answers with no content,
  // and now the only case that can truthfully say so.
  if (keptIdx.length === 0) {
    logUsage(supabase, {
      operation: "search",
      accessPath: ctx.accessPath,
      requestor: callerIdentity(args),
      query_text: query,
      project_id: projectId,
      result_count: matched.length,
      extra: { returned: 0, truncated: true, degraded: true },
    });
    return degradedToHeaders(matched, rendered, max_bytes, belowConfidence);
  }

  // Give up the framing before the content, but never the fact of truncation:
  // long advisory, then a result, and the "N of M shown" notice always stays.
  let keptCount = keptIdx.length;
  let short = false;
  let output = assemble(keptCount, short);
  while (size(output) > max_bytes) {
    if (belowConfidence && !short) short = true;
    else if (keptCount > 1) {
      keptCount -= 1;
      short = belowConfidence;
    } else break; // one result plus the shortest possible framing: the floor
    output = assemble(keptCount, short);
  }
  const take = keptCount;

  logUsage(supabase, {
    operation: "search",
    accessPath: ctx.accessPath,
    requestor: callerIdentity(args),
    query_text: query,
    project_id: projectId,
    // What the QUERY matched, not what survived the budget: recording the
    // latter made a budget-wiped search look like an empty store in analytics.
    result_count: matched.length,
    ...(take < matched.length ? { extra: { returned: take, truncated: true } } : {}),
  });

  return output;
}

export const searchTool: ToolDefinition = {
  name: "cerefox_search",
  description:
    "Search the Cerefox personal knowledge base. Returns complete documents ranked by hybrid (FTS + semantic) relevance.",
  // Read-only: touches nothing. Safe for a client to run without prompting.
  annotations: {
    title: "Search knowledge base",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string", description: "Natural-language search query" },
      match_count: {
        type: "integer",
        description: "Maximum number of documents to return (default: 5, maximum: 200)",
      },
      project_name: {
        type: "string",
        description: "Filter results to a specific project by name (optional)",
      },
      metadata_filter: {
        type: "object",
        description:
          'Optional JSONB containment filter. Only documents whose metadata contains ALL specified key-value pairs are returned. Example: {"type": "decision", "status": "active"}. Call cerefox_list_metadata_keys first to discover available keys and values. Omit to search all documents.',
        additionalProperties: { type: "string" },
      },
      mode: {
        type: "string",
        enum: ["docs", "hybrid", "fts", "semantic"],
        description:
          "Search mode (default: docs — full reconstructed documents). hybrid: ranked chunks; fts: keyword-only (no embedding); semantic: vector-only.",
      },
      alpha: {
        type: "number",
        description:
          "Hybrid fusion weight 0–1 (default 0.7): 1 = pure semantic, 0 = pure keyword.",
      },
      min_score: {
        type: "number",
        description:
          "Minimum cosine similarity for vector-side results (default: server-configured, 0.5 OpenAI / 0.6 local embedder).",
      },
      min_term_coverage: {
        type: "number",
        description:
          "Keyword OR-fallback confidence bar 0–1 (default 0.5): fraction of the query's meaningful terms a result must match to count as a confident hit; weaker matches return flagged below-confidence. 0 = any matching term. Needs schema ≥ 0.9.1.",
      },
      max_bytes: {
        type: "integer",
        description:
          "Optional response size budget in bytes. Results are dropped whole until the budget is satisfied; a truncated flag is set when results are dropped. Defaults to the server maximum (200000). Pass a smaller value if your context window is limited. Values above the server maximum are silently capped.",
      },
      author: AUTHOR_PARAM_READ,
    },
  },
  handler,
};
