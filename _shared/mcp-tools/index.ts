/**
 * `_shared/mcp-tools/` — runtime-neutral MCP tool handlers.
 *
 * Single source of truth for the Cerefox MCP tool surface. Imported by:
 * - `supabase/functions/cerefox-mcp/index.ts` (Deno; HTTP transport).
 * - `packages/memory/src/server.ts` (Bun/Node; stdio transport).
 *
 * Adding a new tool: write `<name>.ts` exporting a `ToolDefinition`, then
 * add it to `ALL_TOOLS` below. Both consumers pick it up automatically.
 *
 * Tool surface: 16 tools (12 core + 4 dormant relation tools).
 */

import { auditLogTool } from "./audit-log.ts";
import {
  disabledToolMessage,
  relationsEnabled,
  RELATION_TOOL_NAMES,
} from "./feature-flags.ts";
import {
  deleteRelationTool,
  getNeighborsTool,
  getRelationsTool,
  setRelationTool,
} from "./relations.ts";
import { getDocumentTool } from "./get-document.ts";
import { getHelpTool } from "./get-help.ts";
import { ingestTool } from "./ingest.ts";
import { editTool, insertTool } from "./partial-edits.ts";
import { listMetadataKeysTool } from "./list-metadata-keys.ts";
import { listProjectsTool } from "./list-projects.ts";
import { listVersionsTool } from "./list-versions.ts";
import { metadataSearchTool } from "./metadata-search.ts";
import { searchTool } from "./search.ts";
import { setDocumentMetadataTool } from "./set-document-metadata.ts";
import { setDocumentProjectsTool } from "./set-document-projects.ts";
import { McpInvalidParams, type MCPSupabaseClient, type ToolDefinition } from "./types.ts";

/** All Cerefox MCP tools, in canonical order (matches AGENT_QUICK_REFERENCE.md). */
export const ALL_TOOLS: ToolDefinition[] = [
  searchTool,
  ingestTool,
  // Partial edits (iteration 34): add to / change parts of a document without
  // resending it. Split by safety boundary — insert cannot destroy content, so
  // a client can grant it freely; edit carries the destructive operations.
  insertTool,
  editTool,
  getDocumentTool,
  listVersionsTool,
  metadataSearchTool,
  listMetadataKeysTool,
  listProjectsTool,
  setDocumentMetadataTool,
  setDocumentProjectsTool,
  auditLogTool,
  // Document relations (iteration 29): the graph surface.
  setRelationTool,
  deleteRelationTool,
  getRelationsTool,
  getNeighborsTool,
  getHelpTool,
];

/**
 * The tools an agent should SEE, given deployment config. Optional features are
 * hidden until enabled (see feature-flags.ts) — a tool an agent can see is a
 * tool an agent may use, so "dormant" has to mean invisible, not just unused.
 */
export async function listEnabledTools(
  supabase: MCPSupabaseClient,
): Promise<ToolDefinition[]> {
  const relations = await relationsEnabled(supabase);
  return ALL_TOOLS.filter((t) => relations || !RELATION_TOOL_NAMES.has(t.name));
}

/**
 * Guard for the call path: a session that listed tools before the flag changed
 * (or a hand-written client) can still name a gated tool.
 */
export async function assertToolEnabled(
  supabase: MCPSupabaseClient,
  name: string,
): Promise<void> {
  if (!RELATION_TOOL_NAMES.has(name)) return;
  if (await relationsEnabled(supabase)) return;
  throw new McpInvalidParams(disabledToolMessage(name));
}

/** Build a name → definition map for fast dispatch. */
export const TOOLS_BY_NAME: Record<string, ToolDefinition> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);

export { McpInvalidParams } from "./types.ts";
export type {
  AccessPath,
  JsonSchema,
  ToolContext,
  ToolDefinition,
} from "./types.ts";

// Re-export individual tools so non-MCP consumers (e.g. the v0.5 CLI's
// `ingest` / `delete-doc` commands) can call a specific handler directly
// without going through ALL_TOOLS dispatch.
export {
  auditLogTool,
  getDocumentTool,
  getHelpTool,
  ingestTool,
  listMetadataKeysTool,
  listProjectsTool,
  listVersionsTool,
  metadataSearchTool,
  searchTool,
  setDocumentMetadataTool,
  setDocumentProjectsTool,
};
