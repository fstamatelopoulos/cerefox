/**
 * Iteration 29 — the relation MCP tools' input handling and output shaping.
 *
 * RPC behaviour (symmetry, lifecycle side effects, cycle-safe traversal) is
 * covered against a real Postgres; these tests pin the transport layer:
 * validation, parameter mapping, and how results are rendered for an agent.
 */

import { describe, expect, test } from "bun:test";

import { ALL_TOOLS, TOOLS_BY_NAME } from "../mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../mcp-tools/types.ts";

const CTX = { accessPath: "local-mcp" } as ToolContext;
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

/** Records the RPC name + params, returns a canned payload. */
function spyClient(payload: unknown) {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    from: () => ({ select: () => ({ data: [], error: null }) }),
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ name, params });
      return name === "cerefox_log_usage"
        ? { data: null, error: null }
        : { data: payload, error: null };
    },
  } as unknown as MCPSupabaseClient;
  return { client, calls };
}

describe("relation tools are registered", () => {
  test("all four appear in ALL_TOOLS", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    for (const n of [
      "cerefox_set_relation",
      "cerefox_delete_relation",
      "cerefox_get_relations",
      "cerefox_get_neighbors",
    ]) {
      expect(names).toContain(n);
    }
  });

  test("each declares its required inputs", () => {
    expect(TOOLS_BY_NAME["cerefox_set_relation"].inputSchema.required).toEqual([
      "source_id",
      "target_id",
      "rel_type",
    ]);
    expect(TOOLS_BY_NAME["cerefox_get_neighbors"].inputSchema.required).toEqual([
      "document_id",
      "rel_type",
    ]);
  });
});

describe("cerefox_set_relation", () => {
  test("rejects a non-UUID id rather than letting the RPC fail", async () => {
    const { client } = spyClient([{ is_symmetric: false }]);
    await expect(
      TOOLS_BY_NAME["cerefox_set_relation"].handler(
        client,
        { source_id: "not-a-uuid", target_id: B, rel_type: "references" },
        CTX,
      ),
    ).rejects.toThrow(/source_id must be a document UUID/);
  });

  test("rejects an empty rel_type", async () => {
    const { client } = spyClient([{ is_symmetric: false }]);
    await expect(
      TOOLS_BY_NAME["cerefox_set_relation"].handler(
        client,
        { source_id: A, target_id: B, rel_type: "   " },
        CTX,
      ),
    ).rejects.toThrow(/rel_type is required/);
  });

  test("maps arguments onto the RPC and reports symmetry", async () => {
    const { client, calls } = spyClient([{ is_symmetric: true }]);
    const out = (await TOOLS_BY_NAME["cerefox_set_relation"].handler(
      client,
      { source_id: A, target_id: B, rel_type: " related_to ", author: "tester" },
      CTX,
    )) as string;
    const call = calls.find((c) => c.name === "cerefox_set_relation");
    expect(call?.params.p_source_id).toBe(A);
    expect(call?.params.p_rel_type).toBe("related_to"); // trimmed
    expect(call?.params.p_author).toBe("tester");
    expect(out).toContain("symmetric");
  });

  test("surfaces the lifecycle side effect so the agent can report it", async () => {
    const { client } = spyClient([{ is_symmetric: false }]);
    const out = (await TOOLS_BY_NAME["cerefox_set_relation"].handler(
      client,
      { source_id: A, target_id: B, rel_type: "supersedes" },
      CTX,
    )) as string;
    expect(out).toContain("superseded");
  });
});

describe("cerefox_delete_relation", () => {
  test("says plainly when nothing matched", async () => {
    const { client } = spyClient(0);
    const out = (await TOOLS_BY_NAME["cerefox_delete_relation"].handler(
      client,
      { source_id: A, target_id: B, rel_type: "references" },
      CTX,
    )) as string;
    expect(out).toMatch(/No such relation/);
  });

  test("reports the row count and that lifecycle is untouched", async () => {
    const { client } = spyClient(2);
    const out = (await TOOLS_BY_NAME["cerefox_delete_relation"].handler(
      client,
      { source_id: A, target_id: B, rel_type: "related_to" },
      CTX,
    )) as string;
    expect(out).toContain("2 relation row(s)");
    expect(out).toMatch(/Lifecycle status is left as-is/);
  });
});

describe("cerefox_get_relations", () => {
  test("marks non-active neighbours so stale knowledge is visible", async () => {
    const { client } = spyClient([
      {
        direction: "outbound",
        rel_type: "supersedes",
        other_id: B,
        other_title: "Old Plan",
        other_lifecycle: "superseded",
      },
      {
        direction: "inbound",
        rel_type: "references",
        other_id: A,
        other_title: "Live Doc",
        other_lifecycle: "active",
      },
    ]);
    const out = (await TOOLS_BY_NAME["cerefox_get_relations"].handler(
      client,
      { document_id: A },
      CTX,
    )) as string;
    expect(out).toContain("→ supersedes: Old Plan [superseded]");
    expect(out).toContain("← references: Live Doc");
    expect(out).not.toContain("Live Doc [active]"); // active is not annotated
  });

  test("empty graph reads clearly", async () => {
    const { client } = spyClient([]);
    const out = (await TOOLS_BY_NAME["cerefox_get_relations"].handler(
      client,
      { document_id: A },
      CTX,
    )) as string;
    expect(out).toBe("No relations for this document.");
  });
});

describe("cerefox_get_neighbors", () => {
  test("requires a relation type — traversal must be explicit", async () => {
    const { client } = spyClient([]);
    await expect(
      TOOLS_BY_NAME["cerefox_get_neighbors"].handler(client, { document_id: A }, CTX),
    ).rejects.toThrow(/rel_type is required/);
  });

  test("clamps depth and limit to safe bounds", async () => {
    const { client, calls } = spyClient([]);
    await TOOLS_BY_NAME["cerefox_get_neighbors"].handler(
      client,
      { document_id: A, rel_type: "follows", depth: 99, limit: 5000 },
      CTX,
    );
    const call = calls.find((c) => c.name === "cerefox_get_neighbors");
    expect(call?.params.p_depth).toBe(5);
    expect(call?.params.p_limit).toBe(200);
  });

  test("renders depth and direction per hop", async () => {
    const { client } = spyClient([
      {
        document_id: B,
        title: "Next Message",
        lifecycle_status: "active",
        depth: 2,
        direction: "outbound",
      },
    ]);
    const out = (await TOOLS_BY_NAME["cerefox_get_neighbors"].handler(
      client,
      { document_id: A, rel_type: "follows" },
      CTX,
    )) as string;
    expect(out).toContain("depth 2 (outbound): Next Message");
  });
});
