/**
 * Document-relation tools (iteration 29) — the graph surface for agents.
 *
 *   cerefox_set_relation      create/update a typed edge
 *   cerefox_delete_relation   remove one
 *   cerefox_get_relations     everything touching a document, both directions
 *   cerefox_get_neighbors     walk one relation type outward
 *
 * All four are thin adapters over the matching RPCs — the type dictionary
 * (which types are symmetric, which change lifecycle status) lives in SQL so
 * every transport behaves identically. Design:
 * docs/research/document-relations-and-semantic-graph.md
 */

import { logUsage } from "./_utils.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";
import type { MCPSupabaseClient } from "./types.ts";

/** Relation types that carry behaviour; any other string is accepted too. */
const KNOWN_TYPES =
  "related_to, references, supersedes, contradicts, duplicates, part_of, follows, reply_to";

function requireUuid(value: unknown, field: string): string {
  const s = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    throw new McpInvalidParams(`${field} must be a document UUID (got: ${String(value)})`);
  }
  return s;
}

// ── set ──────────────────────────────────────────────────────────────────────

async function setHandler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const source = requireUuid(args.source_id, "source_id");
  const target = requireUuid(args.target_id, "target_id");
  const relType = typeof args.rel_type === "string" ? args.rel_type.trim() : "";
  if (!relType) throw new McpInvalidParams("rel_type is required");

  const { data, error } = await supabase.rpc("cerefox_set_relation", {
    p_source_id: source,
    p_target_id: target,
    p_rel_type: relType,
    p_author: (args.author as string | undefined) ?? "mcp-agent",
    p_author_type: "agent",
    p_metadata: (args.metadata as Record<string, unknown> | undefined) ?? {},
  });
  if (error) throw new Error(`RPC error: ${error.message}`);

  const row = (Array.isArray(data) ? data[0] : data) as
    | { is_symmetric?: boolean }
    | undefined;

  logUsage(supabase, {
    operation: "set_relation",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    document_id: source,
  });

  const both = row?.is_symmetric
    ? " (symmetric — the reverse edge was written too)"
    : "";
  const effect =
    relType === "supersedes"
      ? "\nTarget marked superseded."
      : relType === "contradicts"
        ? "\nBoth documents marked stale."
        : "";
  return `Relation set: ${source} --${relType}--> ${target}${both}.${effect}`;
}

export const setRelationTool: ToolDefinition = {
  name: "cerefox_set_relation",
  description:
    "Link two documents with a typed, directed relation (source → target). " +
    `Known types with behaviour: ${KNOWN_TYPES}. Symmetric types (related_to, ` +
    "contradicts, duplicates) write both directions. `supersedes` marks the target " +
    "superseded; `contradicts` marks both stale. Any other type string is accepted " +
    "and stored, just without special behaviour. Re-setting the same edge updates it.",
  /** Upsert: re-running with the same edge changes nothing. Adds an edge; removes nothing. */
  annotations: {
    title: "Link two documents",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["source_id", "target_id", "rel_type"],
    properties: {
      source_id: { type: "string", description: "UUID of the source document" },
      target_id: { type: "string", description: "UUID of the target document" },
      rel_type: {
        type: "string",
        description: `Relation type, e.g. one of: ${KNOWN_TYPES}. Free text is allowed.`,
      },
      metadata: {
        type: "object",
        description: "Optional JSON context for the edge (note, confidence, …)",
      },
      author: { type: "string", description: "Who is creating this relation" },
      requestor: { type: "string", description: "Name of the agent making this request" },
    },
  },
  handler: setHandler,
};

// ── delete ───────────────────────────────────────────────────────────────────

async function deleteHandler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const source = requireUuid(args.source_id, "source_id");
  const target = requireUuid(args.target_id, "target_id");
  const relType = typeof args.rel_type === "string" ? args.rel_type.trim() : "";
  if (!relType) throw new McpInvalidParams("rel_type is required");

  const { data, error } = await supabase.rpc("cerefox_delete_relation", {
    p_source_id: source,
    p_target_id: target,
    p_rel_type: relType,
    p_author: (args.author as string | undefined) ?? "mcp-agent",
    p_author_type: "agent",
  });
  if (error) throw new Error(`RPC error: ${error.message}`);

  const removed = typeof data === "number" ? data : 0;
  logUsage(supabase, {
    operation: "delete_relation",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    document_id: source,
  });

  if (removed === 0) return "No such relation — nothing removed.";
  return (
    `Removed ${removed} relation row(s): ${source} --${relType}--> ${target}. ` +
    "Lifecycle status is left as-is (a document may be superseded by something else too)."
  );
}

