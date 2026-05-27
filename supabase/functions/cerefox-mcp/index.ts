import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * cerefox-mcp — Supabase Edge Function
 *
 * MCP Streamable HTTP server (spec 2025-03-26). Exposes all Cerefox tools
 * over HTTPS — no Python install, no local process, works from any
 * remote-capable MCP client.
 *
 * As of v0.4.0 (iter-22): the per-tool handlers live in `_shared/mcp-tools/`
 * (relative to the repo root) and are imported here verbatim. The new local
 * TS MCP server (`@cerefox/memory`, `packages/memory/`) uses the same
 * modules — single source of truth for tool behaviour across the two
 * transports. This file's only responsibility is the MCP protocol surface
 * (JSON-RPC over HTTP) + Cerefox's identity-enforcement wrapper.
 *
 * Supported clients:
 *   Claude Code    -- claude mcp add --transport http cerefox <url> --header "Authorization: Bearer <anon-key>"
 *   Cursor         -- url + headers.Authorization in mcp.json
 *   Claude Desktop -- npx supergateway --streamableHttp <url> --header "Authorization: Bearer <anon-key>"
 */

import {
  CORS_HEADERS,
  errorResponse,
  jsonResponse,
  makeSupabaseClient,
  notificationResponse,
} from "./shared.ts";
import {
  ALL_TOOLS,
  McpInvalidParams,
  TOOLS_BY_NAME,
  type ToolContext,
} from "../../../_shared/mcp-tools/index.ts";

const MCP_VERSION = "2025-03-26";
const SERVER_NAME = "cerefox";
const SERVER_VERSION = "0.4.0";

// ── Tool list (derived from _shared/mcp-tools/) ─────────────────────────────

const TOOLS = ALL_TOOLS.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

// ── Method handlers ──────────────────────────────────────────────────────────

function handleInitialize(id: unknown): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: MCP_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    },
  });
}

function handleToolsList(id: unknown): Response {
  return jsonResponse({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
}

async function handleToolsCall(
  id: unknown,
  params: { name?: string; arguments?: Record<string, unknown> } | undefined,
): Promise<Response> {
  const toolName = params?.name;
  const args = params?.arguments ?? {};

  if (!toolName) return errorResponse(id, -32602, "Invalid params: missing tool name");

  const tool = TOOLS_BY_NAME[toolName];
  if (!tool) return errorResponse(id, -32602, `Unknown tool: ${toolName}`);

  // Configurable caller identity enforcement.
  // When require_requestor_identity is "true" in cerefox_config, all tool calls
  // must include a requestor (reads) or author (writes) parameter.
  // When requestor_identity_format is set, the value must match the regex.
  const identityParam = toolName === "cerefox_ingest" || toolName === "cerefox_set_document_projects"
    ? "author"
    : "requestor";
  const identityValue = args[identityParam] as string | undefined;

  // deno-lint-ignore no-explicit-any
  const supabase: any = makeSupabaseClient();

  try {
    const { data: requireConfig } = await supabase.rpc("cerefox_get_config", {
      p_key: "require_requestor_identity",
    });
    const requireIdentity = requireConfig === "true";

    if (requireIdentity) {
      if (!identityValue || identityValue.trim() === "") {
        return errorResponse(
          id,
          -32602,
          `Missing required parameter "${identityParam}". Server requires caller identity. ` +
            `Pass "${identityParam}" with your agent name (e.g., "Claude Code", "archiver").`,
        );
      }
      const { data: formatConfig } = await supabase.rpc("cerefox_get_config", {
        p_key: "requestor_identity_format",
      });
      if (formatConfig && typeof formatConfig === "string" && formatConfig.trim() !== "") {
        const formatRegex = new RegExp(formatConfig);
        if (!formatRegex.test(identityValue)) {
          return errorResponse(
            id,
            -32602,
            `Invalid "${identityParam}" format. Value "${identityValue}" does not match ` +
              `required pattern: ${formatConfig}`,
          );
        }
      }
    }
  } catch {
    // Config check failed -- don't block the tool call
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const needsOpenAI = toolName === "cerefox_search" || toolName === "cerefox_ingest";
  if (needsOpenAI && !openaiKey) {
    return errorResponse(id, -32603, "OPENAI_API_KEY secret not set on this project");
  }

  const ctx: ToolContext = {
    accessPath: "remote-mcp",
    openaiApiKey: openaiKey,
  };

  try {
    const text = await tool.handler(supabase, args, ctx);
    return jsonResponse({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text }] },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof McpInvalidParams ? -32602 : -32603;
    return errorResponse(id, code, message);
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  // GET — per MCP spec (2025-03-26), return 405 to indicate this server does
  // not support SSE notifications via GET. Prevents MCP clients from
  // maintaining a persistent SSE polling connection (~1/sec/client).
  if (req.method === "GET") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(null, -32700, "Parse error: invalid JSON");
  }

  const { jsonrpc, id, method, params } = body as {
    jsonrpc?: string;
    id?: unknown;
    method?: string;
    params?: unknown;
  };

  if (jsonrpc !== "2.0") {
    return errorResponse(id ?? null, -32600, "Invalid Request: jsonrpc must be '2.0'");
  }
  if (!method) {
    return errorResponse(id ?? null, -32600, "Invalid Request: missing method");
  }

  switch (method) {
    case "initialize":
      return handleInitialize(id);
    case "initialized":
    case "notifications/initialized":
      return notificationResponse();
    case "ping":
      return jsonResponse({ jsonrpc: "2.0", id, result: {} });
    case "tools/list":
      return handleToolsList(id);
    case "tools/call":
      return await handleToolsCall(
        id,
        params as { name?: string; arguments?: Record<string, unknown> } | undefined,
      );
    default:
      return errorResponse(id ?? null, -32601, `Method not found: ${method}`);
  }
});
