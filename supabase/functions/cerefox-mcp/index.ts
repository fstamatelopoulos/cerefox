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
  buildAuthenticator,
  isProtectedResourceMetadata,
  protectedResourceMetadata,
  unauthorizedChallenge,
} from "./oauth.ts";
import type { AuthResult, McpAuthenticator } from "../../../_shared/mcp-auth/index.ts";
import type { MCPSupabaseClient } from "../../../_shared/mcp-tools/types.ts";
import { checkAccessToken, parseAccessTokens } from "../../../_shared/ef-auth/index.ts";
import {
  ALL_TOOLS,
  McpInvalidParams,
  TOOLS_BY_NAME,
  type ToolContext,
  assertToolEnabled,
  listEnabledTools,
} from "../../../_shared/mcp-tools/index.ts";
import {
  type AggregatedVersions,
  EF_VERSION,
  isVersionRequest,
  PEER_EF_NAMES,
  peerVersionUrl,
  versionResponse,
  wantsPeers,
} from "../../../_shared/ef-meta/index.ts";

const MCP_VERSION = "2025-03-26";
const SERVER_NAME = "cerefox";
const SERVER_VERSION = "0.4.0";

// ── Tool list (derived from _shared/mcp-tools/) ─────────────────────────────

// Built per request rather than at module load: the tool surface depends on
// deployment config (optional features are hidden until enabled), and an
// isolate can outlive a config change.
async function buildToolList(supabase: MCPSupabaseClient) {
  return (await listEnabledTools(supabase)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    // MCP 2025-03-26 tool annotations; MCP_VERSION already declares that revision.
    ...(t.annotations ? { annotations: t.annotations } : {}),
  }));
}

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

async function handleToolsList(id: unknown, supabase: MCPSupabaseClient): Promise<Response> {
  return jsonResponse({ jsonrpc: "2.0", id, result: { tools: await buildToolList(supabase) } });
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

  // Optional features: a session that listed tools before the flag changed can
  // still name a gated tool.
  try {
    await assertToolEnabled(supabase, toolName);
  } catch (err) {
    return errorResponse(id, -32602, err instanceof Error ? err.message : String(err));
  }

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
    // Tool failures are RESULTS, not protocol errors — same rule as the local
    // stdio server (packages/memory/src/server.ts), and for the same reason:
    // a client may render a JSON-RPC error however it likes, and at least one
    // major one replaces the body with a generic failure dialog. The message is
    // the actionable part; it has to travel where the model can read it.
    // Protocol errors above this point (unknown tool, bad JSON) are unchanged.
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: message }], isError: true },
    });
  }
}

// ── Version surface (iter-26 Part 26B) ───────────────────────────────────────

const JSON_HEADERS = { ...CORS_HEADERS, "Content-Type": "application/json" };

/** Overall budget for the peer-version aggregator. */
const AGGREGATOR_BUDGET_MS = 5_000;
/** Per-peer request timeout (so one slow peer can't eat the whole budget). */
const PEER_TIMEOUT_MS = 2_000;