export const deleteRelationTool: ToolDefinition = {
  name: "cerefox_delete_relation",
  description:
    "Remove a typed relation between two documents. Symmetric types remove both " +
    "directions. Lifecycle status set by an earlier relation is NOT reverted.",
  /** Removes an edge (and its mirror for symmetric types). Relations are not versioned, so the edge is gone. */
  annotations: {
    title: "Remove a relation",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["source_id", "target_id", "rel_type"],
    properties: {
      source_id: { type: "string", description: "UUID of the source document" },
      target_id: { type: "string", description: "UUID of the target document" },
      rel_type: { type: "string", description: "Relation type to remove" },
      author: { type: "string", description: "Who is removing this relation" },
      requestor: { type: "string", description: "Name of the agent making this request" },
    },
  },
  handler: deleteHandler,
};

// ── read ─────────────────────────────────────────────────────────────────────

async function getRelationsHandler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const docId = requireUuid(args.document_id, "document_id");
  const { data, error } = await supabase.rpc("cerefox_get_relations", {
    p_document_id: docId,
  });
  if (error) throw new Error(`RPC error: ${error.message}`);

  const rows = (data ?? []) as Array<{
    direction: string;
    rel_type: string;
    other_id: string;
    other_title: string;
    other_lifecycle: string;
  }>;

  logUsage(supabase, {
    operation: "get_relations",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    document_id: docId,
    result_count: rows.length,
  });

  if (rows.length === 0) return "No relations for this document.";
  const lines = rows.map((r) => {
    const arrow = r.direction === "outbound" ? "→" : "←";
    const life = r.other_lifecycle && r.other_lifecycle !== "active"
      ? ` [${r.other_lifecycle}]`
      : "";
    return `- ${arrow} ${r.rel_type}: ${r.other_title}${life} [id: ${r.other_id}]`;
  });
  return `${rows.length} relation(s):\n${lines.join("\n")}`;
}

export const getRelationsTool: ToolDefinition = {
  name: "cerefox_get_relations",
  description:
    "List every relation touching a document, in both directions (→ outbound, " +
    "← inbound). Shows each neighbour's title and lifecycle status, so an agent " +
    "can tell whether retrieved knowledge has been superseded or contradicted.",
  // Read-only: traversal only, mutates nothing.
  annotations: {
    title: "List a document's relations",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["document_id"],
    properties: {
      document_id: { type: "string", description: "UUID of the document" },
      requestor: { type: "string", description: "Name of the agent making this request" },
    },
  },
  handler: getRelationsHandler,
};

async function getNeighborsHandler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const docId = requireUuid(args.document_id, "document_id");
  const relType = typeof args.rel_type === "string" ? args.rel_type.trim() : "";
  if (!relType) throw new McpInvalidParams("rel_type is required — pick one type to traverse");
  const depth = Math.max(1, Math.min((args.depth as number | undefined) ?? 1, 5));

  const { data, error } = await supabase.rpc("cerefox_get_neighbors", {
    p_document_id: docId,
    p_rel_type: relType,
    p_depth: depth,
    p_from_time: (args.from_time as string | undefined) ?? null,
    p_to_time: (args.to_time as string | undefined) ?? null,
    p_limit: Math.max(1, Math.min((args.limit as number | undefined) ?? 50, 200)),
  });
  if (error) throw new Error(`RPC error: ${error.message}`);

  const rows = (data ?? []) as Array<{
    document_id: string;
    title: string;
    lifecycle_status: string;
    depth: number;
    direction: string;
  }>;

  logUsage(supabase, {
    operation: "get_neighbors",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    document_id: docId,
    result_count: rows.length,
  });

  if (rows.length === 0) return `No documents reachable via "${relType}".`;
  const lines = rows.map((r) => {
    const life = r.lifecycle_status && r.lifecycle_status !== "active"
      ? ` [${r.lifecycle_status}]`
      : "";
    return `- depth ${r.depth} (${r.direction}): ${r.title}${life} [id: ${r.document_id}]`;
  });
  return `${rows.length} document(s) via "${relType}":\n${lines.join("\n")}`;
}

export const getNeighborsTool: ToolDefinition = {
  name: "cerefox_get_neighbors",
  description:
    "Walk the relation graph outward from a document along ONE relation type. " +
    "Use after cerefox_get_relations shows which types exist. depth > 1 follows " +
    "chains (useful for follows / reply_to); cycles terminate safely. Optional " +
    "from_time / to_time filter neighbours by their creation time.",
  // Read-only: traversal only, mutates nothing.
  annotations: {
    title: "Walk the relation graph",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["document_id", "rel_type"],
    properties: {
      document_id: { type: "string", description: "UUID of the starting document" },
      rel_type: { type: "string", description: "The single relation type to traverse" },
      depth: { type: "integer", description: "How many hops to follow (1–5, default 1)" },
      from_time: { type: "string", description: "ISO-8601: only neighbours created on/after" },
      to_time: { type: "string", description: "ISO-8601: only neighbours created on/before" },
      limit: { type: "integer", description: "Max documents to return (default 50, max 200)" },
      requestor: { type: "string", description: "Name of the agent making this request" },
    },
  },
  handler: getNeighborsHandler,
};
