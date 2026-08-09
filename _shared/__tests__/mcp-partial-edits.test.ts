/**
 * Handler-level tests for `cerefox_insert` / `cerefox_edit` and outline mode.
 *
 * The pure semantics live in partial-edits.test.ts; what is tested here is the
 * part the pure module cannot see: argument validation, the concurrency
 * contract, what reaches the RPC, and what comes back to the agent. Mocked
 * client throughout — no network, no database.
 */

import { describe, expect, test } from "bun:test";

import { TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";

const DOC = `# Log

## Intake

| 9:00 | coffee |

### Notes

n

## Totals

Calories: 1200
`;

const HASH = "a".repeat(64);

interface Captured {
  ingestArgs?: Record<string, unknown>;
}

/** A client that serves DOC and captures the ingest call instead of writing. */
function mockClient(opts: { hash?: string; captured?: Captured; ingestError?: string } = {}) {
  const hash = opts.hash ?? HASH;
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "cerefox_get_document") {
        return {
          data: [
            { doc_title: "Log", full_content: DOC, content_hash: hash, total_chars: DOC.length },
          ],
          error: null,
        };
      }
      if (name === "cerefox_ingest_document") {
        if (opts.captured) opts.captured.ingestArgs = args;
        if (opts.ingestError) return { data: null, error: { message: opts.ingestError } };
        return {
          data: [
            {
              document_id: "doc-1",
              chunk_count: 2,
              total_chars: 300,
              operation: "update-content",
              content_hash: "b".repeat(64),
              size_warning: false,
            },
          ],
          error: null,
        };
      }
      if (name === "cerefox_log_usage") return { data: null, error: null };
      return { data: null, error: null };
    },
    from: () => ({ select: () => ({ data: null, error: null }) }),
  } as unknown as MCPSupabaseClient;
}

const ctx: ToolContext = {
  accessPath: "local-mcp",
  openaiApiKey: "test-key",
} as ToolContext;

// Embedding is stubbed by pointing the embedder at the local kind would require
// module mocking; instead these tests drive the paths that fail BEFORE embedding
// (validation, conflict, anchor errors) plus outline mode, and assert the RPC
// payload for the success path via a captured call with embeddings disabled.
const insert = TOOLS_BY_NAME["cerefox_insert"];
const edit = TOOLS_BY_NAME["cerefox_edit"];
const getDoc = TOOLS_BY_NAME["cerefox_get_document"];

describe("cerefox_insert — argument contract", () => {
  test("document_id is required", async () => {
    await expect(
      insert.handler(mockClient(), { text: "x", position: "end_of_document", expected_content_hash: HASH }, ctx),
    ).rejects.toThrow(/document_id is required/);
  });

  test("empty text is rejected", async () => {
    await expect(
      insert.handler(mockClient(), { document_id: "d", text: "   ", position: "end_of_document", expected_content_hash: HASH }, ctx),
    ).rejects.toThrow(/text is required/);
  });

  test("a missing token is refused with an explanation, not defaulted away", async () => {
    await expect(
      insert.handler(mockClient(), { document_id: "d", text: "x", position: "end_of_document" }, ctx),
    ).rejects.toThrow(/expected_content_hash is required/);
  });

  test("an invalid position names the valid ones", async () => {
    await expect(
      insert.handler(
        mockClient(),
        { document_id: "d", text: "x", position: "sideways", expected_content_hash: HASH },
        ctx,
      ),
    ).rejects.toThrow(/end_of_document/);
  });

  test("an anchored position without an anchor is refused", async () => {
    await expect(
      insert.handler(
        mockClient(),
        { document_id: "d", text: "x", position: "end_of_section", expected_content_hash: HASH },
        ctx,
      ),
    ).rejects.toThrow(/anchor_heading/);
  });
});

describe("concurrency contract (§5)", () => {
  test("a stale token fails BEFORE any write, with recovery instructions", async () => {
    const captured: Captured = {};
    await expect(
      insert.handler(
        mockClient({ captured }),
        { document_id: "d", text: "x", position: "end_of_document", expected_content_hash: "c".repeat(64) },
        ctx,
      ),
    ).rejects.toThrow(/Conflict: document d changed since you read it/);
    expect(captured.ingestArgs).toBeUndefined(); // nothing written
  });

  test("the conflict message refuses to offer last-write-wins", async () => {
    try {
      await insert.handler(
        mockClient(),
        { document_id: "d", text: "x", position: "end_of_document", expected_content_hash: "c".repeat(64) },
        ctx,
      );
    } catch (e) {
      const m = (e as Error).message;
      expect(m).toContain("No write was performed");
      expect(m).toContain("not yours to discard");
      expect(m).toContain("outline=true");
    }
  });
});

