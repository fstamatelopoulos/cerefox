/**
 * Handler-level tests for `cerefox_restore_document` (#210).
 *
 * Mocked client throughout — no network, no database. Argument validation,
 * what reaches the RPC, error mapping, and the two response shapes (restored
 * vs not-deleted no-op). The live path is exercised by the acceptance suite.
 */

import { describe, expect, test } from "bun:test";

import { TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import { McpInvalidParams } from "../mcp-tools/types.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";

const DOC_ID = "11111111-2222-3333-4444-555555555555";

interface Captured {
  restoreArgs?: Record<string, unknown>;
  usageLogged?: number;
}

function mockClient(
  opts: { captured?: Captured; rpcError?: string; row?: Record<string, unknown> } = {},
) {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "cerefox_restore_document") {
        if (opts.captured) opts.captured.restoreArgs = args;
        if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
        return {
          data: opts.row ?? {
            document_id: DOC_ID,
            title: "Lazarus Doc",
            total_chars: 1234,
            restored: true,
            was_deleted: true,
          },
          error: null,
        };
      }
      if (name === "cerefox_log_usage") {
        if (opts.captured) opts.captured.usageLogged = (opts.captured.usageLogged ?? 0) + 1;
        return { data: null, error: null };
      }
      return { data: null, error: null };
    },
    from: () => ({ select: () => ({ data: null, error: null }) }),
  } as unknown as MCPSupabaseClient;
}

const ctx: ToolContext = { accessPath: "local-mcp" } as ToolContext;
const restore = TOOLS_BY_NAME["cerefox_restore_document"];

describe("cerefox_restore_document — registration", () => {
  test("is registered with recovery-shaped annotations", () => {
    expect(restore).toBeDefined();
    expect(restore.annotations?.readOnlyHint).toBe(false);
    // Restore can only bring content back — it must not scare clients into
    // treating recovery like a destructive write.
    expect(restore.annotations?.destructiveHint).toBe(false);
    expect(restore.annotations?.idempotentHint).toBe(true);
  });

  test("requires only document_id — no concurrency token on a trashed doc", () => {
    expect(restore.inputSchema.required).toEqual(["document_id"]);
    expect(JSON.stringify(restore.inputSchema)).not.toContain("expected_content_hash");
  });
});

describe("cerefox_restore_document — contract and RPC payload", () => {
  test("document_id is required", async () => {
    await expect(restore.handler(mockClient(), {}, ctx)).rejects.toThrow(McpInvalidParams);
  });

  test("author_type derives from the transport, reason passes through", async () => {
    const captured: Captured = {};
    await restore.handler(
      mockClient({ captured }),
      { document_id: DOC_ID, reason: "deleted by mistake", author: "TestAgent", requestor: "TestAgent" },
      ctx,
    );
    expect(captured.restoreArgs?.p_author).toBe("TestAgent");
    expect(captured.restoreArgs?.p_author_type).toBe("agent");
    expect(captured.restoreArgs?.p_reason).toBe("deleted by mistake");
  });
});

describe("cerefox_restore_document — error mapping and responses", () => {
  test("a pre-0.12.0 server maps to actionable redeploy guidance", async () => {
    const err = await restore
      .handler(
        mockClient({
          rpcError:
            "Could not find the function public.cerefox_restore_document(p_author, p_author_type, p_document_id, p_reason) in the schema cache",
        }),
        { document_id: DOC_ID },
        ctx,
      )
      .catch((e: Error) => e);
    expect((err as Error).message).toContain("server is behind");
    expect((err as Error).message).toContain("cerefox server deploy");
  });

  test("not-found maps to invalid params", async () => {
    await expect(
      restore.handler(
        mockClient({ rpcError: `Document ${DOC_ID} not found` }),
        { document_id: DOC_ID },
        ctx,
      ),
    ).rejects.toThrow(McpInvalidParams);
  });

  test("happy path reports the restore and prompts the user report", async () => {
    const captured: Captured = {};
    const out = await restore.handler(
      mockClient({ captured }),
      { document_id: DOC_ID },
      ctx,
    );
    expect(out).toContain("Restored");
    expect(out).toContain("Lazarus Doc");
    expect(out).toContain("Tell your user");
    expect(captured.usageLogged).toBe(1);
  });

  test("not-deleted is a reported no-op and logs no usage entry", async () => {
    const captured: Captured = {};
    const out = await restore.handler(
      mockClient({
        captured,
        row: {
          document_id: DOC_ID,
          title: "Lazarus Doc",
          total_chars: 1234,
          restored: false,
          was_deleted: false,
        },
      }),
      { document_id: DOC_ID },
      ctx,
    );
    expect(out).toContain("NOT deleted");
    expect(out).toContain("No change");
    expect(captured.usageLogged ?? 0).toBe(0);
  });
});
