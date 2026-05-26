/**
 * Shared MCP tool-handler contract.
 *
 * Each `cerefox_*` tool is a `ToolDefinition` exporting:
 * - `name` — MCP tool name (e.g. `cerefox_search`).
 * - `description` — single-paragraph description shown to agents.
 * - `inputSchema` — JSON Schema for the tool's `arguments` object.
 * - `handler(supabase, args, ctx)` — async function returning the MCP
 *   `TextContent` body as a string.
 *
 * The same `ToolDefinition`s are wired into both:
 * - The remote `cerefox-mcp` Edge Function (Deno; HTTP-framed JSON-RPC).
 * - The local `@cerefox/memory` stdio MCP server (Bun/Node; stdio-framed).
 *
 * Wiring code (request dispatch, framing, identity enforcement) lives in
 * each consumer; the handlers themselves are runtime-agnostic.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** JSON Schema fragment for tool inputs. We use a permissive `unknown` value
 *  type rather than a strict JSON-Schema TS type to avoid forcing every tool
 *  to maintain a type-perfect schema literal. */
export type JsonSchema = Record<string, unknown>;

export interface ToolContext {
  /** OpenAI/Fireworks API key for tools that need to embed (search, ingest).
   *  Resolved by the consumer (EF: `Deno.env.get("OPENAI_API_KEY")`;
   *  local: `Settings.openaiApiKey`). */
  openaiApiKey?: string;
  /** Identifies the wire path the call came in on. Recorded in
   *  `cerefox_usage_log.access_path`. */
  accessPath: "remote-mcp" | "local-mcp";
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Returns the MCP `TextContent.text` body. Tools that fail throw; the
   *  consumer's request wrapper translates thrown errors into JSON-RPC
   *  `-32603` (internal error) responses, or `-32602` (invalid params)
   *  when the thrown error is `McpInvalidParams`. */
  handler: (
    supabase: SupabaseClient,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<string>;
}

/** Typed `Error` subclass for input-validation failures. Consumers translate
 *  this into JSON-RPC `-32602` (invalid params). Plain `Error`s become
 *  `-32603` (internal). */
export class McpInvalidParams extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpInvalidParams";
  }
}