async function handleVersion(req: Request): Promise<Response> {
  // Single-EF version unless ?peers=true requests the aggregator.
  if (!wantsPeers(req)) {
    return versionResponse("cerefox-mcp", JSON_HEADERS);
  }

  const result: AggregatedVersions = {
    name: "cerefox-mcp",
    version: EF_VERSION,
    schema: null,
    efs: [],
    errors: [],
  };

  // Deployed Postgres schema version (best-effort; null on failure).
  try {
    // deno-lint-ignore no-explicit-any
    const supabase: any = makeSupabaseClient();
    const { data } = await supabase.rpc("cerefox_schema_version");
    if (typeof data === "string") result.schema = data;
  } catch {
    // leave schema null
  }

  // Probe peers sequentially within an overall budget. Forward the caller's
  // auth so the gateway lets each peer request through.
  const authHeader = req.headers.get("Authorization") ?? "";
  const apikeyHeader = req.headers.get("apikey") ?? "";
  const deadline = Date.now() + AGGREGATOR_BUDGET_MS;

  for (const peer of PEER_EF_NAMES) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      result.errors.push({ name: peer, error: "skipped (5s budget exhausted)" });
      continue;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.min(remaining, PEER_TIMEOUT_MS));
      let resp: Response;
      try {
        resp = await fetch(peerVersionUrl(req.url, peer), {
          method: "GET",
          headers: { Authorization: authHeader, apikey: apikeyHeader },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) {
        result.errors.push({ name: peer, error: `HTTP ${resp.status}` });
        continue;
      }
      const payload = (await resp.json()) as { version?: string };
      result.efs.push({ name: peer, version: payload.version ?? "unknown" });
    } catch (err) {
      result.errors.push({
        name: peer,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(JSON.stringify(result), { status: 200, headers: JSON_HEADERS });
}

// ── Main handler ─────────────────────────────────────────────────────────────

// Isolate-lifetime authenticator (holds the JWKS cache). Issuer/JWKS come from the
// injected SUPABASE_URL (not request headers — see oauth.ts projectOrigin).
let authenticator: McpAuthenticator | null = null;
function getAuthenticator(): McpAuthenticator {
  if (!authenticator) authenticator = buildAuthenticator();
  return authenticator;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  // Public discovery route (RFC 9728): the ONLY unauthenticated non-OPTIONS
  // response. Served before auth so OAuth clients can bootstrap.
  if (req.method === "GET" && isProtectedResourceMetadata(req)) {
    return protectedResourceMetadata();
  }

  // ── Auth-first dispatch (design §6) ────────────────────────────────────────
  // The function is deployed with --no-verify-jwt, so this in-function check is
  // the ONLY gate. Accept EITHER a Cerefox access token (the static path — same
  // credential the primitive EFs take, iter-28E) OR a valid OAuth JWT.
  const authHeader = req.headers.get("Authorization");
  let authResult: AuthResult;
  // Static token first (cheap constant-time compare). A real OAuth JWT won't match
  // any token, so it falls through to the JWKS path below — no false rejection.
  const tokenResult = checkAccessToken(authHeader, {
    tokens: parseAccessTokens(Deno.env.get("CEREFOX_ACCESS_TOKENS")),
  });
  if (tokenResult.ok) {
    authResult = { ok: true, path: "static" };
  } else {
    authResult = await getAuthenticator().authenticate(authHeader);
  }
  if (!authResult.ok) {
    // Log the machine reason (never the token) so the dashboard logs are
    // actionable on a real auth failure. `no_token` is the normal OAuth-discovery
    // probe (every cloud client sends one first) — don't log it as noise. The
    // enriched detail (aud/sub/alg values from _shared/mcp-auth) names which claim
    // a rejected token tripped. To debug a "Claude never sends the token" case
    // (claude-ai #482), temporarily also log `Array.from(req.headers.keys())`.
    if (authResult.reason !== "no_token") {
      console.warn(
        `[cerefox-mcp] auth rejected: ${authResult.reason}` +
          (authResult.detail ? ` (${authResult.detail})` : ""),
      );
    }
    return unauthorizedChallenge(authResult);
  }

  // GET — the only supported GET is the /version surface (iter-26). Per MCP
  // spec (2025-03-26) this server otherwise returns 405 on GET to signal it
  // does not support SSE notifications (prevents MCP clients from holding a
  // persistent ~1/sec polling connection).
  if (req.method === "GET") {
    if (isVersionRequest(req)) {
      return await handleVersion(req);
    }
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
      // deno-lint-ignore no-explicit-any
      return await handleToolsList(id, makeSupabaseClient() as any);
    case "tools/call":
      return await handleToolsCall(
        id,
        params as { name?: string; arguments?: Record<string, unknown> } | undefined,
      );
    default:
      return errorResponse(id ?? null, -32601, `Method not found: ${method}`);
  }
});
