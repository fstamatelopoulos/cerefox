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

/** Structural type for the Supabase client surface the handlers actually
 *  use (`.rpc()` + `.from()`). We deliberately don't `import { SupabaseClient }
 *  from "@supabase/supabase-js"` here because Bun workspaces install a
 *  separate copy of supabase-js into each workspace member, and TypeScript
 *  then sees two distinct (but structurally identical) `SupabaseClient`
 *  classes. Decoupling the shared module with a minimal structural type
 *  side-steps the duplicate-class problem and keeps the shared modules
 *  truly runtime-neutral. */
// deno-lint-ignore no-explicit-any
type AnyChain = any;

export interface MCPSupabaseClient {
  rpc<T = unknown>(fn: string, params?: Record<string, unknown>): AnyChain;
  from(table: string): AnyChain;
}

/** Re-export an alias name so callers can use the descriptive name. */
export type SupabaseClient = MCPSupabaseClient;

/** JSON Schema fragment for tool inputs. We use a permissive `unknown` value
 *  type rather than a strict JSON-Schema TS type to avoid forcing every tool
 *  to maintain a type-perfect schema literal. */
export type JsonSchema = Record<string, unknown>;

/**
 * Logical channel through which a Cerefox operation reached the backend.
 * Recorded in `cerefox_usage_log.access_path` so the analytics dashboard
 * can attribute load to each surface.
 *
 * Values:
 *   - `remote-mcp`  — `cerefox-mcp` Edge Function (HTTP MCP transport).
 *   - `local-mcp`   — `@cerefox/memory`'s `cerefox-mcp` stdio bin.
 *   - `cli`         — the `cerefox` CLI bin (v0.5+). Mirrors the
 *                     Python CLI's `access_path = "cli"`.
 *
 * Adding a new channel here also requires updating
 * `cerefox_usage_log.access_path`'s documented domain (no DB CHECK exists —
 * verified in review; the column is free text and this type is the guard).
 */
// The documented access_path domain (CLAUDE.md → usage tracking) — the type
// had lagged at the three MCP-era values while webapp/edge-function callers
// logged through wider-typed wrappers.
export type AccessPath = "remote-mcp" | "local-mcp" | "cli" | "webapp" | "edge-function";

export interface ToolContext {
  /** OpenAI/Fireworks API key for tools that need to embed (search, ingest).
   *  Resolved by the consumer (EF: `Deno.env.get("OPENAI_API_KEY")`;
   *  local: `Settings.openaiApiKey`). */
  openaiApiKey?: string;
  /** Identifies the wire path the call came in on. Recorded in
   *  `cerefox_usage_log.access_path`. */
  accessPath: AccessPath;
}

/**
 * MCP tool annotations (spec revision 2025-03-26).
 *
 * Hints that let a client reason about a tool BEFORE calling it. Without them a
 * tool inherits the spec defaults `readOnlyHint: false` and
 * `destructiveHint: true` — i.e. "may do something irreversible" — so declaring
 * nothing tells every client that `cerefox_search` is as dangerous as a
 * destructive write. The usual result is that users blanket-approve the server,
 * which drains the meaning from the prompt on the tools that genuinely warrant
 * one.
 *
 * These are hints from a server the client may not trust, so a client must not
 * use them as a security boundary. They exist to inform UX, not to enforce it.
 */
export interface ToolAnnotations {
  /** Human-readable label for UIs. */
  title?: string;
  /** The tool does not modify anything. */
  readOnlyHint?: boolean;
  /** The tool may perform IRREVERSIBLE updates. Only meaningful when the tool
   *  is not read-only. Static per tool: if any argument shape can destroy, the
   *  tool is destructive. */
  destructiveHint?: boolean;
  /** Repeated calls with the same arguments have no additional effect. */
  idempotentHint?: boolean;
  /** The tool reaches external entities (a web search) rather than a closed
   *  domain. False throughout Cerefox: every tool talks to the operator's own
   *  store. */
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** See `ToolAnnotations`. Required in practice: a unit test fails if a tool
   *  omits it, so adding a tool forces the read-only/destructive decision. */
  annotations?: ToolAnnotations;
  /** Returns the MCP `TextContent.text` body. Tools that fail throw; the
   *  consumer's request wrapper translates thrown errors into JSON-RPC
   *  `-32603` (internal error) responses, or `-32602` (invalid params)
   *  when the thrown error is `McpInvalidParams`. */
  handler: (
    supabase: MCPSupabaseClient,
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