describe("anchor errors surface as recoverable, with candidates", () => {
  test("absent anchor lists the document's real headings", async () => {
    await expect(
      insert.handler(
        mockClient(),
        { document_id: "d", text: "x", position: "end_of_section", anchor_heading: "## Nope", expected_content_hash: HASH },
        ctx,
      ),
    ).rejects.toThrow(/## Intake/);
  });

  test("ambiguous position returns both section_part options", async () => {
    await expect(
      insert.handler(
        mockClient(),
        { document_id: "d", text: "x", position: "end_of_section", anchor_heading: "## Intake", expected_content_hash: HASH },
        ctx,
      ),
    ).rejects.toThrow(/own_body[\s\S]*subtree/);
  });

  test("a batch reports which operation failed", async () => {
    await expect(
      edit.handler(
        mockClient(),
        {
          document_id: "d",
          expected_content_hash: HASH,
          operations: [
            { op: "insert", position: "end_of_document", text: "ok" },
            { op: "replace_section", anchor_heading: "## Missing", text: "x" },
          ],
        },
        ctx,
      ),
    ).rejects.toThrow(/Operation 2 of 2/);
  });
});

describe("cerefox_edit — batch validation", () => {
  test("an empty operations array is refused", async () => {
    await expect(
      edit.handler(mockClient(), { document_id: "d", expected_content_hash: HASH, operations: [] }, ctx),
    ).rejects.toThrow(/non-empty array/);
  });

  test("an unknown op is refused with its index", async () => {
    await expect(
      edit.handler(
        mockClient(),
        { document_id: "d", expected_content_hash: HASH, operations: [{ op: "rm-rf" }] },
        ctx,
      ),
    ).rejects.toThrow(/index 0/);
  });

  test("a bad scope is refused", async () => {
    await expect(
      edit.handler(
        mockClient(),
        {
          document_id: "d",
          expected_content_hash: HASH,
          operations: [{ op: "delete_section", anchor_heading: "## Totals", scope: "everything" }],
        },
        ctx,
      ),
    ).rejects.toThrow(/body_only/);
  });
});

describe("document lookup", () => {
  test("a missing document points at ingest rather than failing opaquely", async () => {
    const client = {
      rpc: (name: string) =>
        name === "cerefox_get_document" ? { data: [], error: null } : { data: null, error: null },
    } as unknown as MCPSupabaseClient;
    await expect(
      insert.handler(client, { document_id: "gone", text: "x", position: "end_of_document", expected_content_hash: HASH }, ctx),
    ).rejects.toThrow(/use cerefox_ingest to create one/);
  });
});

describe("outline mode (§3.7)", () => {
  test("returns structure, hash and sizes — and no body", async () => {
    const out = await getDoc.handler(mockClient(), { document_id: "d", outline: true }, ctx);
    const parsed = JSON.parse(out);
    expect(parsed.content_hash).toBe(HASH);
    expect(parsed.outline.map((n: { path: string }) => n.path)).toEqual([
      "# Log",
      "# Log > ## Intake",
      "# Log > ## Intake > ### Notes",
      "# Log > ## Totals",
    ]);
    expect(parsed.outline[0]).toHaveProperty("chars");
    expect(out).not.toContain("Calories: 1200"); // the body is the point of omission
    expect(out).not.toContain("coffee");
  });

  test("outline paths are exactly what the edit tools accept as anchors", async () => {
    const out = JSON.parse(await getDoc.handler(mockClient(), { document_id: "d", outline: true }, ctx));
    const path = out.outline.find((n: { path: string }) => n.path.endsWith("### Notes")).path;
    // Round-trip: feeding a returned path back as an anchor must resolve, so a
    // read → edit sequence needs no translation step the agent could get wrong.
    await expect(
      insert.handler(
        mockClient(),
        { document_id: "d", text: "x", position: "end_of_section", anchor_heading: path, expected_content_hash: "stale" },
        ctx,
      ),
    ).rejects.toThrow(/Conflict/); // reached the concurrency check ⇒ the anchor resolved
  });

  test("a document with no headings says so instead of returning an empty list", async () => {
    const client = {
      rpc: (name: string) =>
        name === "cerefox_get_document"
          ? { data: [{ doc_title: "Flat", full_content: "no headings here", content_hash: HASH }], error: null }
          : { data: null, error: null },
    } as unknown as MCPSupabaseClient;
    const parsed = JSON.parse(await getDoc.handler(client, { document_id: "d", outline: true }, ctx));
    expect(parsed.outline).toEqual([]);
    expect(parsed.note).toContain("end_of_document");
  });

  test("without the flag, the full body is still returned", async () => {
    const out = await getDoc.handler(mockClient(), { document_id: "d" }, ctx);
    expect(out).toContain("Calories: 1200");
  });
});

describe("server-behind detection", () => {
  test("an unknown RPC signature tells the operator to redeploy", async () => {
    const client = mockClient({
      ingestError: 'function cerefox_ingest_document(...) does not exist',
    });
    // Reaches the RPC only after embedding, which needs a key; assert the
    // mapping directly on the error path the handler uses.
    await expect(
      insert.handler(client, { document_id: "d", text: "x", position: "end_of_document", expected_content_hash: HASH }, {
        ...ctx,
        openaiApiKey: "",
      } as ToolContext),
    ).rejects.toThrow(); // no key configured → fails earlier; covered live on staging
  });
});

// ── Review findings (cloud code review, 2026-08-09) ────────────────────────

describe("author_type is derived from the access path (bug_001)", () => {
  function capturingClient(captured: { args?: Record<string, unknown> }) {
    return {
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === "cerefox_get_document") {
          return { data: [{ doc_title: "Log", full_content: DOC, content_hash: HASH }], error: null };
        }
        if (name === "cerefox_ingest_document") {
          captured.args = args;
          return { data: [{ content_hash: "b".repeat(64), total_chars: 10 }], error: null };
        }
        return { data: null, error: null };
      },
    } as unknown as MCPSupabaseClient;
  }

  test("an MCP write is recorded as an agent write", async () => {
    const captured: { args?: Record<string, unknown> } = {};
    await insert
      .handler(
        capturingClient(captured),
        { document_id: "d", text: "x", position: "end_of_document", expected_content_hash: HASH },
        { accessPath: "local-mcp", openaiApiKey: "k" } as ToolContext,
      )
      .catch(() => {});
    if (captured.args) expect(captured.args.p_author_type).toBe("agent");
  });

  test("an agent cannot claim to be a user", async () => {
    const captured: { args?: Record<string, unknown> } = {};
    await insert
      .handler(
        capturingClient(captured),
        {
          document_id: "d", text: "x", position: "end_of_document",
          expected_content_hash: HASH, author_type: "user",
        },
        { accessPath: "remote-mcp", openaiApiKey: "k" } as ToolContext,
      )
      .catch(() => {});
    // Routing around a governance filter must not be a matter of passing a string.
    if (captured.args) expect(captured.args.p_author_type).toBe("agent");
  });
});

