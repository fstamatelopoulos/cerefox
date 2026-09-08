/**
 * `cerefox_metadata_search` gets the same two guards as the search tool
 * (#267), because it shares the transport that made them necessary: the local
 * stdio server passes tool arguments through unvalidated.
 *
 * Both holes were the same shape. A non-numeric `max_bytes` became `NaN`,
 * which reaches the RPC as JSON `null`, and `p_max_bytes NULL` means NO limit
 * — so one word instead of a number returned the full content of every
 * matching document. An unclamped `limit` asked the database for as many rows
 * as the caller named.
 */

import { describe, expect, test } from "bun:test";

import { TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";

const ctx = { accessPath: "local-mcp", openaiApiKey: "" } as ToolContext;
const tool = TOOLS_BY_NAME["cerefox_metadata_search"];

/** Captures the parameters the handler puts on the wire. */
function spy() {
  const calls: Array<Record<string, unknown>> = [];
  const client = {
    rpc: async (name: string, params: Record<string, unknown>) => {
      if (name === "cerefox_log_usage") return { data: null, error: null };
      if (name === "cerefox_get_config") return { data: null, error: null };
      calls.push(params);
      return { data: [], error: null };
    },
  } as unknown as MCPSupabaseClient;
  return { calls, client };
}

describe("metadata_search bounds what the caller asks for", () => {
  test("a non-numeric max_bytes falls back to the ceiling, never to no limit", async () => {
    const { calls, client } = spy();
    await tool.handler(
      client,
      { metadata_filter: { type: "x" }, include_content: true, max_bytes: "lots", author: "t" },
      ctx,
    );
    const sent = calls[0]!.p_max_bytes;
    expect(Number.isFinite(sent as number)).toBe(true);
    expect(sent).not.toBeNull();
  });

  test("a zero or negative max_bytes is a tiny budget, not the maximum", async () => {
    for (const asked of [0, -5]) {
      const { calls, client } = spy();
      await tool.handler(
        client,
        { metadata_filter: { type: "x" }, include_content: true, max_bytes: asked, author: "t" },
        ctx,
      );
      expect(calls[0]!.p_max_bytes).toBe(1);
    }
  });

  test("limit is clamped, so one call cannot ask for a million rows", async () => {
    const { calls, client } = spy();
    await tool.handler(client, { metadata_filter: { type: "x" }, limit: 1_000_000, author: "t" }, ctx);
    expect(calls[0]!.p_limit).toBe(500);
  });

  test("a non-numeric limit falls back to the default", async () => {
    const { calls, client } = spy();
    await tool.handler(client, { metadata_filter: { type: "x" }, limit: "many", author: "t" }, ctx);
    expect(calls[0]!.p_limit).toBe(10);
  });

  test("an ordinary request is untouched", async () => {
    const { calls, client } = spy();
    await tool.handler(
      client,
      { metadata_filter: { type: "x" }, limit: 25, include_content: true, max_bytes: 5_000, author: "t" },
      ctx,
    );
    expect(calls[0]!.p_limit).toBe(25);
    expect(calls[0]!.p_max_bytes).toBe(5_000);
  });
});
