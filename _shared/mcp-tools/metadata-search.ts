/**
 * `cerefox_metadata_search` — find documents by metadata key-value
 * criteria without a text search term. JSONB containment filter with AND
 * semantics; optional project + time-range filters; optional content
 * inclusion with a byte budget.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { applyByteBudget, logUsage, MAX_RESPONSE_BYTES } from "./_utils.ts";
import { lookupProjectId } from "./_projects.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const metadata_filter = args.metadata_filter as Record<string, string> | undefined;
  const project_name = args.project_name as string | undefined;
  const updated_since = args.updated_since as string | undefined;
  const created_since = args.created_since as string | undefined;
  const limit = (args.limit as number | undefined) ?? 10;
  const include_content = (args.include_content as boolean | undefined) ?? false;
  const requested_max_bytes = args.max_bytes as number | undefined;

  if (!metadata_filter || typeof metadata_filter !== "object" || Array.isArray(metadata_filter)) {
    throw new McpInvalidParams("metadata_filter is required and must be a JSON object");
  }
  if (Object.keys(metadata_filter).length === 0) {
    throw new McpInvalidParams("metadata_filter must contain at least one key-value pair");
  }

  // Resolve project name to UUID if provided
  let projectId: string | null = null;
  if (project_name) {
    projectId = await lookupProjectId(supabase, project_name);
    if (!projectId) throw new Error(`Project not found: ${project_name}`);
  }

  // Enforce byte ceiling for content mode
  const max_bytes = include_content
    ? Math.min(requested_max_bytes ?? MAX_RESPONSE_BYTES, MAX_RESPONSE_BYTES)
    : null;

  const params: Record<string, unknown> = {
    p_metadata_filter: metadata_filter,
    p_project_id: projectId,
    p_updated_since: updated_since ?? null,
    p_created_since: created_since ?? null,
    p_limit: limit,
    p_include_content: include_content,
  };
  if (max_bytes !== null) params.p_max_bytes = max_bytes;

  const { data, error } = await supabase.rpc("cerefox_metadata_search", params);

  if (error) throw new Error(`RPC error: ${error.message}`);

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
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    query_text: JSON.stringify(metadata_filter),
    project_id: projectId,
    result_count: rows.length,
  });

  if (rows.length === 0) return "No documents match the metadata filter.";

  // Note: when include_content is true the RPC already respects p_max_bytes
  // server-side. The applyByteBudget helper is retained here only for
  // parity with the EF implementation and as a defensive trim — see the
  // EF original for the same shape.
  void applyByteBudget; // referenced for symmetry; kept for v0.5 work

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

export const metadataSearchTool: ToolDefinition = {
  name: "cerefox_metadata_search",
  description:
    "Find documents by metadata key-value criteria without a text search term. Use to discover documents tagged with specific attributes, browse by taxonomy, or retrieve messages/tasks by type and status.",
  inputSchema: {
    type: "object",
    required: ["metadata_filter"],
    properties: {
      metadata_filter: {
        type: "object",
        description:
          'Key-value pairs; ALL must match (AND semantics). Example: {"type": "decision", "status": "active"}. Call cerefox_list_metadata_keys first to discover available keys.',
        additionalProperties: { type: "string" },
      },
      project_name: { type: "string", description: "Restrict to a project by name (optional)" },
      updated_since: {
        type: "string",
        description: "ISO-8601 timestamp; only docs updated on/after (optional)",
      },
      created_since: {
        type: "string",
        description: "ISO-8601 timestamp; only docs created on/after (optional)",
      },
      limit: { type: "integer", description: "Max results (default 10)" },
      include_content: {
        type: "boolean",
        description: "Include full document text (default false)",
      },
      max_bytes: {
        type: "integer",
        description:
          "Soft cap on total response bytes when include_content is true. Defaults to server maximum (200000).",
      },
      requestor: {
        type: "string",
        description:
          'Name of the agent or user making this request. Recorded in the usage log. Defaults to "mcp-agent" if not provided. May be enforced via server config.',
      },
    },
  },
  handler,
};
