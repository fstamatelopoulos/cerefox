/**
 * E2E tests for the remote cerefox-mcp Edge Function via raw JSON-RPC 2.0
 * (iter-26 Part 26H — TS port of tests/e2e/test_mcp_e2e.py).
 *
 * Talks to the deployed cerefox-mcp over HTTP with no MCP SDK, so protocol
 * failures are unambiguously the EF's. Probe-and-skip when Supabase / the
 * anon JWT is unavailable. Created docs are [E2E-MCP]-prefixed and
 * hard-deleted in afterAll via the service client.
 */

import { afterAll, describe, expect, test } from "bun:test";

import { loadSettings } from "../../../../_shared/config/index.ts";
import { createClient } from "../../../../_shared/db-client/index.ts";

const E2E_PREFIX = "[E2E-MCP]";
const SAMPLE_CONTENT = `# The Sunken Archives

The Sunken Archives lie beneath the tidal city of Mirelpath, holding records
no surface library dares keep. Scholars descend by bell-cage to consult them.
`;

function uniqueTitle(label: string): string {
  return `${E2E_PREFIX} ${label} ${crypto.randomUUID().slice(0, 8)}`;
}
function uniqueContent(): string {
  return `${SAMPLE_CONTENT}\n<!-- e2e-marker ${crypto.randomUUID()} -->\n`;
}

const settings = loadSettings();
const anonKey =
  settings.supabaseAnonKey ||
  (settings.supabaseKey.startsWith("eyJ") ? settings.supabaseKey : "");
const mcpUrl = settings.supabaseUrl
  ? `${settings.supabaseUrl.replace(/\/$/, "")}/functions/v1/cerefox-mcp`
  : "";

let reqId = 0;

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: unknown;
  result?: any;
  error?: { code: number; message: string };
}

async function rpc(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
  const body: Record<string, unknown> = { jsonrpc: "2.0", id: ++reqId, method };
  if (params !== undefined) body.params = params;
  const resp = await fetch(mcpUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await resp.json()) as JsonRpcResponse;
}

function tool(name: string, args: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
  return rpc("tools/call", { name, arguments: args });
}

/** Call a tool and return its text content. Throws on a JSON-RPC error. */
async function toolText(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const resp = await tool(name, args);
  if (resp.error) throw new Error(`MCP error: ${JSON.stringify(resp.error)}`);
  return resp.result.content[0].text as string;
}

function extractId(text: string): string | null {
  const m = text.match(/\(id:\s*([0-9a-f-]{36})\)/i);
  return m ? m[1] : null;
}

// Opt-in gate: these tests hit the live cerefox-mcp Edge Function (free-tier
// quota). Skipped unless CEREFOX_LIVE_E2E=1, checked BEFORE the probe so a
// default `bun test` makes ZERO Edge Function calls. See the EF e2e suite for
// the rationale; run both with the same flag.
const E2E_ENABLED = process.env.CEREFOX_LIVE_E2E === "1";

// Probe: a tools/list handshake confirms the EF is reachable.
let LIVE_OK = false;
if (E2E_ENABLED && anonKey && mcpUrl) {
  try {
    const resp = await rpc("tools/list");
    LIVE_OK = !resp.error && Array.isArray(resp.result?.tools);
  } catch {
    LIVE_OK = false;
  }
}

const createdIds: string[] = [];
function track(id: unknown): void {
  if (typeof id === "string") createdIds.push(id);
}

