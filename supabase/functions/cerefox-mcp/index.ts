import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * cerefox-mcp — Supabase Edge Function
 *
 * MCP Streamable HTTP server (spec 2025-03-26). Exposes all Cerefox tools
 * over HTTPS -- no Python install, no local process, works from any
 * remote-capable MCP client.
 *
 * Each tool handler lives in tools/*.ts and calls Postgres RPCs directly
 * via the service-role key. No delegation to primitive Edge Functions.
 *
 * Supported clients:
 *   Claude Code    -- claude mcp add --transport http cerefox <url> --header "Authorization: Bearer <anon-key>"
 *   Cursor         -- url + headers.Authorization in mcp.json
 *   Claude Desktop -- npx supergateway --streamableHttp <url> --header "Authorization: Bearer <anon-key>"
 */

import { CORS_HEADERS, jsonResponse, errorResponse, notificationResponse } from "./shared.ts";
import { handleSearch } from "./tools/search.ts";
import { handleIngest } from "./tools/ingest.ts";
import { handleListMetadataKeys } from "./tools/metadata.ts";
import { handleGetDocument } from "./tools/get-document.ts";
import { handleListVersions } from "./tools/list-versions.ts";
import { handleGetAuditLog } from "./tools/audit-log.ts";
import { handleListProjects } from "./tools/list-projects.ts";
import { handleMetadataSearch } from "./tools/metadata-search.ts";

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
      required: ["query", "requestor"],
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
        metadata_filter: {
          type: "object",
          description:
            "Optional JSONB containment filter. Only documents whose metadata contains ALL specified key-value pairs are returned. Example: {\"type\": \"decision\", \"status\": \"active\"}. Call cerefox_list_metadata_keys first to discover available keys and values. Omit to search all documents.",
          additionalProperties: { type: "string" },
        },
        max_bytes: {
          type: "integer",
          description:
            "Optional response size budget in bytes. Results are dropped whole until the budget is satisfied; a truncated flag is set when results are dropped. Defaults to the server maximum (200000). Pass a smaller value if your context window is limited. Values above the server maximum are silently capped.",
        },
        requestor: {
          type: "string",
          description:
            'REQUIRED. Caller identity in "conclave:agent" format (e.g., "personal:steward", "upwork:archivist"). Recorded in the usage log for attribution.',
        },
      },
    },
  },
  {
    name: "cerefox_ingest",
    description: "Save a note or document to the Cerefox knowledge base.",
    inputSchema: {
      type: "object",
      required: ["title", "content", "author"],
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
        author: {
          type: "string",
          description:
            'REQUIRED. Caller identity in "conclave:agent" format (e.g., "personal:steward", "upwork:artificer"). Recorded in the audit log for attribution.',
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
      required: ["requestor"],
      properties: {
        requestor: {
          type: "string",
          description:
            'REQUIRED. Caller identity in "conclave:agent" format (e.g., "personal:steward", "upwork:archivist"). Recorded in the usage log.',
        },
      },
    },
  },
  {
    name: "cerefox_get_document",
    description:
      "Retrieve the full reconstructed content of a document. Pass version_id to retrieve an archived version; omit it (or pass null) for the current version. Version UUIDs are returned by cerefox_list_versions.",
    inputSchema: {
      type: "object",
      required: ["document_id", "requestor"],
      properties: {
        document_id: {
          type: "string",
          description: "UUID of the document to retrieve",
        },
        version_id: {
          type: "string",
          description: "UUID of a specific archived version to retrieve (optional)",
        },
        requestor: {
          type: "string",
          description:
            'REQUIRED. Caller identity in "conclave:agent" format (e.g., "personal:steward", "upwork:archivist"). Recorded in the usage log.',
        },
      },
    },
  },
  {
    name: "cerefox_list_versions",
    description:
      "List all archived versions of a document, newest first. Returns version_id (use with cerefox_get_document), version_number, source, chunk_count, total_chars, and created_at.",
    inputSchema: {
      type: "object",
      required: ["document_id", "requestor"],
      properties: {
        document_id: {
          type: "string",
          description: "UUID of the document whose version history to list",
        },
        requestor: {
          type: "string",
          description:
            'REQUIRED. Caller identity in "conclave:agent" format (e.g., "personal:steward", "upwork:archivist"). Recorded in the usage log.',
        },
      },
    },
  },
  {
    name: "cerefox_get_audit_log",
    description:
      "Retrieve audit log entries showing who changed what and when. Supports filtering by document, author, operation type, and time range. Returns entries with document titles, author attribution, size changes, and descriptions.",
    inputSchema: {
      type: "object",
      required: ["requestor"],
      properties: {
        document_id: {
          type: "string",
          description: "Filter by document UUID (optional)",
        },
        author: {
          type: "string",
          description: "Filter by author name (optional)",
        },
        operation: {
          type: "string",
          description:
            "Filter by operation type: create, update-content, update-metadata, delete, status-change, archive, unarchive (optional)",
        },
        since: {
          type: "string",
          description: "ISO timestamp lower bound for temporal queries (optional)",
        },
        limit: {
          type: "integer",
          description: "Maximum number of entries to return (default: 50, max: 200)",
        },
        requestor: {
          type: "string",
          description:
            'REQUIRED. Caller identity in "conclave:agent" format (e.g., "personal:steward", "upwork:archivist"). Recorded in the usage log.',
        },
      },
    },
  },
  {
    name: "cerefox_list_projects",
    description:
      "List all projects with their names and IDs. Use this to discover available projects before filtering by project_name in other tools.",
    inputSchema: {
      type: "object",
      required: ["requestor"],
      properties: {
        requestor: {
          type: "string",
          description:
            'REQUIRED. Caller identity in "conclave:agent" format (e.g., "personal:steward", "upwork:archivist"). Recorded in the usage log.',
        },
      },
    },
  },
  {
    name: "cerefox_metadata_search",
    description:
      "Find documents by metadata key-value criteria without a text search term. Use to discover documents tagged with specific attributes, browse by taxonomy, or retrieve messages/tasks by type and status.",
    inputSchema: {
      type: "object",
      required: ["metadata_filter", "requestor"],
      properties: {
        metadata_filter: {
          type: "object",
          description:
            "Key-value pairs; ALL must match (AND semantics). Example: {\"type\": \"decision\", \"status\": \"active\"}. Call cerefox_list_metadata_keys first to discover available keys.",
          additionalProperties: { type: "string" },
        },
        project_name: {
          type: "string",
          description: "Restrict to a project by name (optional)",
        },
        updated_since: {
          type: "string",
          description: "ISO-8601 timestamp; only docs updated on/after (optional)",
        },
        created_since: {
          type: "string",
          description: "ISO-8601 timestamp; only docs created on/after (optional)",
        },
        limit: {
          type: "integer",
          description: "Max results (default 10)",
        },
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
            'REQUIRED. Caller identity in "conclave:agent" format (e.g., "personal:steward", "upwork:archivist"). Recorded in the usage log.',
        },
      },
    },
  },
];

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

