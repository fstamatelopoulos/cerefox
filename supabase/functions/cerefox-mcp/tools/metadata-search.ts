// ── cerefox_metadata_search tool handler ──────────────────────────────────
//
// Calls the cerefox_metadata_search RPC directly. Queries documents by
// metadata key-value criteria without a text search term.

import { makeSupabaseClient, applyByteBudget, logUsage } from "../shared.ts";

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

export async function handleMetadataSearch(
  args: Record<string, unknown>,
): Promise<string> {
  const metadata_filter = args.metadata_filter as Record<string, string> | undefined;
  const project_name = args.project_name as string | undefined;
  const updated_since = args.updated_since as string | undefined;
  const created_since = args.created_since as string | undefined;
  const limit = (args.limit as number | undefined) ?? 10;
  const include_content = (args.include_content as boolean | undefined) ?? false;
  const requested_max_bytes = args.max_bytes as number | undefined;

  if (!metadata_filter || typeof metadata_filter !== "object" || Array.isArray(metadata_filter)) {
    throw new Error("metadata_filter is required and must be a JSON object");
  }

  if (Object.keys(metadata_filter).length === 0) {
    throw new Error("metadata_filter must contain at least one key-value pair");
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

  // Enforce byte ceiling for content mode
  const max_bytes = include_content
    ? Math.min(requested_max_bytes ?? MAX_BYTES, MAX_BYTES)
    : null;

  const params: Record<string, unknown> = {
    p_metadata_filter: metadata_filter,
    p_project_id: projectId,
    p_updated_since: updated_since ?? null,
    p_created_since: created_since ?? null,
    p_limit: limit,
    p_include_content: include_content,
  };
  if (max_bytes !== null) {
    params.p_max_bytes = max_bytes;
  }

  const { data, error } = await supabase.rpc("cerefox_metadata_search", params);

  if (error) {
    throw new Error(`RPC error: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{
    document_id: string;
    title: string;
    doc_metadata: Record<string, unknown>;
    review_status: string;
    source: string | null;
    created_at: string;
    updated_at: string;
    total_chars: number;
    chunk_count: number;
    project_ids: string[];
    project_names: string[];
    version_count: number;
    content: string | null;
  }>;

  logUsage(supabase, {
    operation: "metadata_search",
    requestor: args.requestor as string | undefined,
    query_text: JSON.stringify(metadata_filter),
    project_id: projectId,
    result_count: rows.length,
  });

  if (rows.length === 0) {
    return "No documents match the metadata filter.";
  }

  const parts: string[] = rows.map((row) => {
    const projects = row.project_names?.length
      ? ` | projects: ${row.project_names.join(", ")}`
      : "";
    const meta = Object.entries(row.doc_metadata ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    const header =
      `## ${row.title} [id: ${row.document_id}]\n` +
      `${meta}${projects} | ${row.total_chars} chars | ${row.review_status} | updated ${row.updated_at?.slice(0, 10) ?? "?"}`;

    if (include_content && row.content) {
      return `${header}\n\n${row.content}`;
    }
    return header;
  });

  return parts.join("\n\n---\n\n");
}
