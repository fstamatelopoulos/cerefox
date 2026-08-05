/**
 * Tests for `_shared/mcp-tools/`. Focuses on:
 * - Tool registration / index exports.
 * - `cerefox_get_help` topic dispatch (the one tool that has non-trivial
 *   logic independent of the DB).
 * - Input-validation throws for the handlers that do their own validation.
 *
 * DB-shape tests would require a live Supabase mock per RPC; we get those
 * for free from the Python e2e suite via the byte-parity test in 22D.4.
 */

import { describe, expect, mock, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ALL_TOOLS,
  McpInvalidParams,
  TOOLS_BY_NAME,
  type ToolContext,
} from "../mcp-tools/index.ts";

const FAKE_CTX: ToolContext = { accessPath: "local-mcp" };

// A minimal SupabaseClient stub that no-ops every method. Tools that don't
// hit the DB during their input-validation phase can use this.
function noopClient(): SupabaseClient {
  return {
    rpc: () => ({ data: null, error: null }),
    from: () => ({
      select: () => ({ data: null, error: null }),
      insert: () => ({ data: null, error: null }),
      delete: () => ({ data: null, error: null }),
    }),
  } as unknown as SupabaseClient;
}

describe("ALL_TOOLS registration", () => {
  test("contains exactly 14 tools (10 + the 4 relation tools)", () => {
    expect(ALL_TOOLS.length).toBe(14);
  });

  test("every tool name starts with cerefox_", () => {
    for (const t of ALL_TOOLS) expect(t.name.startsWith("cerefox_")).toBe(true);
  });

  test("tool names are unique", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("TOOLS_BY_NAME contains every tool", () => {
    for (const t of ALL_TOOLS) {
      expect(TOOLS_BY_NAME[t.name]).toBe(t);
    }
  });

  test("every tool has description, inputSchema, handler", () => {
    for (const t of ALL_TOOLS) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(20);
      expect(typeof t.inputSchema).toBe("object");
      expect(typeof t.handler).toBe("function");
    }
  });

  test("includes cerefox_get_help (v0.4.0 addition)", () => {
    expect(TOOLS_BY_NAME["cerefox_get_help"]).toBeDefined();
  });
});

describe("cerefox_get_help", () => {
  const tool = TOOLS_BY_NAME["cerefox_get_help"];

  test("no topic — returns full reference + section index", async () => {
    const out = await tool.handler(noopClient(), {}, FAKE_CTX);
    expect(out).toContain("Cerefox Knowledge Base");
    expect(out).toContain("## Available topics");
    expect(out).toContain("Essential Rules");
  });

  test("matching topic — returns matched section", async () => {
    const out = await tool.handler(noopClient(), { topic: "essential rules" }, FAKE_CTX);
    expect(out).toContain("## Essential Rules");
    expect(out).not.toContain("## Available topics");
  });

  test("substring match is case-insensitive", async () => {
    const out = await tool.handler(noopClient(), { topic: "TOOLS" }, FAKE_CTX);
    expect(out).toContain("## Tools");
  });

  test("partial-word match works", async () => {
    const out = await tool.handler(noopClient(), { topic: "update" }, FAKE_CTX);
    // Matches both "Update Workflow" sections.
    expect(out).toContain("Update Workflow");
  });

  test("no match — returns available topics list", async () => {
    const out = await tool.handler(noopClient(), { topic: "nonexistent-xyz" }, FAKE_CTX);
    expect(out).toContain('No help topic matched "nonexistent-xyz"');
    expect(out).toContain("Available topics");
  });
});

