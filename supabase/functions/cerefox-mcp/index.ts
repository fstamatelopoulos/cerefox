import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * cerefox-mcp — Supabase Edge Function
 *
 * MCP Streamable HTTP server (spec 2025-03-26). Exposes the same
 * cerefox_search, cerefox_ingest, and cerefox_list_metadata_keys tools,
 * but over HTTPS — no Python install, no local process, works from any
 * remote-capable MCP client.
 *
 * This is a thin protocol adapter. All business logic lives in the existing
 * cerefox-search, cerefox-ingest, and cerefox-metadata Edge Functions; this
 * function handles the MCP JSON-RPC 2.0 layer only and delegates tool calls
 * via internal fetch().
 *
 * Authentication: Deployed with standard JWT verification (default).
 * Internal calls to cerefox-search/cerefox-ingest forward the caller's
 * Authorization header (validated by the gateway before reaching this code).
 *
 * Supported clients:
 *   Claude Code  — claude mcp add --transport http cerefox <url> --header "Authorization: Bearer <anon-key>"
 *   Cursor       — url + headers.Authorization in mcp.json
 *   Claude Desktop — npx supergateway --streamableHttp <url> --header "Authorization: Bearer <anon-key>"
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

const MCP_VERSION = "2025-03-26";
const SERVER_NAME = "cerefox";
const SERVER_VERSION = "0.1.0";

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "cerefox_search",
    description:
      "Search the Cerefox personal knowledge base. Returns complete documents ranked by hybrid (FTS + semantic) relevance.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Natural-language search query",
        },
        match_count: {
          type: "integer",
          description: "Maximum number of documents to return (default: 5)",
        },
        project_name: {
          type: "string",
          description: "Filter results to a specific project by name (optional)",
        },
      },
    },
  },
  {
    name: "cerefox_ingest",
    description: "Save a note or document to the Cerefox knowledge base.",
    inputSchema: {
      type: "object",
      required: ["title", "content"],
      properties: {
        title: {
          type: "string",
          description: "Document title",
        },
        content: {
          type: "string",
          description: "Markdown content",
        },
        project_name: {
          type: "string",
          description: "Project to assign to (created if absent, optional)",
        },
        source: {
          type: "string",
          description: 'Origin label (default: "agent")',
        },
        update_if_exists: {
          type: "boolean",
          description:
            "When true, update an existing document with the same title instead of creating a new one (default: false)",
        },
        metadata: {
          type: "object",
          description: "Arbitrary JSON metadata (optional)",
        },
      },
    },
  },
  {
    name: "cerefox_list_metadata_keys",
    description:
      "List all metadata keys currently in use across documents in the Cerefox knowledge base. Returns each key with its document count and up to 5 example values.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function errorResponse(id: unknown, code: number, message: string): Response {
  return jsonResponse(
    {
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message },
    },
    200, // MCP errors are still HTTP 200 per spec; the error is in the payload
  );
}

function notificationResponse(): Response {
  // Notifications (no id field) get 202 with empty body
  return new Response(null, {
    status: 202,
    headers: CORS_HEADERS,
  });
}

// ── Method handlers ──────────────────────────────────────────────────────────

function handleInitialize(id: unknown): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: MCP_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    },
  });
}

