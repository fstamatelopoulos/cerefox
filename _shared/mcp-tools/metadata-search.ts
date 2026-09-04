/**
 * `cerefox_metadata_search` — find documents by metadata key-value
 * criteria without a text search term. JSONB containment filter with AND
 * semantics; optional project + time-range filters; optional content
 * inclusion with a byte budget.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { applyByteBudget, getMaxResponseBytes, logUsage } from "./_utils.ts";
import { lookupProjectId } from "./_projects.ts";
import { reviewWorkflowEnabled } from "./feature-flags.ts";
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

  if (metadata_filter !== undefined && (typeof metadata_filter !== "object" || Array.isArray(metadata_filter))) {
    throw new McpInvalidParams("metadata_filter must be a JSON object when provided");
  }
  const has_metadata = !!metadata_filter && Object.keys(metadata_filter).length > 0;
  // metadata_filter is optional, but at least one narrowing criterion is
  // required so this can never become an unbounded whole-KB dump. An empty
  // filter + project_name lists a project's documents: the RPC's
  // `metadata @> '{}'` matches every row and the project predicate narrows it.
  if (!has_metadata && !project_name && !updated_since && !created_since) {
    throw new McpInvalidParams(
      "Provide at least one of: metadata_filter, project_name, updated_since, or created_since.",
    );
  }

  // Resolve project name to UUID if provided
  let projectId: string | null = null;
  if (project_name) {
    projectId = await lookupProjectId(supabase, project_name);
    if (!projectId) throw new Error(`Project not found: ${project_name}`);
  }

  // Enforce byte ceiling for content mode
  const ceiling = getMaxResponseBytes();
  const max_bytes = include_content
    ? Math.min(requested_max_bytes ?? ceiling, ceiling)
    : null;

  const params: Record<string, unknown> = {
    p_metadata_filter: metadata_filter ?? {},
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
    content_hash: string | null;
    content: string | null;
  }>;

  logUsage(supabase, {
    operation: "metadata_search",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    query_text: JSON.stringify(metadata_filter ?? {}),
    project_id: projectId,
    result_count: rows.length,
  });

  if (rows.length === 0) return "No documents match the given criteria.";

  // The review status is a column of a feature that may be off (#241); when
  // it is, an agent should not see "approved" and wonder what it means.
  const showReview = await reviewWorkflowEnabled(supabase);

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
    const hash = row.content_hash ? `\nhash: ${row.content_hash}` : "";
    const header =
      `## ${row.title} [id: ${row.document_id}]\n` +
      `${meta}${projects} | ${row.total_chars} chars | ${showReview ? `${row.review_status} | ` : ""}updated ${row.updated_at?.slice(0, 10) ?? "?"}${hash}`;

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
    "Find or list documents by metadata key-value criteria without a text search term. Use to discover documents tagged with specific attributes, browse by taxonomy, retrieve messages/tasks by type and status, or list all documents in a project (pass project_name alone). At least one of metadata_filter, project_name, updated_since, or created_since must be supplied; results are ordered newest-updated first.",
  // Read-only: touches nothing. Safe for a client to run without prompting.
  annotations: {
    title: "Find documents by metadata",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    properties: {
      metadata_filter: {
        type: "object",
        description:
          'Key-value pairs; ALL must match (AND semantics). Example: {"type": "decision", "status": "active"}. Call cerefox_list_metadata_keys first to discover available keys. Optional — omit (or pass {}) to list by project_name / time range alone.',
        additionalProperties: { type: "string" },
      },
      project_name: { type: "string", description: "Restrict to a project by name. Sufficient on its own to list that project's documents (optional)." },
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
