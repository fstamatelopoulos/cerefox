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
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  test("contains exactly 18 tools (14 core + the 4 relation tools)", () => {
    expect(ALL_TOOLS.length).toBe(18);
  });

  test("the partial-edit tools are split along the safety boundary (iter-34)", () => {
    // The whole reason there are two tools rather than one: MCP annotations are
    // declared per tool, so a combined edit tool would have to warn on every
    // additive insert, and a tool that always warns gets blanket-approved.
    const insert = TOOLS_BY_NAME["cerefox_insert"];
    const edit = TOOLS_BY_NAME["cerefox_edit"];
    expect(insert).toBeDefined();
    expect(edit).toBeDefined();
    expect(insert.annotations?.destructiveHint).toBe(false);
    expect(insert.annotations?.readOnlyHint).toBe(false);
    expect(edit.annotations?.destructiveHint).toBe(true);
  });

  test("both partial-edit tools require a concurrency token (no last-write-wins)", () => {
    for (const name of ["cerefox_insert", "cerefox_edit"]) {
      const t = TOOLS_BY_NAME[name];
      expect(t.inputSchema.required).toContain("expected_content_hash");
      // Spec §5: a conflict is information the agent needs. These tools
      // deliberately offer no way to suppress it.
      expect(JSON.stringify(t.inputSchema)).not.toContain("last_write_wins");
    }
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

describe("tool annotations (MCP 2025-03-26)", () => {
  // Declaring nothing is not neutral: the spec defaults are readOnlyHint=false
  // and destructiveHint=true, so an unannotated tool tells every client it may
  // do something irreversible. That made `cerefox_search` look as dangerous as
  // a destructive write, and the usual response is to blanket-approve the
  // server — which drains the meaning from the prompt on the tools that
  // genuinely warrant one.
  const READ_ONLY = [
    "cerefox_search",
    "cerefox_get_document",
    "cerefox_metadata_search",
    "cerefox_list_projects",
    "cerefox_list_versions",
    "cerefox_list_metadata_keys",
    "cerefox_get_audit_log",
    "cerefox_get_help",
    "cerefox_get_relations",
    "cerefox_get_neighbors",
  ];
  // Irreversible, because what they remove has NO version history.
  // cerefox_ingest belongs here for a non-obvious reason: `project_names`
  // REPLACES the document's project memberships, so a partial list silently
  // drops the rest. Its content edits are recoverable; its membership edits
  // are not.
  const DESTRUCTIVE = [
    "cerefox_ingest",
    "cerefox_set_document_projects",
    "cerefox_delete_relation",
  ];

  test("every tool declares annotations", () => {
    const missing = ALL_TOOLS.filter((t) => !t.annotations).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  test("read-only tools are marked read-only and not destructive", () => {
    for (const name of READ_ONLY) {
      const t = ALL_TOOLS.find((x) => x.name === name);
      expect(t, `${name} missing`).toBeDefined();
      expect(t!.annotations?.readOnlyHint, name).toBe(true);
      expect(t!.annotations?.destructiveHint, name).not.toBe(true);
    }
  });

  test("irreversible tools are marked destructive", () => {
    for (const name of DESTRUCTIVE) {
      const t = ALL_TOOLS.find((x) => x.name === name);
      expect(t, `${name} missing`).toBeDefined();
      expect(t!.annotations?.readOnlyHint, name).toBe(false);
      expect(t!.annotations?.destructiveHint, name).toBe(true);
    }
  });

  test("no tool is both read-only and destructive", () => {
    for (const t of ALL_TOOLS) {
      if (t.annotations?.readOnlyHint) {
        expect(t.annotations.destructiveHint, t.name).not.toBe(true);
      }
    }
  });

  test("nothing claims to reach the open world — every tool talks to the operator's own store", () => {
    for (const t of ALL_TOOLS) {
      expect(t.annotations?.openWorldHint, t.name).toBe(false);
    }
  });

  test("every tool carries a human-readable title", () => {
    for (const t of ALL_TOOLS) {
      expect(typeof t.annotations?.title, t.name).toBe("string");
    }
  });
});

describe("purge is deliberately absent from the agent surface", () => {
  // Soft delete exists to protect against BOTH user and agent mistakes, and
  // purge is web-UI-only on purpose: an agent works far faster than a human,
  // so an agent that could purge might soft-delete and permanently delete in
  // the same breath — turning a recoverable mistake into an unrecoverable one
  // before anybody could notice. The recovery window is the entire point, and
  // it only exists if the fast actor cannot close it.
  //
  // These tests exist so that decision cannot be undone by accident. If a
  // future change means to expose purge to agents, it has to delete a test
  // that says why not.
  test("no MCP tool is named for purging or permanent deletion", () => {
    for (const t of ALL_TOOLS) {
      expect(t.name).not.toMatch(/purge|permanent|hard[_-]?delete/i);
    }
  });

  test("no MCP tool calls cerefox_purge_document", async () => {
    // A tool could reach purge without being named for it.
    const calls: string[] = [];
    const spy = {
      rpc: (name: string) => {
        calls.push(name);
        return { data: [], error: null };
      },
      from: () => ({
        select: () => ({ data: [], error: null }),
        delete: () => ({ eq: () => ({ data: null, error: null }) }),
      }),
    } as unknown as SupabaseClient;

    for (const t of ALL_TOOLS) {
      // Drive each tool with empty args: most reject in validation, which is
      // fine — we only care that nothing reaches the purge RPC.
      await t.handler(spy, {}, { accessPath: "local-mcp" } as never).catch(() => {});
    }
    expect(calls).not.toContain("cerefox_purge_document");
  });

  test("no MCP tool description advertises permanent deletion to an agent", () => {
    for (const t of ALL_TOOLS) {
      expect(t.description.toLowerCase()).not.toContain("permanently delete");
    }
  });
});

describe("tool failures are results, not protocol errors", () => {
  // MCP reserves protocol errors for protocol-level problems (unknown tool,
  // malformed request). An operation that ran and failed belongs in the result
  // with isError: true, so the model can read it and retry.
  //
  // We threw instead, which the SDK mapped to -32603. The message survived on
  // the wire, but clients render protocol errors as they please — one major one
  // shows a generic failure dialog and drops the body. During the 1.3.0 beta an
  // agent hit every refusal as an unreadable failure: the candidate headings,
  // the recovery steps, the two section_part options, none of it arrived.
  test("the local server returns tool failures as isError results", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "..", "packages", "memory", "src", "server.ts"),
      "utf8",
    );
    expect(src).toContain("isError: true");
    // The old shape: a bare re-throw of the handler's error.
    expect(src).not.toMatch(/if \(err instanceof McpInvalidParams\) throw err;/);
  });

  test("the remote Edge Function does the same", () => {
    const src = readFileSync(
      join(import.meta.dir, "..", "..", "supabase", "functions", "cerefox-mcp", "index.ts"),
      "utf8",
    );
    expect(src).toContain("isError: true");
    // -32603 for a tool that ran and failed is exactly the shape being fixed.
    expect(src).not.toMatch(/const code = err instanceof McpInvalidParams \? -32602 : -32603;/);
  });
});

describe("timestamps carry their zone (#199)", () => {
  // An agent read a bare `2026-08-11` from version history while its own clock
  // said 2026-08-10, concluded the server was a day ahead, and dated a day of
  // log entries into the future. The instant was right; the label was missing.
  const ISO = "2026-08-11T06:32:13.494525+00:00";

  test("audit entries keep the UTC marker", async () => {
    const tool = TOOLS_BY_NAME["cerefox_get_audit_log"];
    const client = {
      rpc: () => ({
        data: [
          {
            created_at: ISO,
            operation: "rename-section",
            author: "a",
            author_type: "agent",
            doc_title: "d",
            document_id: "id",
            description: "x",
          },
        ],
        error: null,
      }),
    } as unknown as SupabaseClient;
    const out = await tool.handler(client, {}, FAKE_CTX);
    expect(out).toContain("2026-08-11T06:32:13Z");
    // The failure mode is a truncated stamp that reads as local.
    expect(out).not.toMatch(/2026-08-11T06:32:13(?!Z)/);
  });

  test("version history reports an instant, not a bare date", async () => {
    const tool = TOOLS_BY_NAME["cerefox_list_versions"];
    const client = {
      rpc: () => ({
        data: [
          {
            version_id: "v",
            version_number: 1,
            source: "agent",
            chunk_count: 1,
            total_chars: 10,
            created_at: ISO,
          },
        ],
        error: null,
      }),
    } as unknown as SupabaseClient;
    const out = await tool.handler(client, { document_id: "d" }, FAKE_CTX);
    expect(out).toContain("2026-08-11T06:32:13Z");
  });
});

describe("get_help states the server version on every response", () => {
  // An agent on a pre-1.5.0 server asked for `topic: "server"`, got "no such
  // topic", and concluded the documented self-check did not exist — inside the
  // section warning against unverified infrastructure claims. The check was
  // real; their server predated it. Hiding it behind a topic name meant the
  // remedy for a stale server required a server new enough to have the remedy.
  const help = TOOLS_BY_NAME["cerefox_get_help"];
  const client = { rpc: () => ({ data: null, error: null }) } as unknown as SupabaseClient;

  test("no topic — the common call", async () => {
    const out = await help.handler(client, {}, FAKE_CTX);
    expect(out).toContain("## This server");
    expect(out).toMatch(/\*\*Version\*\*: \d+\.\d+\.\d+/);
  });

  test("a matched topic still carries it", async () => {
    const out = await help.handler(client, { topic: "Tools" }, FAKE_CTX);
    expect(out).toContain("## This server");
  });

  test("an UNMATCHED topic carries it — the case that was reported", async () => {
    const out = await help.handler(client, { topic: "no-such-topic-xyz" }, FAKE_CTX);
    expect(out).toContain("## This server");
    expect(out).toContain("No help topic matched");
  });

  test("the explicit server topic still works", async () => {
    const out = await help.handler(client, { topic: "server" }, FAKE_CTX);
    expect(out).toContain("## This server");
    expect(out).toContain("cerefox_edit operations");
  });
});