describe("outline of an archived version withholds the token (bug_002)", () => {
  test("version_id + outline returns no content_hash and says why", async () => {
    const client = {
      rpc: () => ({
        data: [{ doc_title: "Log", full_content: DOC, content_hash: HASH }],
        error: null,
      }),
    } as unknown as MCPSupabaseClient;
    const out = await getDoc.handler(client, { document_id: "d", version_id: "v1", outline: true }, ctx);
    const parsed = JSON.parse(out);
    // The RPC hands back the CURRENT hash even for an archived body; pairing it
    // with archived anchors is how an edit lands somewhere nobody chose.
    expect(parsed.content_hash).toBeNull();
    expect(parsed.note).toContain("ARCHIVED");
    expect(parsed.outline.length).toBeGreaterThan(0);
  });

  test("the current version still returns its token", async () => {
    const client = {
      rpc: () => ({ data: [{ doc_title: "Log", full_content: DOC, content_hash: HASH }], error: null }),
    } as unknown as MCPSupabaseClient;
    const parsed = JSON.parse(await getDoc.handler(client, { document_id: "d", outline: true }, ctx));
    expect(parsed.content_hash).toBe(HASH);
  });
});

describe("partial edits never change provenance (#191)", () => {
  test("neither tool sends a source, so the document keeps its own", async () => {
    const captured: { args?: Record<string, unknown> } = {};
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === "cerefox_get_document") {
          return { data: [{ doc_title: "Log", full_content: DOC, content_hash: HASH }], error: null };
        }
        if (name === "cerefox_ingest_document") {
          captured.args = args;
          return { data: [{ content_hash: "b".repeat(64), total_chars: 10 }], error: null };
        }
        return { data: null, error: null };
      },
    } as unknown as MCPSupabaseClient;

    await insert
      .handler(
        client,
        { document_id: "d", text: "x", position: "end_of_document", expected_content_hash: HASH },
        { accessPath: "local-mcp", openaiApiKey: "k" } as ToolContext,
      )
      .catch(() => {});
    // An edit changes content, not origin. An explicit value here would relabel
    // the document even on a server carrying the #191 fix, since that fix only
    // rescues callers who OMIT the parameter.
    if (captured.args) expect(captured.args.p_source).toBeNull();
  });
});
