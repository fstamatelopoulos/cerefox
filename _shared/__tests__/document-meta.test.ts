/**
 * Unit tests for the document meta-facet cores (iteration 39, v1.10.0).
 *
 * Mocked client throughout. The properties under test are the ones the old
 * web save path violated — facts-only audit entries, validation BEFORE the
 * destructive replace, metadata via the guarded RPC — plus the round-1
 * additions: typed errors, the atomic rename RPC, replace-mode null
 * normalization, the carried-{}-clears semantics, and the shared membership
 * tail both twins delegate to.
 */

import { describe, expect, test } from "bun:test";

import {
  changeDocumentTitle,
  FacetNotFoundError,
  FacetUpdateError,
  FacetValidationError,
  normalizeMetadata,
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

function mockClient(fix: {
  docLive?: boolean;
  metadata?: Record<string, unknown>;
  memberships?: string[];
  projects?: Array<{ id: string; name: string }>;
  renamed?: boolean;
  rpcErrors?: Record<string, string>;
  captured: Captured;
}): MCPSupabaseClient {
  const rows = (table: string, wanted: string) => {
    if (table === "cerefox_documents") {
      if ((fix.docLive ?? true) === false) return [];
      const row: Record<string, unknown> = { id: DOC };
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
      is: () => c,
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
      if (fix.rpcErrors?.[name]) {
        return Promise.resolve({ data: null, error: { message: fix.rpcErrors[name] } });
      }
      if (name === "cerefox_rename_document") {
        const renamed = fix.renamed ?? true;
        return Promise.resolve({
          data: [{ renamed, old_title: "Old Title", new_title: args.p_new_title }],
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: (table: string) => chain(table),
  } as unknown as MCPSupabaseClient;
}

const WHO = { author: "web-ui", authorType: "user" };

describe("stableStringify / normalizeMetadata", () => {
  test("key order does not matter; values do", () => {
    expect(stableStringify({ a: 1, b: [2, { c: 3 }] })).toBe(
      stableStringify({ b: [2, { c: 3 }], a: 1 }),
    );
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });

  test("null values normalize away (replace-mode remove-key semantics)", () => {
    expect(normalizeMetadata({ a: "1", stale: null })).toEqual({ a: "1" });
  });
});

describe("changeDocumentTitle (thin wrapper over the atomic RPC)", () => {
  test("delegates to cerefox_rename_document with the actor", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await changeDocumentTitle(mockClient({ captured }), DOC, " New Title ", WHO);
    expect(r).toEqual({ changed: true, title: "New Title" });
    const call = captured.rpcs.find((r) => r.name === "cerefox_rename_document")!;
    expect(call.args.p_new_title).toBe("New Title");
    expect(call.args.p_author).toBe("web-ui");
    // No client-side writes: row + FTS + audit all live in the RPC.
    expect(captured.tableWrites).toEqual([]);
  });

  test("RPC no-op maps to changed:false", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await changeDocumentTitle(mockClient({ renamed: false, captured }), DOC, "Old Title", WHO);
    expect(r.changed).toBe(false);
  });

  test("typed errors: empty title and not-found", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    await expect(changeDocumentTitle(mockClient({ captured }), DOC, "  ", WHO)).rejects.toThrow(
      FacetValidationError,
    );
    await expect(
      changeDocumentTitle(
        mockClient({ captured, rpcErrors: { cerefox_rename_document: "Document not found (or in the trash): x" } }),
        DOC,
        "T",
        WHO,
      ),
    ).rejects.toThrow(FacetNotFoundError);
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

  test("trashed/missing document is refused BEFORE any write", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    await expect(
      setDocumentProjectsByIds(
        mockClient({ docLive: false, captured }),
        { documentId: DOC, projectIds: [P1], accessPath: "webapp", ...WHO },
      ),
    ).rejects.toThrow(FacetNotFoundError);
    expect(captured.tableWrites).toEqual([]);
  });

  test("unknown id aborts BEFORE the destructive replace (typed)", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    await expect(
      setDocumentProjectsByIds(
        mockClient({ memberships: [P1], projects: [{ id: P1, name: "A" }], captured }),
        { documentId: DOC, projectIds: [P1, P2], accessPath: "webapp", ...WHO },
      ),
    ).rejects.toThrow(FacetValidationError);
    expect(captured.tableWrites).not.toContain("cerefox_document_projects:delete");
  });

  test("changed set: replace + audit text + usage log with result_count", async () => {
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
    const usage = captured.rpcs.find((r) => r.name === "cerefox_log_usage")!;
    expect(usage.args.p_result_count).toBe(2);
  });
});

describe("updateDocumentFacets", () => {
  test("all facets carried but unchanged: zero writes, zero entries", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await updateDocumentFacets(
      mockClient({ metadata: { k: "v" }, memberships: [P1], renamed: false, captured }),
      {
        documentId: DOC,
        title: "Old Title",
        metadata: { k: "v" },
        projectIds: [P1],
        accessPath: "webapp",
        ...WHO,
      },
    );
    expect(r).toEqual({ titleChanged: false, metadataChanged: false, projectsChanged: false });
    expect(captured.tableWrites).toEqual([]);
    // Only the rename RPC probe fired (its no-op writes nothing server-side).
    expect(captured.rpcs.map((c) => c.name)).toEqual(["cerefox_rename_document"]);
  });

  test("carried {} CLEARS metadata (not a silent skip)", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await updateDocumentFacets(
      mockClient({ metadata: { k: "v" }, captured }),
      { documentId: DOC, metadata: {}, accessPath: "webapp", ...WHO },
    );
    expect(r.metadataChanged).toBe(true);
    const call = captured.rpcs.find((r) => r.name === "cerefox_set_document_metadata")!;
    expect(call.args.p_metadata).toEqual({});
    expect(call.args.p_replace).toBe(true);
  });

  test("null-normalized request equal to stored: no RPC, no entry", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    const r = await updateDocumentFacets(
      mockClient({ metadata: { a: "1" }, captured }),
      { documentId: DOC, metadata: { a: "1", stale: null }, accessPath: "webapp", ...WHO },
    );
    expect(r.metadataChanged).toBe(false);
    expect(captured.rpcs).toEqual([]);
  });

  test("mid-way failure names the facets that already committed", async () => {
    const captured: Captured = { rpcs: [], tableWrites: [] };
    let caught: unknown;
    try {
      await updateDocumentFacets(
        mockClient({
          metadata: { k: "v" },
          memberships: [],
          projects: [{ id: P1, name: "Alpha" }],
          rpcErrors: { cerefox_rename_document: "boom" },
          captured,
        }),
        {
          documentId: DOC,
          metadata: { k: "v2" },
          projectIds: [P1],
          title: "New",
          accessPath: "webapp",
          ...WHO,
        },
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(FacetUpdateError);
    expect((caught as FacetUpdateError).message).toContain("already applied before the failure: metadata, projects");
  });
});
