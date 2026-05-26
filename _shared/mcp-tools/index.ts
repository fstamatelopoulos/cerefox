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
 * Tool surface (v0.4.0): 9 tools.
 */

import { auditLogTool } from "./audit-log.js";
import { getDocumentTool } from "./get-document.js";
import { getHelpTool } from "./get-help.js";
import { ingestTool } from "./ingest.js";
import { listMetadataKeysTool } from "./list-metadata-keys.js";
import { listProjectsTool } from "./list-projects.js";
import { listVersionsTool } from "./list-versions.js";
import { metadataSearchTool } from "./metadata-search.js";
import { searchTool } from "./search.js";
import { setDocumentProjectsTool } from "./set-document-projects.js";
import type { ToolDefinition } from "./types.js";

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

export { McpInvalidParams } from "./types.js";
export type { JsonSchema, ToolContext, ToolDefinition } from "./types.js";
