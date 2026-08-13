/**
 * Handler-level tests for `cerefox_delete_document` (#208).
 *
 * Mocked client throughout — no network, no database. What is tested here:
 * argument validation (the required read-hash), the conflict mapping, what
 * reaches the RPC (author_type derived from transport, reason passthrough),
 * and what comes back to the agent on the happy / already-deleted paths.
 * The CAS itself is RPC-side and is exercised by the live staging suite.
 */

import { describe, expect, test } from "bun:test";

import { TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import { McpInvalidParams } from "../mcp-tools/types.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";

const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);
const DOC_ID = "11111111-2222-3333-4444-555555555555";

interface Captured {
  deleteArgs?: Record<string, unknown>;
  usageLogged?: number;
}

function mockClient(
  opts: {
    captured?: Captured;
    rpcError?: string;
    row?: Record<string, unknown>;
  } = {},
) {
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "cerefox_delete_document") {
        if (opts.captured) opts.captured.deleteArgs = args;
        if (opts.rpcError) return { data: null, error: { message: opts.rpcError } };
        return {
          data: opts.row ?? {
            document_id: DOC_ID,
            title: "Doomed Doc",
            total_chars: 1234,
            deleted_at: "2026-08-13T00:00:00Z",
            already_deleted: false,
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
const del = TOOLS_BY_NAME["cerefox_delete_document"];

describe("cerefox_delete_document — registration", () => {
  test("is registered with honest annotations", () => {
    expect(del).toBeDefined();
    expect(del.annotations?.readOnlyHint).toBe(false);
    // The caller cannot reverse it (restore is human-only), so it destroys.
    expect(del.annotations?.destructiveHint).toBe(true);
    expect(del.annotations?.idempotentHint).toBe(true);
  });

  test("requires the read-hash and offers no last-write-wins escape", () => {
    expect(del.inputSchema.required).toContain("document_id");
    expect(del.inputSchema.required).toContain("expected_content_hash");
    // A delete with no evidence of a read has no legitimate agent use case.
    expect(JSON.stringify(del.inputSchema)).not.toContain("last_write_wins");
  });
});

describe("cerefox_delete_document — argument contract", () => {
  test("document_id is required", async () => {
    await expect(
      del.handler(mockClient(), { expected_content_hash: HASH }, ctx),
    ).rejects.toThrow(McpInvalidParams);
  });

  test("expected_content_hash is required", async () => {
    await expect(del.handler(mockClient(), { document_id: DOC_ID }, ctx)).rejects.toThrow(
      /read it first|expected_content_hash is required/,
    );
  });

  test("a blank hash is absent, not stale", async () => {
    await expect(
      del.handler(mockClient(), { document_id: DOC_ID, expected_content_hash: "   " }, ctx),
    ).rejects.toThrow(McpInvalidParams);
  });
});

describe("cerefox_delete_document — what reaches the RPC", () => {
  test("author_type derives from the transport, reason passes through", async () => {
    const captured: Captured = {};
    await del.handler(
      mockClient({ captured }),
      {
        document_id: DOC_ID,
        expected_content_hash: HASH,
        reason: "superseded by v2 doc",
        author: "TestAgent",
        requestor: "TestAgent",
      },
      ctx,
    );
    expect(captured.deleteArgs?.p_author).toBe("TestAgent");
    // Never caller-supplied: an agent must not record itself as a user.
    expect(captured.deleteArgs?.p_author_type).toBe("agent");
    expect(captured.deleteArgs?.p_expected_content_hash).toBe(HASH);
    expect(captured.deleteArgs?.p_reason).toBe("superseded by v2 doc");
  });

  test("a hash with stray whitespace is trimmed, not sent raw", async () => {
    // A trailing newline from copy-paste must not become a phantom conflict.
    const captured: Captured = {};
    await del.handler(
      mockClient({ captured }),
      { document_id: DOC_ID, expected_content_hash: `  ${HASH}\n` },
      ctx,
    );
    expect(captured.deleteArgs?.p_expected_content_hash).toBe(HASH);
  });

  test("cli transport records a user", async () => {
    const captured: Captured = {};
    await del.handler(
      mockClient({ captured }),
      { document_id: DOC_ID, expected_content_hash: HASH },
      { accessPath: "cli" } as ToolContext,
    );
    expect(captured.deleteArgs?.p_author_type).toBe("user");
  });
});

describe("cerefox_delete_document — RPC error mapping", () => {
  test("CEREFOX_CONFLICT maps to agent-first re-read instructions", async () => {
    const message =
      `CEREFOX_CONFLICT: document ${DOC_ID} changed since it was read ` +
      `(expected hash ${HASH}, current hash ${OTHER_HASH}). Re-read the document, ` +
      `check it still warrants deletion, and retry with the new hash.`;
    const err = await del
      .handler(
        mockClient({ rpcError: message }),
        { document_id: DOC_ID, expected_content_hash: HASH },
        ctx,
      )
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("changed since you read it");
    expect((err as Error).message).toContain(OTHER_HASH);
    expect((err as Error).message).toContain("cerefox_get_document");
    expect((err as Error).message).toContain("still warranted");
  });

  test("a pre-0.12.0 server maps to actionable redeploy guidance", async () => {
    const err = await del
      .handler(
        mockClient({
          rpcError:
            "Could not find the function public.cerefox_delete_document(p_author, p_author_type, p_document_id, p_expected_content_hash, p_reason) in the schema cache",
        }),
        { document_id: DOC_ID, expected_content_hash: HASH },
        ctx,
      )
      .catch((e: Error) => e);
    expect((err as Error).message).toContain("server is behind");
    expect((err as Error).message).toContain("cerefox server deploy");
  });

  test("not-found maps to invalid params", async () => {
    await expect(
      del.handler(
        mockClient({ rpcError: `Document ${DOC_ID} not found` }),
        { document_id: DOC_ID, expected_content_hash: HASH },
        ctx,
      ),
    ).rejects.toThrow(McpInvalidParams);
  });
});

describe("cerefox_delete_document — responses", () => {
  test("happy path reports what was deleted and that only a human can undo it", async () => {
    const out = await del.handler(
      mockClient(),
      { document_id: DOC_ID, expected_content_hash: HASH },
      ctx,
    );
    expect(out).toContain("Doomed Doc");
    expect(out).toContain("recoverable");
    expect(out).toContain("Tell your user");
  });

  test("already-deleted is a reported no-op and logs no usage entry", async () => {
    const captured: Captured = {};
    const out = await del.handler(
      mockClient({
        captured,
        row: {
          document_id: DOC_ID,
          title: "Doomed Doc",
          total_chars: 1234,
          deleted_at: "2026-08-01T00:00:00Z",
          already_deleted: true,
        },
      }),
      { document_id: DOC_ID, expected_content_hash: HASH },
      ctx,
    );
    expect(out).toContain("ALREADY soft-deleted");
    expect(out).toContain("No change");
    expect(out).toContain("2026-08-01");
    // The RPC wrote no audit entry; a usage-log "delete" row here would make
    // the analytics disagree with the audit log.
    expect(captured.usageLogged ?? 0).toBe(0);
  });
});