async function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "cerefox_search": {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) throw new Error("OPENAI_API_KEY secret not set on this project");
      return await handleSearch(args, openaiKey);
    }
    case "cerefox_ingest": {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) throw new Error("OPENAI_API_KEY secret not set on this project");
      return await handleIngest(args, openaiKey);
    }
    case "cerefox_list_metadata_keys":
      return await handleListMetadataKeys(args);
    case "cerefox_get_document":
      return await handleGetDocument(args);
    case "cerefox_list_versions":
      return await handleListVersions(args);
    case "cerefox_get_audit_log":
      return await handleGetAuditLog(args);
    case "cerefox_list_projects":
      return await handleListProjects(args);
    case "cerefox_metadata_search":
      return await handleMetadataSearch(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function handleToolsCall(
  id: unknown,
  params: { name?: string; arguments?: Record<string, unknown> } | undefined,
): Promise<Response> {
  const toolName = params?.name;
  const args = params?.arguments ?? {};

  if (!toolName) {
    return errorResponse(id, -32602, "Invalid params: missing tool name");
  }

  const knownTools = TOOLS.map((t) => t.name);
  if (!knownTools.includes(toolName)) {
    return errorResponse(id, -32602, `Unknown tool: ${toolName}`);
  }

  // Require caller attribution: "requestor" for read tools, "author" for ingest
  const identityParam = toolName === "cerefox_ingest" ? "author" : "requestor";
  const identityValue = args[identityParam];
  if (!identityValue || (typeof identityValue === "string" && identityValue.trim() === "")) {
    return errorResponse(
      id,
      -32602,
      `Missing required parameter "${identityParam}". All cerefox calls must identify the caller in "conclave:agent" format (e.g., "personal:steward", "upwork:archivist").`,
    );
  }

  try {
    const text = await dispatchToolCall(toolName, args);
    return jsonResponse({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text }] },
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

  // GET -- health check for MCP clients that probe before connecting
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
    return new Response("Method Not Allowed", { status: 405, headers: CORS_HEADERS });
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