describe("input validation throws McpInvalidParams", () => {
  test("cerefox_search rejects missing query", async () => {
    const tool = TOOLS_BY_NAME["cerefox_search"];
    let err: unknown;
    try {
      await tool.handler(noopClient(), {}, { ...FAKE_CTX, openaiApiKey: "test" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });

  test("cerefox_ingest rejects missing title", async () => {
    const tool = TOOLS_BY_NAME["cerefox_ingest"];
    let err: unknown;
    try {
      await tool.handler(
        noopClient(),
        { content: "hi" },
        { ...FAKE_CTX, openaiApiKey: "test" },
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });

  test("cerefox_ingest rejects missing content", async () => {
    const tool = TOOLS_BY_NAME["cerefox_ingest"];
    let err: unknown;
    try {
      await tool.handler(
        noopClient(),
        { title: "hi" },
        { ...FAKE_CTX, openaiApiKey: "test" },
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });

  test("cerefox_ingest rejects non-array project_names", async () => {
    const tool = TOOLS_BY_NAME["cerefox_ingest"];
    let err: unknown;
    try {
      await tool.handler(
        noopClient(),
        { title: "x", content: "y", project_names: "not an array" },
        { ...FAKE_CTX, openaiApiKey: "test" },
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });

  test("cerefox_ingest rejects scalar metadata (issue #89)", async () => {
    const tool = TOOLS_BY_NAME["cerefox_ingest"];
    for (const bad of ["i am a scalar", 42, true, ["an", "array"]]) {
      let err: unknown;
      try {
        await tool.handler(
          noopClient(),
          { title: "x", content: "y", metadata: bad },
          { ...FAKE_CTX, openaiApiKey: "test" },
        );
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(McpInvalidParams);
    }
  });

  test("cerefox_get_document rejects missing document_id", async () => {
    const tool = TOOLS_BY_NAME["cerefox_get_document"];
    let err: unknown;
    try {
      await tool.handler(noopClient(), {}, FAKE_CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });

  test("cerefox_list_versions rejects missing document_id", async () => {
    const tool = TOOLS_BY_NAME["cerefox_list_versions"];
    let err: unknown;
    try {
      await tool.handler(noopClient(), {}, FAKE_CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });

  test("cerefox_metadata_search rejects no criteria at all (no filter, no scope)", async () => {
    const tool = TOOLS_BY_NAME["cerefox_metadata_search"];
    let err: unknown;
    try {
      await tool.handler(noopClient(), {}, FAKE_CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });

  test("cerefox_metadata_search rejects empty metadata_filter with no other scope", async () => {
    const tool = TOOLS_BY_NAME["cerefox_metadata_search"];
    let err: unknown;
    try {
      await tool.handler(noopClient(), { metadata_filter: {} }, FAKE_CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });

  test("cerefox_metadata_search rejects a non-object metadata_filter", async () => {
    const tool = TOOLS_BY_NAME["cerefox_metadata_search"];
    let err: unknown;
    try {
      await tool.handler(noopClient(), { metadata_filter: "nope" }, FAKE_CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });
  test("cerefox_set_document_projects rejects missing document_id", async () => {
    const tool = TOOLS_BY_NAME["cerefox_set_document_projects"];
    let err: unknown;
    try {
      await tool.handler(noopClient(), { project_names: [] }, FAKE_CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });

  test("cerefox_set_document_projects rejects non-array project_names", async () => {
    const tool = TOOLS_BY_NAME["cerefox_set_document_projects"];
    let err: unknown;
    try {
      await tool.handler(noopClient(), { document_id: "x", project_names: "y" }, FAKE_CTX);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(McpInvalidParams);
  });
});

describe("cerefox_ingest optimistic concurrency (iter-32)", () => {
  // Mock client whose document lookup returns a doc with the given hash.
  // The stale-token fast-fail throws BEFORE chunking/embedding, so no
  // OpenAI or RPC mocking is needed beyond the lookup chain.
  function docClient(currentHash: string): SupabaseClient {
    const chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => ({ data: [{ id: "doc-1", title: "T", content_hash: currentHash }], error: null }),
    };
    return {
      from: () => chain,
      rpc: () => ({ data: null, error: null }),
    } as unknown as SupabaseClient;
  }

  test("stale expected_content_hash fast-fails with merge instructions", async () => {
    const tool = TOOLS_BY_NAME["cerefox_ingest"];
    let err: unknown;
    try {
      await tool.handler(
        docClient("c".repeat(64)),
        {
          title: "T",
          content: "new body",
          document_id: "doc-1",
          expected_content_hash: "a".repeat(64),
        },
        { ...FAKE_CTX, openaiApiKey: "test-key" },
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain("Conflict");
    expect(msg).toContain("cerefox_get_document");
    expect(msg).toContain("c".repeat(64)); // tells the agent the current hash
  });

  test("last_write_wins skips the fast-fail (reaches the embed stage)", async () => {
    const tool = TOOLS_BY_NAME["cerefox_ingest"];
    let err: unknown;
    try {
      await tool.handler(
        docClient("c".repeat(64)),
        {
          title: "T",
          content: "new body",
          document_id: "doc-1",
          expected_content_hash: "a".repeat(64),
          last_write_wins: true,
        },
        { ...FAKE_CTX, openaiApiKey: "test-key" },
      );
    } catch (e) {
      err = e;
    }
    // It must NOT be the conflict error — with the check bypassed the handler
    // proceeds to the embedding call, which fails against the fake key.
    expect(String((err as Error)?.message ?? "")).not.toContain("Conflict:");
  });
});

describe("cerefox_metadata_search listing (empty filter + scope)", () => {
  // A mock client that resolves any project name → "proj-1" and records the
  // params passed to the cerefox_metadata_search RPC.
  function listingClient(captured: { params?: Record<string, unknown> }): SupabaseClient {
    const projectChain = {
      select: () => projectChain,
      ilike: () => projectChain,
      limit: () => ({ data: [{ id: "proj-1" }], error: null }),
    };
    return {
      rpc: (name: string, params: Record<string, unknown>) => {
        if (name === "cerefox_metadata_search") captured.params = params;
        return { data: [], error: null };
      },
      from: () => projectChain,
    } as unknown as SupabaseClient;
  }

  test("project_name alone lists docs (empty filter → RPC gets {} + resolved project_id)", async () => {
    const tool = TOOLS_BY_NAME["cerefox_metadata_search"];
    const captured: { params?: Record<string, unknown> } = {};
    await tool.handler(listingClient(captured), { project_name: "Cerefox" }, FAKE_CTX);
    expect(captured.params?.p_metadata_filter).toEqual({});
    expect(captured.params?.p_project_id).toBe("proj-1");
  });

  test("updated_since alone is a sufficient scope (no throw)", async () => {
    const tool = TOOLS_BY_NAME["cerefox_metadata_search"];
    const captured: { params?: Record<string, unknown> } = {};
    await tool.handler(listingClient(captured), { updated_since: "2026-01-01" }, FAKE_CTX);
    expect(captured.params?.p_metadata_filter).toEqual({});
    expect(captured.params?.p_updated_since).toBe("2026-01-01");
  });
});

describe("chunker (used by ingest)", () => {
  test("short content → 1 chunk", async () => {
    const { chunkMarkdown } = await import("../mcp-tools/_chunker.ts");
    const chunks = chunkMarkdown("hello world");
    expect(chunks.length).toBe(1);
    expect(chunks[0].content).toBe("hello world");
  });

  test("empty content → 0 chunks", async () => {
    const { chunkMarkdown } = await import("../mcp-tools/_chunker.ts");
    const chunks = chunkMarkdown("");
    expect(chunks.length).toBe(0);
  });

  test("heading-based split for long content", async () => {
    const { chunkMarkdown } = await import("../mcp-tools/_chunker.ts");
    const longContent =
      "# H1\n\n" +
      "A".repeat(3000) +
      "\n\n## H2\n\n" +
      "B".repeat(3000) +
      "\n\n## H3\n\n" +
      "C".repeat(3000);
    const chunks = chunkMarkdown(longContent);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.char_count).toBeLessThanOrEqual(4000);
  });

  test("sha256hex produces deterministic 64-char hex", async () => {
    const { sha256hex, normalizeContent } = await import("../mcp-tools/_chunker.ts");
    const h1 = await sha256hex(normalizeContent("hello"));
    const h2 = await sha256hex(normalizeContent("hello"));
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64);
    expect(/^[0-9a-f]+$/.test(h1)).toBe(true);
  });

  test("CRLF and trailing whitespace normalize", async () => {
    const { normalizeContent } = await import("../mcp-tools/_chunker.ts");
    expect(normalizeContent("hi  \r\nworld")).toBe("hi  \nworld");
    expect(normalizeContent("a\n\n\n\nb")).toBe("a\n\nb");
  });
});
