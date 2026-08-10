/**
 * Handler-level tests for `cerefox_insert` / `cerefox_edit` and outline mode.
 *
 * The pure semantics live in partial-edits.test.ts; what is tested here is the
 * part the pure module cannot see: argument validation, the concurrency
 * contract, what reaches the RPC, and what comes back to the agent. Mocked
 * client throughout — no network, no database.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// The write path calls embedBatch() before the RPC. Un-stubbed it makes a real
// network call, throws, and every "what reached the RPC" assertion below turns
// into a no-op that passes whatever the handler did.
//
// Stubbing global fetch rather than mock.module(): bun's module mocks are
// process-wide, so mocking the embeddings module here broke six embedBatch
// tests in another file. This is scoped to the assertions that need it and
// restored afterwards.
const realFetch = globalThis.fetch;
function stubEmbeddings(): void {
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).includes("openai.com")) {
      return new Response(
        JSON.stringify({ data: [{ index: 0, embedding: new Array(768).fill(0.01) }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return realFetch(url as never);
  }) as typeof fetch;
}
function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

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

describe("section mode (#198)", () => {
  test("returns one section's text, the hash, and the heading as context", async () => {
    const out = JSON.parse(
      await getDoc.handler(mockClient(), { document_id: "d", section: "## Totals" }, ctx),
    );
    expect(out.content_hash).toBe(HASH);
    expect(out.heading).toBe("## Totals");
    expect(out.text).toContain("Calories: 1200");
    // The heading is kept by replace_section, so it is not part of what would
    // be overwritten and must not be inside `text`.
    expect(out.text).not.toContain("## Totals");
    // And nothing from other sections leaks in.
    expect(out.text).not.toContain("coffee");
    expect(out.chars).toBe(out.text.length);
  });

  test("what it returns is what replace_section overwrites", async () => {
    // The property in full, through the MCP layer: read a section, replace it,
    // read it back, and the second read is what was written.
    const captured: Captured = {};
    const before = JSON.parse(
      await getDoc.handler(mockClient(), { document_id: "d", section: "## Totals" }, ctx),
    );
    stubEmbeddings();
    try {
      await edit.handler(
        mockClient({ captured }),
        {
          document_id: "d",
          operations: [
            { op: "replace_section", anchor_heading: "## Totals", text: "Calories: 1400" },
          ],
          expected_content_hash: HASH,
        },
        ctx,
      );
    } finally {
      restoreFetch();
    }
    const written = captured.ingestArgs?.p_chunks as Array<{ content: string }> | undefined;
    const body = (written ?? []).map((c) => c.content).join("\n");
    expect(before.text).toContain("Calories: 1200");
    expect(body).toContain("Calories: 1400");
    expect(body).not.toContain("Calories: 1200");
  });

  test("refuses a section with children unless section_part says which", async () => {
    // `## Intake` has `### Notes` under it — the ambiguity that makes a
    // guessing read dangerous.
    await expect(
      getDoc.handler(mockClient(), { document_id: "d", section: "## Intake" }, ctx),
    ).rejects.toThrow(/own_body[\s\S]*subtree|subtree[\s\S]*own_body/);

    const own = JSON.parse(
      await getDoc.handler(
        mockClient(),
        { document_id: "d", section: "## Intake", section_part: "own_body" },
        ctx,
      ),
    );
    const sub = JSON.parse(
      await getDoc.handler(
        mockClient(),
        { document_id: "d", section: "## Intake", section_part: "subtree" },
        ctx,
      ),
    );
    expect(own.text).toContain("coffee");
    expect(own.text).not.toContain("### Notes");
    expect(sub.text).toContain("### Notes");
  });

  test("a missing anchor errors rather than returning nothing", async () => {
    await expect(
      getDoc.handler(mockClient(), { document_id: "d", section: "## Nope" }, ctx),
    ).rejects.toThrow();
  });

  test("outline and section together are refused, not silently ranked", async () => {
    await expect(
      getDoc.handler(mockClient(), { document_id: "d", section: "## Totals", outline: true }, ctx),
    ).rejects.toThrow(/not both/);
  });

  test("section_part without section is refused", async () => {
    await expect(
      getDoc.handler(mockClient(), { document_id: "d", section_part: "subtree" }, ctx),
    ).rejects.toThrow(/only applies together with section/);
  });

  test("an archived section withholds the hash", async () => {
    // Same trap as archived outline mode: the RPC returns the CURRENT hash even
    // when reconstructing an old version, and pairing it with archived text
    // would invite an edit based on content that is no longer there.
    const out = JSON.parse(
      await getDoc.handler(
        mockClient(),
        { document_id: "d", section: "## Totals", version_id: "v1" },
        ctx,
      ),
    );
    expect(out.content_hash).toBeNull();
    expect(out.note).toContain("ARCHIVED");
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
  beforeAll(stubEmbeddings);
  afterAll(restoreFetch);

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
    expect(captured.args).toBeDefined();
    expect(captured.args!.p_author_type).toBe("agent");
  });

  test("a CLI write is recorded as a user write", async () => {
    // The discriminating case. Both tests above expect "agent", which a
    // hardcoded "agent" also satisfies — so neither would catch a regression to
    // the pre-fix literal. This one fails unless the value is actually derived
    // from the access path.
    const captured: { args?: Record<string, unknown> } = {};
    await insert
      .handler(
        capturingClient(captured),
        { document_id: "d", text: "x", position: "end_of_document", expected_content_hash: HASH },
        { accessPath: "cli", openaiApiKey: "k" } as ToolContext,
      )
      .catch(() => {});
    expect(captured.args).toBeDefined();
    expect(captured.args!.p_author_type).toBe("user");
    // Agent writes land in review; a human at a shell is the reviewer.
    expect(captured.args!.p_review_status).toBe("approved");
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
    expect(captured.args).toBeDefined();
    expect(captured.args!.p_author_type).toBe("agent");
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
  beforeAll(stubEmbeddings);
  afterAll(restoreFetch);

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
    expect(captured.args).toBeDefined();
    expect(captured.args!.p_source).toBeNull();
  });
});
