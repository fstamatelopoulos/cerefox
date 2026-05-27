/**
 * Cerefox local stdio MCP server.
 *
 * Wires `_shared/mcp-tools/ALL_TOOLS` into an
 * `@modelcontextprotocol/sdk` stdio server. The handlers themselves are
 * shared 1:1 with the remote `cerefox-mcp` Edge Function via
 * `_shared/mcp-tools/`; only the wire transport differs (stdio here,
 * HTTP-framed JSON-RPC there).
 *
 * Configuration is loaded via `_shared/config/loadSettings()` — same
 * precedence as the Python CLI (CEREFOX_CONFIG_DIR env > ./.env in cwd
 * > ~/.cerefox/.env). The MCP server runs as a long-lived process
 * spawned by an MCP client (Claude Code, Cursor, Claude Desktop), so
 * env discovery happens once at boot.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadSettings } from "../../../_shared/config/index.ts";
import {
  ALL_TOOLS,
  McpInvalidParams,
  TOOLS_BY_NAME,
  type ToolContext,
} from "../../../_shared/mcp-tools/index.ts";
import { PKG_VERSION } from "./meta.ts";

// Bun workspaces install a separate copy of @supabase/supabase-js into each
// member's node_modules. The runtime instances are structurally identical
// but TypeScript treats them as distinct classes (the parameterised
// `Database` generic isn't shared across the two type declarations).
// We cast at the boundary; the handlers in `_shared/mcp-tools/` use only
// `.rpc()` and `.from()` which are present on both.
type SharedSupabaseClient = Parameters<
  (typeof ALL_TOOLS)[number]["handler"]
>[0];

/** Resolved at module-load time so `--version` works without DB. */
const SERVER_NAME = "cerefox";

export interface ServerHandle {
  /** Start the stdio transport and block until the parent closes stdin. */
  run(): Promise<void>;
}

export function buildServer(): ServerHandle {
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    throw new Error(
      "Cerefox MCP server: CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY must be set " +
        "in your .env (resolved via CEREFOX_CONFIG_DIR env > ./.env > ~/.cerefox/.env).",
    );
  }

  const supabase = createClient(settings.supabaseUrl, settings.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SharedSupabaseClient & SupabaseClient;

  // Best-effort startup schema-version check (per iter-22 refinement #5).
  // Closes the v0.1.19 redeploy footgun for the local MCP path the same way
  // the web UI banner closes it. Doesn't refuse to serve on mismatch —
  // that'd kill agents mid-session.
  void warnIfSchemaVersionMismatch(supabase);

  const ctx: ToolContext = {
    accessPath: "local-mcp",
    openaiApiKey: settings.openaiApiKey || undefined,
  };

  const server = new Server(
    { name: SERVER_NAME, version: PKG_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: ALL_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    const tool = TOOLS_BY_NAME[name];
    if (!tool) {
      // Match EF error code: -32602 (invalid params) for unknown tool name.
      throw new McpInvalidParams(`Unknown tool: ${name}`);
    }
    try {
      const text = await tool.handler(supabase, args, ctx);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      // Re-throw; the SDK turns McpInvalidParams into -32602 and other
      // errors into -32603 via its default error handling.
      if (err instanceof McpInvalidParams) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  });

  return {
    async run() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      // The SDK keeps the process alive while transport is open. Returns
      // when the parent MCP client closes stdin.
    },
  };
}

async function warnIfSchemaVersionMismatch(
  supabase: SharedSupabaseClient,
): Promise<void> {
  try {
    const { data } = await supabase.rpc("cerefox_schema_version");
    const deployed = typeof data === "string" ? data : null;
    if (deployed && deployed !== PKG_VERSION) {
      // Match the Python schema-mismatch banner's wording so operators get a
      // consistent signal regardless of which surface noticed first.
      process.stderr.write(
        `[cerefox-mcp] ⚠  schema version mismatch: bundled ${PKG_VERSION}, ` +
          `deployed ${deployed}. Run \`uv run python scripts/db_deploy.py\` ` +
          `to update the database. Tools may behave unexpectedly until then.\n`,
      );
    }
  } catch {
    // Helper RPC missing on legacy deployments → silently skip. Same logic
    // as _shared/db-status/ uses for the introspection check.
  }
}
