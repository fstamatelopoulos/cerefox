/**
 * `cerefox_metadata_search` — find documents by metadata key-value
 * criteria without a text search term. JSONB containment filter with AND
 * semantics; optional project + time-range filters; optional content
 * inclusion with a byte budget.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { getMaxResponseBytes, logUsage } from "./_utils.ts";
import { lookupProjectId } from "./_projects.ts";
import { reviewWorkflowEnabled } from "./feature-flags.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";
import { AUTHOR_PARAM_READ, callerIdentity } from "./identity.ts";

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const metadata_filter = args.metadata_filter as Record<string, string> | undefined;
  const project_name = args.project_name as string | undefined;
  const updated_since = args.updated_since as string | undefined;
  const created_since = args.created_since as string | undefined;
  // Sanitised and clamped, like `match_count` on the search tool: the local
  // stdio server passes tool arguments through unvalidated, so a caller could
  // ask for a million rows (#267). 500 matches the largest listing the web
  // API serves, so no legitimate enumeration is cut short.
  const limit = Math.min(Math.max(1, Math.floor(Number(args.limit)) || 10), 500);
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

  // Enforce byte ceiling for content mode.
  //
  // Sanitised first: a non-numeric `max_bytes` became `NaN`, which reaches the
  // RPC as JSON null, and `p_max_bytes NULL` means NO limit — so one word
  // instead of a number returned every matching document's full content, with
  // the in-process guard below disabled too (#267). Same hole as the search
  // tool's, in the sibling that shares its transport.
  const ceiling = getMaxResponseBytes();
  const requestedBytes = Math.floor(Number(requested_max_bytes));
  const max_bytes = include_content
    ? Math.min(
        Number.isFinite(requestedBytes) ? Math.max(requestedBytes, 1) : ceiling,
        ceiling,
      )
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

  // Logged once, AFTER the degraded branch below may have found the real
  // count: firing here unconditionally wrote a `result_count: 0` row for
  // every budget-wiped search, and adding a second row in the branch made
  // analytics double-count them (#259).
  const log = (result_count: number, extra?: Record<string, unknown>) =>
    logUsage(supabase, {
      operation: "metadata_search",
      accessPath: ctx.accessPath,
      requestor: callerIdentity(args),
      query_text: JSON.stringify(metadata_filter ?? {}),
      project_id: projectId,
      result_count,
      ...(extra ? { extra } : {}),
    });

  if (rows.length === 0) {
    // The RPC applies the byte budget server-side by stopping at the first row
    // that does not fit, so a single oversized document empties the result set
    // the same way the search tool's client-side budget did (#254). Ask again
    // without content before reporting nothing: an agent that is told "no
    // documents" stops looking, and here that would be false.
    if (include_content && max_bytes !== null) {
      // supabase-js RESOLVES with `{ data: null, error }` for PostgREST
      // failures and for network errors; it does not throw. A try/catch here
      // was dead code, and worse: `headers` came back null, the branch below
      // was skipped, and the handler answered "No documents match the given
      // criteria" — the exact false-empty this branch exists to prevent
      // (#261). Read the error, and say what is actually known.
      const { data: headers, error: probeError } = await supabase.rpc(
        "cerefox_metadata_search",
        { ...params, p_include_content: false, p_max_bytes: null },
      );
      if (probeError) {
        log(0, { degraded_probe_failed: true });
        return (
          `⚠ Nothing fit max_bytes=${max_bytes} with include_content, and the ` +
          `follow-up query that lists what matched failed: ${probeError.message}. ` +
          `This is NOT a confirmed empty result — retry with a larger max_bytes, ` +
          `or with include_content: false.`
        );
      }
      const headerRows = (headers ?? []) as Array<{ document_id: string; title: string }>;
      if (headerRows.length > 0) {
        // The caller asked for a budget; honour it in the answer that explains
        // the budget. `limit` is caller-supplied, so an uncapped list could be
        // tens of KB in reply to a 2 KB request (#257).
        const lead =
          `⚠ ${headerRows.length} document(s) match, but none fit max_bytes=${max_bytes} ` +
          `with include_content. This is NOT an empty result. Listing them without ` +
          `content — raise max_bytes, or read one with cerefox_get_document ` +
          `(outline: true for structure).`;
        const lines: string[] = [];
        let used = new TextEncoder().encode(lead).length;
        for (const r of headerRows) {
          const line = `## ${r.title} [id: ${r.document_id}]`;
          const size = new TextEncoder().encode(line).length + 1;
          if (used + size > max_bytes) break;
          lines.push(line);
          used += size;
        }
        // What matched, not what the budget allowed through (#257).
        log(headerRows.length, { returned: lines.length, degraded: true });
        return lines.length > 0 ? `${lead}\n${lines.join("\n")}` : lead;
      }
    }
    log(0);
    return "No documents match the given criteria.";
  }
  log(rows.length);

  // The review status is a column of a feature that may be off (#241); when
  // it is, an agent should not see "approved" and wonder what it means.
  const showReview = await reviewWorkflowEnabled(supabase);

  // The byte budget is the RPC's job here (`p_max_bytes`), not this file's:
  // it stops emitting rows once the accumulated content would exceed it. The
  // empty-result branch above compensates for its one sharp edge (#254).

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
      author: AUTHOR_PARAM_READ,
    },
  },
  handler,
};
