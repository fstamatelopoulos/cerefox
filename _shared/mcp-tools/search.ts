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
import { applyByteBudget, getConfiguredMinSearchScore, getConfiguredSearchAlpha,
  getMaxResponseBytes, getMinTermCoverage, logUsage } from "./_utils.ts";
import { lookupProjectId } from "./_projects.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const query = args.query as string;
  const project_name = args.project_name as string | undefined;
  const match_count = (args.match_count as number | undefined) ?? 5;
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
  const max_bytes = Math.min(requested_max_bytes ?? ceiling, ceiling);

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

  const { accepted, truncated, usedBytes } = applyByteBudget(data ?? [], max_bytes);

  logUsage(supabase, {
    operation: "search",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    query_text: query,
    project_id: projectId,
    result_count: accepted.length,
  });

  if (accepted.length === 0) return "No results found.";

  const rows = accepted as Array<{
    document_id?: string;
    doc_title?: string;
    full_content?: string;
    best_score?: number;
    score?: number;
    is_partial?: boolean;
    chunk_count?: number;
    total_chars?: number;
    content_hash?: string;
    below_confidence?: boolean;
  }>;

  // 28I: nothing cleared the relevance threshold, so the server returned its
  // best-effort top candidates flagged below_confidence instead of an empty
  // set (which agents misread as "this knowledge does not exist").
  const belowConfidence = rows.length > 0 && rows.every((r) => r.below_confidence === true);

  const parts: string[] = rows.map((row) => {
    const title = row.doc_title ?? "Untitled";
    const docId = row.document_id ? ` [id: ${row.document_id}]` : "";
    const rawScore = row.best_score ?? row.score;
    const score = rawScore != null ? ` (score: ${rawScore.toFixed(3)})` : "";
    const partial = row.is_partial
      ? ` -- partial (${row.chunk_count} of ${(row.total_chars ?? 0).toLocaleString()} chars)`
      : "";
    // content_hash = the concurrency token for cerefox_ingest updates (iter-32).
    const hash = row.content_hash ? `\nhash: ${row.content_hash}` : "";
    return `## ${title}${docId}${score}${partial}${hash}\n\n${row.full_content ?? ""}`;
  });

  let output = parts.join("\n\n---\n\n");
  if (belowConfidence) {
    output =
      `⚠ No results cleared the confidence threshold. Showing the closest ${rows.length} ` +
      `candidate(s) with scores — judge relevance yourself; a low score means weak signal, ` +
      `not necessarily absent knowledge.\n\n` + output;
  }
  if (truncated) {
    output +=
      `\n\n[Results truncated at ${usedBytes} bytes. Use a more specific query or a smaller match_count to see more.]`;
  }
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
        description: "Maximum number of documents to return (default: 5)",
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
      requestor: {
        type: "string",
        description:
          'Name of the agent or user making this request (e.g., "Claude Code", "archiver"). Recorded in the usage log for attribution. Defaults to "mcp-agent" if not provided. May be enforced via server config.',
      },
    },
  },
  handler,
};
