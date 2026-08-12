/**
 * Handler-level tests for `cerefox_set_document_metadata` (#204).
 *
 * The merge itself lives in the RPC — deliberately, because a read-then-merge
 * in TypeScript would let two agents setting different keys clobber each other.
 * So what is tested here is the part the RPC cannot see: argument validation,
 * what reaches the RPC, and what comes back to the agent.
 */

import { describe, expect, test } from "bun:test";

import { TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";

const tool = TOOLS_BY_NAME["cerefox_set_document_metadata"];
const ctx: ToolContext = { accessPath: "local-mcp" } as ToolContext;
const cliCtx: ToolContext = { accessPath: "cli" } as ToolContext;

interface Captured {
  args?: Record<string, unknown>;
}

function client(opts: { captured?: Captured; result?: Record<string, unknown> } = {}) {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "cerefox_set_document_metadata") {
        if (opts.captured) opts.captured.args = args;
        return {
          data: [
            opts.result ?? { document_id: "d", metadata: { a: "1" }, keys_set: 1, keys_removed: 0 },
          ],
          error: null,
        };
      }
      return { data: null, error: null };
    },
  } as unknown as MCPSupabaseClient;
}

describe("cerefox_set_document_metadata — argument contract", () => {
  test("document_id is required", async () => {
    await expect(tool.handler(client(), { metadata: { a: "1" } }, ctx)).rejects.toThrow(
      /document_id is required/,
    );
  });

  test("metadata is required, and the message says how to remove a key", async () => {
    await expect(tool.handler(client(), { document_id: "d" }, ctx)).rejects.toThrow(
      /Use null as a value to REMOVE/,
    );
  });

  test("an array is refused — it would merge as nonsense", async () => {
    await expect(
      tool.handler(client(), { document_id: "d", metadata: ["a"] as never }, ctx),
    ).rejects.toThrow(/must be an object/);
  });

  test("an empty merge is refused rather than silently doing nothing", async () => {
    // A caller who meant "clear everything" meant replace: true. Silence here
    // would look like success.
    await expect(
      tool.handler(client(), { document_id: "d", metadata: {} }, ctx),
    ).rejects.toThrow(/would change nothing/);
  });

  test("an empty REPLACE is allowed — that is how you clear all metadata", async () => {
    const captured: Captured = {};
    await tool.handler(
      client({ captured, result: { document_id: "d", metadata: {}, keys_set: 0, keys_removed: 3 } }),
      { document_id: "d", metadata: {}, replace: true },
      ctx,
    );
    expect(captured.args?.p_replace).toBe(true);
  });
});

describe("what reaches the RPC", () => {
  test("merge is the default", async () => {
    const captured: Captured = {};
    await tool.handler(client({ captured }), { document_id: "d", metadata: { a: "1" } }, ctx);
    expect(captured.args?.p_replace).toBe(false);
    expect(captured.args?.p_metadata).toEqual({ a: "1" });
  });

  test("nulls are passed through untouched — they are the removal signal", async () => {
    const captured: Captured = {};
    await tool.handler(
      client({ captured }),
      { document_id: "d", metadata: { a: "1", gone: null } },
      ctx,
    );
    // Stripping nulls client-side would silently turn a removal into a no-op.
    expect(captured.args?.p_metadata).toEqual({ a: "1", gone: null });
  });

  test("author_type is derived from the transport, not taken from the caller", async () => {
    // An agent must not be able to record itself as a user.
    const asAgent: Captured = {};
    await tool.handler(
      client({ captured: asAgent }),
      { document_id: "d", metadata: { a: "1" }, author_type: "user" },
      ctx,
    );
    expect(asAgent.args?.p_author_type).toBe("agent");

    const asUser: Captured = {};
    await tool.handler(client({ captured: asUser }), { document_id: "d", metadata: { a: "1" } }, cliCtx);
    expect(asUser.args?.p_author_type).toBe("user");
  });

  test("author falls back to requestor", async () => {
    const captured: Captured = {};
    await tool.handler(
      client({ captured }),
      { document_id: "d", metadata: { a: "1" }, requestor: "some-agent" },
      ctx,
    );
    expect(captured.args?.p_author).toBe("some-agent");
  });
});

describe("what comes back", () => {
  test("a no-op says so rather than implying work happened", async () => {
    const out = await tool.handler(
      client({ result: { document_id: "d", metadata: { a: "1" }, keys_set: 0, keys_removed: 0 } }),
      { document_id: "d", metadata: { a: "1" } },
      ctx,
    );
    expect(out).toContain("No change");
  });

  test("counts are reported, and the response states content was untouched", async () => {
    const out = await tool.handler(
      client({ result: { document_id: "d", metadata: { a: "1" }, keys_set: 2, keys_removed: 1 } }),
      { document_id: "d", metadata: { a: "1" } },
      ctx,
    );
    expect(out).toContain("2 key(s) set, 1 removed");
    expect(out).toContain("no new version");
  });
});

describe("annotations", () => {
  test("declared destructive, because replace: true can lose keys", async () => {
    // Merge alone could not, but MCP annotations are per TOOL, not per call —
    // the same constraint that forced the insert/edit split in v1.3.0.
    expect(tool.annotations?.destructiveHint).toBe(true);
    expect(tool.annotations?.readOnlyHint).toBe(false);
  });
});
