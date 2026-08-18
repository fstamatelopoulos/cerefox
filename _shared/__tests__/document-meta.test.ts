/**
 * Unit tests for the document meta-facet cores (iteration 39, v1.10.0).
 *
 * Mocked client throughout. The properties under test are the ones the old
 * web save path violated: facts-only audit entries (a facet the request
 * carried unchanged writes NOTHING), the title FTS refresh, validation
 * BEFORE the destructive membership replace, and metadata routed through
 * the guarded RPC rather than a raw table write.
 */

import { describe, expect, test } from "bun:test";

import {
  changeDocumentTitle,
  setDocumentProjectsByIds,
  stableStringify,
  updateDocumentFacets,
} from "../mcp-tools/_document-meta.ts";
import type { MCPSupabaseClient } from "../mcp-tools/types.ts";

const DOC = "11111111-2222-3333-4444-555555555555";
const P1 = "aaaaaaaa-1111-2222-3333-444444444444";
const P2 = "bbbbbbbb-1111-2222-3333-444444444444";

interface Captured {
  rpcs: Array<{ name: string; args: Record<string, unknown> }>;
  tableWrites: string[];
}

/** Chainable mock: routes reads from fixtures, records writes + RPCs. */
function mockClient(fix: {
  title?: string;
  metadata?: Record<string, unknown>;
  memberships?: string[];
  projects?: Array<{ id: string; name: string }>;
  captured: Captured;
}): MCPSupabaseClient {
  const rows = (table: string, wanted: string) => {
    if (table === "cerefox_documents") {
      const row: Record<string, unknown> = {};
      if (wanted.includes("title")) row.title = fix.title ?? "Old Title";
      if (wanted.includes("metadata")) row.metadata = fix.metadata ?? {};
      return [row];
    }
    if (table === "cerefox_document_projects") {
      return (fix.memberships ?? []).map((id) => ({ project_id: id }));
    }
    if (table === "cerefox_projects") return fix.projects ?? [];
    return [];
  };
  const chain = (table: string) => {
    let wanted = "";
    const c: Record<string, unknown> = {
      select: (cols: string) => ((wanted = cols), c),
      eq: () => c,
      in: () => c,
      limit: () => Promise.resolve({ data: rows(table, wanted), error: null }),
      update: (v: Record<string, unknown>) => {
        fix.captured.tableWrites.push(`${table}:update:${Object.keys(v).sort().join(",")}`);
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
      delete: () => {
        fix.captured.tableWrites.push(`${table}:delete`);
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
      insert: (v: unknown[]) => {
        fix.captured.tableWrites.push(`${table}:insert:${(v as unknown[]).length}`);
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: rows(table, wanted), error: null }),
    };
    return c;
  };
  return {
    rpc: (name: string, args: Record<string, unknown>) => {
      fix.captured.rpcs.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => chain(table),
  } as unknown as MCPSupabaseClient;
}

const WHO = { author: "web-ui", authorType: "user" };

describe("stableStringify", () => {
  test("key order does not matter; values do", () => {
    expect(stableStringify({ a: 1, b: [2, { c: 3 }] })).toBe(
      stableStringify({ b: [2, { c: 3 }], a: 1 }),
    );
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

describe("changeDocumentTitle", () => {
  test("unchanged title: no write, no FTS call, no audit entry", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await changeDocumentTitle(
      mockClient({ title: "Same", captured }), DOC, "Same", WHO,
    );
    expect(r.changed).toBe(false);
    expect(captured.tableWrites).toEqual([]);
    expect(captured.rpcs).toEqual([]);
  });

  test("changed title: update + FTS refresh + factual diff entry", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await changeDocumentTitle(
      mockClient({ title: "Old Title", captured }), DOC, "New Title", WHO,
    );
    expect(r.changed).toBe(true);
    expect(captured.tableWrites).toContain("cerefox_documents:update:title,updated_at");
    const names = captured.rpcs.map((r) => r.name);
    // The FTS refresh is the bug the old web path shipped without: title
    // boosting bakes the title into every current chunk's vector.
    expect(names).toContain("cerefox_update_chunk_fts");
    const audit = captured.rpcs.find((r) => r.name === "cerefox_create_audit_entry")!;
    expect(audit.args.p_description).toBe("Title changed: 'Old Title' → 'New Title'");
    expect(audit.args.p_author).toBe("web-ui");
  });
});

describe("setDocumentProjectsByIds", () => {
  test("same set (any order): complete no-op", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await setDocumentProjectsByIds(
      mockClient({ memberships: [P1, P2], captured }),
      { documentId: DOC, projectIds: [P2, P1], accessPath: "webapp", ...WHO },
    );
    expect(r.changed).toBe(false);
    expect(captured.tableWrites).toEqual([]);
    expect(captured.rpcs).toEqual([]);
  });

  test("unknown id aborts BEFORE the destructive replace", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    await expect(
      setDocumentProjectsByIds(
        mockClient({ memberships: [P1], projects: [{ id: P1, name: "A" }], captured }),
        { documentId: DOC, projectIds: [P1, P2], accessPath: "webapp", ...WHO },
      ),
    ).rejects.toThrow(/Unknown project id/);
    expect(captured.tableWrites).not.toContain("cerefox_document_projects:delete");
  });

  test("changed set: replace + same audit text as the name path", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await setDocumentProjectsByIds(
      mockClient({
        memberships: [P1],
        projects: [{ id: P1, name: "Alpha" }, { id: P2, name: "Beta" }],
        captured,
      }),
      { documentId: DOC, projectIds: [P1, P2], accessPath: "webapp", ...WHO },
    );
    expect(r.changed).toBe(true);
    expect(captured.tableWrites).toContain("cerefox_document_projects:delete");
    expect(captured.tableWrites).toContain("cerefox_document_projects:insert:2");
    const audit = captured.rpcs.find((r) => r.name === "cerefox_create_audit_entry")!;
    expect(audit.args.p_description).toBe("Set document projects to [Alpha, Beta]");
  });
});

describe("updateDocumentFacets", () => {
  test("all facets carried but unchanged: zero writes, zero entries", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await updateDocumentFacets(
      mockClient({ title: "T", metadata: { k: "v" }, memberships: [P1], captured }),
      {
        documentId: DOC,
        title: "T",
        metadata: { k: "v" },
        projectIds: [P1],
        accessPath: "webapp",
        ...WHO,
      },
    );
    expect(r).toEqual({ titleChanged: false, metadataChanged: false, projectsChanged: false });
    expect(captured.tableWrites).toEqual([]);
    expect(captured.rpcs).toEqual([]);
  });

  test("metadata change routes through the guarded RPC in replace mode", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await updateDocumentFacets(
      mockClient({ metadata: { k: "v" }, captured }),
      { documentId: DOC, metadata: { k: "v2" }, accessPath: "webapp", ...WHO },
    );
    expect(r.metadataChanged).toBe(true);
    const call = captured.rpcs.find((r) => r.name === "cerefox_set_document_metadata")!;
    expect(call.args.p_replace).toBe(true);
    expect(call.args.p_author).toBe("web-ui");
    // No raw metadata table write — the RPC owns the guards.
    expect(captured.tableWrites.filter((w) => w.includes("metadata"))).toEqual([]);
  });
});
