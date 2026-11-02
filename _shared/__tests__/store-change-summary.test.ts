/** What a store-level audit entry changed, and its document-column label (#353). */
import { describe, expect, test } from "bun:test";
import { auditDocLabel, storeChangeSummary } from "../mcp-tools/audit-ops.ts";

describe("storeChangeSummary", () => {
  test("a config change shows the key and both values, without the prefix", () => {
    expect(storeChangeSummary("config-change", "config: trash_auto_purge_enabled: 'false' → 'true'")).toBe(
      "trash_auto_purge_enabled: 'false' → 'true'",
    );
  });

  test("a project operation shows its description as written", () => {
    expect(storeChangeSummary("project-create", "Project 'notes' created")).toBe("Project 'notes' created");
    expect(storeChangeSummary("project-delete", "Project 'x' deleted (3 documents unlinked)")).toBe(
      "Project 'x' deleted (3 documents unlinked)",
    );
  });

  test("document operations and empty descriptions give nothing", () => {
    expect(storeChangeSummary("update-content", "ingest via cli")).toBeNull();
    expect(storeChangeSummary("config-change", "  ")).toBeNull();
    expect(storeChangeSummary("config-change", null)).toBeNull();
  });
});

describe("auditDocLabel", () => {
  test("names what a store-level entry is about", () => {
    expect(auditDocLabel(null, null, "config-change")).toBe("(setting)");
    for (const op of ["project-create", "project-edit", "project-delete"]) {
      expect(auditDocLabel(null, null, op)).toBe("(project)");
    }
  });

  test("a purged document, a title, a short id", () => {
    expect(auditDocLabel(null, null, "delete")).toBe("(deleted)");
    expect(auditDocLabel("Notes", "abc", "create")).toBe("Notes");
    expect(auditDocLabel(null, "0123456789abcdef", "create")).toBe("01234567…");
  });
});
