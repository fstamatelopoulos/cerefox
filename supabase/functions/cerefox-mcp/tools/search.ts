// ── cerefox_search tool handler ───────────────────────────────────────────
//
// Calls the cerefox_search_docs / cerefox_hybrid_search / cerefox_fts_search
// RPC directly instead of delegating to the cerefox-search Edge Function.

import { makeSupabaseClient, applyByteBudget } from "../shared.ts";
import { getEmbedding } from "../embeddings.ts";

// Server-enforced hard limit. Agents may pass a smaller max_bytes to fit their
// context budget but cannot exceed this value.
const MAX_BYTES = 200_000;

async function lookupProjectId(
  supabase: ReturnType<typeof makeSupabaseClient>,
  projectName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("cerefox_projects")
    .select("id")
    .ilike("name", projectName)
    .limit(1);

  if (error || !data?.length) return null;
  return data[0].id;
}

export async function handleSearch(
  args: Record<string, unknown>,
  openaiKey: string,
): Promise<string> {
  const query = args.query as string;
  const project_name = args.project_name as string | undefined;
  const match_count = (args.match_count as number | undefined) ?? 5;
  const mode = (args.mode as string | undefined) ?? "docs";
  const alpha = (args.alpha as number | undefined) ?? 0.7;
  const min_score = (args.min_score as number | undefined) ?? 0.5;
  const metadata_filter = (args.metadata_filter as Record<string, string> | null | undefined) ??
    null;
  const requested_max_bytes = args.max_bytes as number | undefined;

  // Enforce ceiling: agents may request less but never more than MAX_BYTES
  const max_bytes = Math.min(requested_max_bytes ?? MAX_BYTES, MAX_BYTES);

  if (
    metadata_filter !== null &&
    metadata_filter !== undefined &&
    (typeof metadata_filter !== "object" || Array.isArray(metadata_filter))
  ) {
    throw new Error("metadata_filter must be a JSON object or null");
  }

  if (!query?.trim()) {
    throw new Error("query is required");
  }

  const supabase = makeSupabaseClient();

  // Resolve project name to UUID if provided
  let projectId: string | null = null;
  if (project_name) {
    projectId = await lookupProjectId(supabase, project_name);
    if (!projectId) {
      throw new Error(`Project not found: ${project_name}`);
    }
  }

  // FTS mode doesn't need an embedding
  let embedding: number[] | null = null;
  if (mode !== "fts") {
    embedding = await getEmbedding(query, openaiKey);
  }

  // Build metadata filter param only when a non-empty filter object is provided
  const metaFilterParam = metadata_filter && Object.keys(metadata_filter).length > 0
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
    };
  } else if (mode === "hybrid") {
    rpcName = "cerefox_hybrid_search";
    rpcParams = {
      p_query_text: query,
      p_query_embedding: embedding,
      p_match_count: match_count,
      p_alpha: alpha,
      p_use_upgrade: false,
      p_project_id: projectId,
      p_min_score: min_score,
      ...metaFilterParam,
    };
  } else {
    // "docs" — document-level hybrid search (recommended default)
    rpcName = "cerefox_search_docs";
    rpcParams = {
      p_query_text: query,
      p_query_embedding: embedding,
      p_match_count: match_count,
      p_alpha: alpha,
      p_project_id: projectId,
      p_min_score: min_score,
      ...metaFilterParam,
    };
  }

  const { data, error } = await supabase.rpc(rpcName, rpcParams);

  if (error) {
    throw new Error(`RPC error: ${error.message}`);
  }

  // Apply byte budget -- drop whole results (never truncate mid-doc)
  const { accepted, truncated, usedBytes } = applyByteBudget(data ?? [], max_bytes);

  if (accepted.length === 0) {
    return "No results found.";
  }

  const rows = accepted as Array<{
    document_id?: string;
    doc_title?: string;
    full_content?: string;
    best_score?: number;
    is_partial?: boolean;
    chunk_count?: number;
    total_chars?: number;
  }>;

  const parts: string[] = rows.map((row) => {
    const title = row.doc_title ?? "Untitled";
    const docId = row.document_id ? ` [id: ${row.document_id}]` : "";
    const score = row.best_score != null ? ` (score: ${row.best_score.toFixed(3)})` : "";
    const partial = row.is_partial
      ? ` -- partial (${row.chunk_count} of ${(row.total_chars ?? 0).toLocaleString()} chars)`
      : "";
    return `## ${title}${docId}${score}${partial}\n\n${row.full_content ?? ""}`;
  });

  let output = parts.join("\n\n---\n\n");

  if (truncated) {
    output +=
      `\n\n[Results truncated at ${usedBytes} bytes. Use a more specific query or a smaller match_count to see more.]`;
  }

  return output;
}
