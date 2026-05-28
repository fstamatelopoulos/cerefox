/**
 * Unit tests for `packages/memory/src/web/docs.ts` — the bundled-docs
 * resolver that backs `GET /api/v1/docs` and `/docs/{path}`.
 *
 * Test-migration policy (design doc § 12, v0.6.0): new TS code ships
 * with unit-level coverage equivalent to whatever the Python module it
 * replaced had. The Python `cerefox.docs_resources` was tested by
 * `tests/test_docs_resources.py`; this file covers the equivalent
 * surface for the TS port's listBundledDocs / readDoc functions.
 *
 * No server boot, no Supabase — pure resolver behaviour against the
 * actual bundled docs.
 */

import { describe, expect, test } from "bun:test";

import { listBundledDocs, readDoc } from "../src/web/docs.ts";

describe("listBundledDocs", () => {
  test("returns a non-empty list", () => {
    const entries = listBundledDocs();
    expect(entries.length).toBeGreaterThan(0);
  });

  test("entries have {path, title, category}", () => {
    const entries = listBundledDocs();
    for (const e of entries) {
      expect(Object.keys(e).sort()).toEqual(["category", "path", "title"]);
      expect(typeof e.path).toBe("string");
      expect(typeof e.title).toBe("string");
      expect(["readme", "agent-guide", "guide"]).toContain(e.category);
    }
  });

  test("includes README + AGENT guides at the top level", () => {
    const paths = listBundledDocs().map((e) => e.path);
    expect(paths).toContain("README.md");
    expect(paths).toContain("AGENT_GUIDE.md");
    expect(paths).toContain("AGENT_QUICK_REFERENCE.md");
  });

  test("includes guides/ subdirectory entries", () => {
    const paths = listBundledDocs().map((e) => e.path);
    const guidePaths = paths.filter((p) => p.startsWith("guides/"));
    expect(guidePaths.length).toBeGreaterThan(0);
  });

  test("excludes contributor-only docs (CLAUDE.md, plan.md, research/, specs/)", () => {
    const paths = listBundledDocs().map((e) => e.path);
    for (const forbidden of [
      "CLAUDE.md",
      "plan.md",
      "TODO.md",
      "research/vision.md",
      "specs/polish-and-distribution-design.md",
    ]) {
      expect(paths).not.toContain(forbidden);
    }
  });

  test("titles are non-empty", () => {
    for (const e of listBundledDocs()) {
      expect(e.title.length).toBeGreaterThan(0);
    }
  });

  test("README is listed before guides (top-level docs first)", () => {
    const paths = listBundledDocs().map((e) => e.path);
    const readmeIdx = paths.indexOf("README.md");
    const firstGuideIdx = paths.findIndex((p) => p.startsWith("guides/"));
    expect(readmeIdx).toBeGreaterThanOrEqual(0);
    expect(firstGuideIdx).toBeGreaterThanOrEqual(0);
    expect(readmeIdx).toBeLessThan(firstGuideIdx);
  });
});

describe("readDoc", () => {
  test("reads README.md and content contains 'Cerefox'", () => {
    const content = readDoc("README.md");
    expect(content).not.toBeNull();
    expect(content).toContain("Cerefox");
  });

  test("returns null for an unknown path", () => {
    expect(readDoc("guides/nonexistent-xyz.md")).toBeNull();
  });

  test("returns null for an empty path", () => {
    // Empty resolves to the docs root directory, not a file.
    expect(readDoc("")).toBeNull();
  });

  test("rejects path traversal: ../etc/passwd", () => {
    expect(readDoc("../etc/passwd")).toBeNull();
  });

  test("rejects path traversal: guides/../../etc/passwd", () => {
    expect(readDoc("guides/../../etc/passwd")).toBeNull();
  });

  test("rejects absolute paths", () => {
    expect(readDoc("/etc/passwd")).toBeNull();
  });
});