function handleToolsList(id: unknown): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id,
    result: { tools: TOOLS },
  });
}

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  callerAuth: string,
): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const internalHeaders = {
    "Content-Type": "application/json",
    "Authorization": callerAuth,
  };

  if (name === "cerefox_search") {
    const resp = await fetch(`${supabaseUrl}/functions/v1/cerefox-search`, {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({
        query: args.query,
        match_count: args.match_count ?? 5,
        project_name: args.project_name,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = (data as { error?: string }).error ?? `HTTP ${resp.status}`;
      throw new Error(`cerefox-search error: ${errMsg}`);
    }

    // cerefox-search returns:
    // { results: [...], query, mode, match_count, project_name, truncated, response_bytes }
    // Serialise the full response object so the agent gets structured results.
    const result = data as {
      results: unknown[];
      query: string;
      truncated: boolean;
      response_bytes: number;
      project_name?: string | null;
    };

    if (result.results.length === 0) {
      return "No results found.";
    }

    // Format as markdown — same style as the local stdio MCP server.
    // cerefox_search_docs RPC returns: doc_title, best_score, full_content
    // (not "content" / "score" — those are chunk-level field names).
    const rows = result.results as Array<{
      doc_title?: string;
      full_content?: string;
      best_score?: number;
    }>;

    const parts: string[] = rows.map((row) => {
      const title = row.doc_title ?? "Untitled";
      const score = row.best_score != null ? ` (score: ${row.best_score.toFixed(3)})` : "";
      return `## ${title}${score}\n\n${row.full_content ?? ""}`;
    });

    let output = parts.join("\n\n---\n\n");

    if (result.truncated) {
      output +=
        `\n\n[Results truncated at ${result.response_bytes} bytes. Use a more specific query or a smaller match_count to see more.]`;
    }

    return output;
  }

  if (name === "cerefox_ingest") {
    const resp = await fetch(`${supabaseUrl}/functions/v1/cerefox-ingest`, {
      method: "POST",
      headers: internalHeaders,
      body: JSON.stringify({
        title: args.title,
        content: args.content,
        project_name: args.project_name,
        source: args.source ?? "agent",
        update_if_exists: args.update_if_exists ?? false,
        metadata: args.metadata ?? {},
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = (data as { error?: string }).error ?? `HTTP ${resp.status}`;
      throw new Error(`cerefox-ingest error: ${errMsg}`);
    }

    // cerefox-ingest returns one of:
    //   { document_id, title, chunk_count, total_chars, project_id?, project_name? }  (201 new)
    //   { document_id, title, chunk_count, total_chars, updated: true }               (200 updated)
    //   { document_id, title, skipped: true, message }                                (200 skipped)
    const result = data as {
      document_id: string;
      title: string;
      chunk_count?: number;
      total_chars?: number;
      skipped?: boolean;
      updated?: boolean;
      message?: string;
      project_name?: string | null;
    };

    if (result.skipped) {
      return `Document already up-to-date: "${result.title}" (id: ${result.document_id}). ${result.message ?? ""}`.trim();
    }

    if (result.updated) {
      return `Document updated: "${result.title}" (id: ${result.document_id}), ${result.chunk_count} chunk(s), ${result.total_chars} chars.`;
    }

    const projectInfo = result.project_name ? `, project: "${result.project_name}"` : "";
    return `Document saved: "${result.title}" (id: ${result.document_id}), ${result.chunk_count} chunk(s), ${result.total_chars} chars${projectInfo}.`;
  }

  if (name === "cerefox_list_metadata_keys") {
    const resp = await fetch(`${supabaseUrl}/functions/v1/cerefox-metadata`, {
      method: "POST",
      headers: internalHeaders,
      body: "{}",
    });

    const data = await resp.json();

    if (!resp.ok) {
      const errMsg = (data as { error?: string }).error ?? `HTTP ${resp.status}`;
      throw new Error(`cerefox-metadata error: ${errMsg}`);
    }

    const keys = data as Array<{ key: string; doc_count: number; example_values: string[] }>;

    if (keys.length === 0) {
      return "No metadata keys found across documents.";
    }

    return JSON.stringify(keys, null, 2);
  }

  throw new Error(`Unknown tool: ${name}`);
}

async function handleToolsCall(
  id: unknown,
  params: { name?: string; arguments?: Record<string, unknown> } | undefined,
  callerAuth: string,
): Promise<Response> {
  const toolName = params?.name;
  const args = params?.arguments ?? {};

  if (!toolName) {
    return errorResponse(id, -32602, "Invalid params: missing tool name");
  }

  const knownTools = ["cerefox_search", "cerefox_ingest", "cerefox_list_metadata_keys"];
  if (!knownTools.includes(toolName)) {
    return errorResponse(id, -32602, `Unknown tool: ${toolName}`);
  }

  try {
    const text = await handleToolCall(toolName, args, callerAuth);
    return jsonResponse({
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text }],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(id, -32603, message);
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  // GET — health check for MCP clients that probe before connecting.
  // Some clients (e.g., Perplexity) send a GET before POSTing the MCP handshake.
  if (req.method === "GET") {
    return jsonResponse({
      name: SERVER_NAME,
      version: SERVER_VERSION,
      protocol: "mcp",
      protocolVersion: MCP_VERSION,
      status: "ok",
    });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  // ── Parse JSON-RPC body ───────────────────────────────────────────────────
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

  // ── Method dispatch ───────────────────────────────────────────────────────
  switch (method) {
    case "initialize":
      return handleInitialize(id);

    case "initialized":
    case "notifications/initialized":
      // Notifications have no id; respond with 202 empty body
      return notificationResponse();

    case "ping":
      return jsonResponse({ jsonrpc: "2.0", id, result: {} });

    case "tools/list":
      return handleToolsList(id);

    case "tools/call": {
      const callerAuth = req.headers.get("Authorization") ?? "";
      return await handleToolsCall(
        id,
        params as { name?: string; arguments?: Record<string, unknown> } | undefined,
        callerAuth,
      );
    }

    default:
      return errorResponse(id ?? null, -32601, `Method not found: ${method}`);
  }
});
