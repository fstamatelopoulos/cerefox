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
 * Tool surface (v0.4.0): 10 tools.
 */

import { auditLogTool } from "./audit-log.ts";
import { getDocumentTool } from "./get-document.ts";
import { getHelpTool } from "./get-help.ts";
import { ingestTool } from "./ingest.ts";
import { listMetadataKeysTool } from "./list-metadata-keys.ts";
import { listProjectsTool } from "./list-projects.ts";
import { listVersionsTool } from "./list-versions.ts";
import { metadataSearchTool } from "./metadata-search.ts";
import { searchTool } from "./search.ts";
import { setDocumentProjectsTool } from "./set-document-projects.ts";
import type { ToolDefinition } from "./types.ts";

/** All Cerefox MCP tools, in canonical order (matches AGENT_QUICK_REFERENCE.md). */
export const ALL_TOOLS: ToolDefinition[] = [
  searchTool,
  ingestTool,
  getDocumentTool,
  listVersionsTool,
  metadataSearchTool,
  listMetadataKeysTool,
  listProjectsTool,
  setDocumentProjectsTool,
  auditLogTool,
  getHelpTool,
];

/** Build a name → definition map for fast dispatch. */
export const TOOLS_BY_NAME: Record<string, ToolDefinition> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t]),
);

export { McpInvalidParams } from "./types.ts";
export type { JsonSchema, ToolContext, ToolDefinition } from "./types.ts";