describe("cerefox-mcp remote (JSON-RPC over HTTP)", () => {
  if (!E2E_ENABLED) {
    test.skip("opt-in only — set CEREFOX_LIVE_E2E=1 to run (hits live EFs; consumes free-tier quota)", () => {});
    return;
  }
  if (!LIVE_OK) {
    test.skip("Supabase / anon JWT not available — skipping MCP-remote e2e", () => {});
    return;
  }

  afterAll(async () => {
    try {
      const client = createClient(settings);
      for (const id of createdIds) {
        await client.raw.from("cerefox_documents").delete().eq("id", id);
      }
    } catch {
      // best-effort; [E2E-MCP]-prefixed leftovers are purgeable.
    }
  });

  // ── Protocol ────────────────────────────────────────────────────────────
  describe("protocol", () => {
    test("bare GET returns 405 (no SSE)", async () => {
      const resp = await fetch(mcpUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${anonKey}` },
      });
      expect(resp.status).toBe(405);
    });

    test("initialize returns protocolVersion + serverInfo", async () => {
      const resp = await rpc("initialize");
      expect(resp.error).toBeUndefined();
      expect(typeof resp.result.protocolVersion).toBe("string");
      expect(resp.result.serverInfo.name).toBe("cerefox");
    });

    test("tools/list returns all 10 tools with schemas", async () => {
      const resp = await rpc("tools/list");
      expect(resp.error).toBeUndefined();
      const names = new Set((resp.result.tools as Array<{ name: string }>).map((t) => t.name));
      const expected = [
        "cerefox_search",
        "cerefox_ingest",
        "cerefox_list_metadata_keys",
        "cerefox_get_document",
        "cerefox_list_versions",
        "cerefox_get_audit_log",
        "cerefox_list_projects",
        "cerefox_metadata_search",
        "cerefox_set_document_projects",
        "cerefox_get_help",
      ];
      for (const name of expected) expect(names.has(name)).toBe(true);
      expect(names.size).toBe(expected.length);
      for (const t of resp.result.tools as Array<Record<string, unknown>>) {
        expect(t).toHaveProperty("inputSchema");
        expect(t).toHaveProperty("description");
      }
    });

    test("ping returns empty result", async () => {
      const resp = await rpc("ping");
      expect(resp.error).toBeUndefined();
      expect(resp.result).toEqual({});
    });

    test("unknown method → -32601", async () => {
      const resp = await rpc("tools/unknown_method");
      expect(resp.error?.code).toBe(-32601);
    });

    test("unknown tool → -32602", async () => {
      const resp = await tool("cerefox_nonexistent_tool", {});
      expect(resp.error?.code).toBe(-32602);
    });
  });

  // ── Tool calls ────────────────────────────────────────────────────────────
  describe("tool calls", () => {
    test("cerefox_ingest creates a document", async () => {
      const text = await toolText("cerefox_ingest", {
        title: uniqueTitle("Ingest"),
        content: uniqueContent(),
        author: "e2e-mcp-test",
      });
      expect(/Document saved|Document updated|up-to-date/.test(text)).toBe(true);
      track(extractId(text));
    });

    test("cerefox_search finds an ingested document", async () => {
      const title = uniqueTitle("Search Find");
      const ing = await toolText("cerefox_ingest", {
        title,
        content: uniqueContent(),
        author: "e2e-mcp-test",
      });
      track(extractId(ing));
      const text = await toolText("cerefox_search", { query: "Sunken Archives Mirelpath", match_count: 5 });
      expect(text).not.toBe("No results found.");
    });

    test("update_if_exists → up-to-date on identical re-ingest", async () => {
      const title = uniqueTitle("Update Dedup");
      const content = uniqueContent();
      const t1 = await toolText("cerefox_ingest", {
        title,
        content,
        update_if_exists: true,
        author: "e2e-mcp-test",
      });
      track(extractId(t1));
      const t2 = await toolText("cerefox_ingest", {
        title,
        content,
        update_if_exists: true,
        author: "e2e-mcp-test",
      });
      expect(/up-to-date|unchanged/i.test(t2)).toBe(true);
    });

    test("cerefox_get_document returns content", async () => {
      const title = uniqueTitle("Get Doc");
      const t1 = await toolText("cerefox_ingest", { title, content: uniqueContent(), author: "e2e-mcp-test" });
      const docId = extractId(t1)!;
      track(docId);
      const text = await toolText("cerefox_get_document", { document_id: docId });
      expect(text).not.toContain("Document not found");
      expect(text.includes("Sunken Archives") || text.includes(title)).toBe(true);
    });

    test("cerefox_get_document not-found message", async () => {
      const text = await toolText("cerefox_get_document", { document_id: crypto.randomUUID() });
      expect(text).toBe("Document not found.");
    });

    test("cerefox_list_versions returns a versions message", async () => {
      const title = uniqueTitle("List Versions");
      const t1 = await toolText("cerefox_ingest", { title, content: uniqueContent(), author: "e2e-mcp-test" });
      const docId = extractId(t1)!;
      track(docId);
      const text = await toolText("cerefox_list_versions", { document_id: docId });
      expect(/No archived versions|Archived versions/.test(text)).toBe(true);
    });

    test("cerefox_get_audit_log filters by author", async () => {
      const author = `e2e-mcp-author-${crypto.randomUUID().slice(0, 8)}`;
      const t1 = await toolText("cerefox_ingest", {
        title: uniqueTitle("Audit Author"),
        content: uniqueContent(),
        author,
      });
      track(extractId(t1));
      const text = await toolText("cerefox_get_audit_log", { author, limit: 50 });
      expect(text).not.toContain("No audit log entries");
      expect(text).toContain(author);
    });

    test("cerefox_list_metadata_keys returns keys or empty message", async () => {
      const text = await toolText("cerefox_list_metadata_keys", {});
      expect(text === "No metadata keys found across documents." || text.startsWith("[")).toBe(true);
    });

    test("missing required param → -32602", async () => {
      const resp = await tool("cerefox_search", {});
      expect(resp.error?.code).toBe(-32602);
    });

    test("ingest missing content → -32602", async () => {
      const resp = await tool("cerefox_ingest", { title: "No Content" });
      expect(resp.error?.code).toBe(-32602);
    });
  });

  // ── v0.1.20 / 16B new tools ────────────────────────────────────────────────
  describe("list-projects / metadata-search / id-based ingest", () => {
    test("cerefox_list_projects returns a list", async () => {
      const text = await toolText("cerefox_list_projects", {});
      expect(text.includes("Projects") || text.includes("No projects found")).toBe(true);
    });

    test("metadata_search with a filter finds the tagged doc", async () => {
      const tag = `ms-${crypto.randomUUID().slice(0, 8)}`;
      const t1 = await toolText("cerefox_ingest", {
        title: uniqueTitle("MetaSearch"),
        content: uniqueContent(),
        metadata: { e2e_tag: tag },
        author: "e2e-mcp-test",
      });
      track(extractId(t1));
      const text = await toolText("cerefox_metadata_search", { metadata_filter: { e2e_tag: tag } });
      expect(text).not.toContain("No documents match");
      expect(text).toContain(tag);
    });

    test("metadata_search with no matches", async () => {
      const text = await toolText("cerefox_metadata_search", {
        metadata_filter: { e2e_tag: `none-${crypto.randomUUID()}` },
      });
      expect(text).toContain("No documents match");
    });

    test("metadata_search empty filter → error", async () => {
      const resp = await tool("cerefox_metadata_search", { metadata_filter: {} });
      expect(resp.error).toBeDefined();
    });

    test("metadata_search with project_name", async () => {
      const tag = `mp-${crypto.randomUUID().slice(0, 8)}`;
      const t1 = await toolText("cerefox_ingest", {
        title: uniqueTitle("MetaSearch Project"),
        content: uniqueContent(),
        metadata: { e2e_tag: tag },
        project_name: "Test Files",
        author: "e2e-mcp-test",
      });
      track(extractId(t1));
      const text = await toolText("cerefox_metadata_search", { metadata_filter: { e2e_tag: tag } });
      expect(text).not.toContain("No documents match");
      expect(text).toContain(tag);
    });

    test("search with project_name resolves", async () => {
      const t1 = await toolText("cerefox_ingest", {
        title: uniqueTitle("Search Project"),
        content: uniqueContent(),
        project_name: "Test Files",
        author: "e2e-mcp-test",
      });
      track(extractId(t1));
      const text = await toolText("cerefox_search", {
        query: "Sunken Archives Mirelpath",
        project_name: "Test Files",
        match_count: 5,
      });
      expect(text).not.toBe("No results found.");
    });

    test("ingest by document_id updates", async () => {
      const title = uniqueTitle("ID Update");
      const t1 = await toolText("cerefox_ingest", { title, content: "# ID Update\n\nv1.", author: "e2e-mcp-test" });
      expect(t1).toContain("(id:");
      const docId = extractId(t1)!;
      track(docId);
      const t2 = await toolText("cerefox_ingest", {
        title,
        content: "# ID Update\n\nv1.\n\n## More\n\nvia id.",
        document_id: docId,
        author: "e2e-mcp-test",
      });
      expect(t2.toLowerCase()).toContain("updated");
      expect(t2).toContain(docId);
    });

    test("ingest by document_id not found → -32603", async () => {
      const resp = await tool("cerefox_ingest", {
        title: "Ghost",
        content: "# Ghost\n\nc.",
        document_id: crypto.randomUUID(),
        author: "e2e-mcp-test",
      });
      expect(resp.error?.code).toBe(-32603);
    });

    test("ingest by document_id with update_if_exists=false → note", async () => {
      const title = uniqueTitle("ID Note");
      const t1 = await toolText("cerefox_ingest", { title, content: "# ID Note\n\nv1.", author: "e2e-mcp-test" });
      expect(t1).toContain("(id:");
      const docId = extractId(t1)!;
      track(docId);
      const t2 = await toolText("cerefox_ingest", {
        title,
        content: "# ID Note\n\nmodified.",
        document_id: docId,
        update_if_exists: false,
        author: "e2e-mcp-test",
      });
      expect(t2.toLowerCase()).toContain("updated");
      expect(t2).toContain("Note:");
    });
  });

  // ── Usage logging ────────────────────────────────────────────────────────
  describe("usage logging", () => {
    test("MCP tool calls log access_path=remote-mcp", async () => {
      const client = createClient(settings);
      const original = (await client.raw.rpc("cerefox_get_config", {
        p_key: "usage_tracking_enabled",
      })) as { data: unknown };
      await client.raw.rpc("cerefox_set_config", {
        p_key: "usage_tracking_enabled",
        p_value: "true",
      });
      const marker = `usage logging mcp e2e ${crypto.randomUUID().slice(0, 8)}`;
      try {
        await toolText("cerefox_search", { query: marker, match_count: 1 });
        await new Promise((r) => setTimeout(r, 2000));
        const { data } = await client.raw.rpc("cerefox_list_usage_log", {
          p_operation: "search",
          p_access_path: "remote-mcp",
          p_limit: 20,
        });
        const rows = (data ?? []) as Array<{ query_text?: string }>;
        const found = rows.some((e) => e.query_text === marker);
        expect(found).toBe(true);
      } finally {
        const prev = (original?.data as string) ?? "false";
        await client.raw.rpc("cerefox_set_config", {
          p_key: "usage_tracking_enabled",
          p_value: prev,
        });
      }
    });
  });
});
