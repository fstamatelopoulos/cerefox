/**
 * Part 24I — Parity snapshot tests.
 *
 * Loads the 5 captured Python response fixtures from
 * `test/fixtures/python-parity/` and asserts each one parses cleanly
 * against the matching zod schema in `_shared/schemas/`. This is the
 * regression guard: if a future change to a schema breaks the wire
 * shape that frontends and external HTTP clients depend on, this test
 * goes red.
 *
 * **Runs in CI without Supabase.** The fixtures are committed; no
 * network calls. Per the locked decision (plan.md § Iteration 24,
 * Part 24I): live e2e parity validation (TS server vs. real DB) moves
 * to the manual test plan in Part 24L — `uv run pytest -m e2e` against
 * a running TS web server exercises the same `/api/v1/*` contract
 * Python pytest already covers.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import {
  AuditEntryResponse,
  DashboardResponse,
  DocumentDetailResponse,
  SearchResponse,
  VersionResponse,
} from "../../../_shared/schemas/index.js";

const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "python-parity",
);

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8"));
}

describe("python parity fixtures parse against _shared/schemas/", () => {
  test("version.json → VersionResponse", () => {
    const fx = loadFixture("version.json");
    const parsed = VersionResponse.parse(fx);
    // Sanity: real Python response had these keys.
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("git_commit_short");
    expect(parsed).toHaveProperty("build_date");
  });

  test("dashboard.json → DashboardResponse", () => {
    const fx = loadFixture("dashboard.json");
    const parsed = DashboardResponse.parse(fx);
    expect(parsed.doc_count).toBeGreaterThan(0);
    expect(Array.isArray(parsed.recent_docs)).toBe(true);
    expect(Array.isArray(parsed.projects)).toBe(true);
    // Each recent_doc has the documented projection shape.
    if (parsed.recent_docs.length > 0) {
      const d = parsed.recent_docs[0];
      expect(typeof d.id).toBe("string");
      expect(typeof d.title).toBe("string");
      expect(typeof d.chunk_count).toBe("number");
      expect(Array.isArray(d.project_ids)).toBe(true);
    }
  });

  test("search.json → SearchResponse", () => {
    const fx = loadFixture("search.json");
    const parsed = SearchResponse.parse(fx);
    expect(parsed.mode).toBe("docs");
    expect(parsed.query).toBe("cerefox");
    expect(parsed.total_found).toBeGreaterThanOrEqual(0);
    expect(typeof parsed.response_bytes).toBe("number");
    expect(parsed.truncated).toBe(false);
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  test("audit-log.json → AuditEntryResponse[]", () => {
    const fx = loadFixture("audit-log.json");
    const parsed = z.array(AuditEntryResponse).parse(fx);
    expect(parsed.length).toBeGreaterThan(0);
    for (const e of parsed) {
      expect(typeof e.id).toBe("string");
      expect(typeof e.operation).toBe("string");
      // Audit entries from a real DB always have these.
      expect(typeof e.author).toBe("string");
      expect(typeof e.created_at).toBe("string");
    }
  });

  test("documents-by-id.json → DocumentDetailResponse", () => {
    const fx = loadFixture("documents-by-id.json");
    const parsed = DocumentDetailResponse.parse(fx);
    expect(typeof parsed.document_id).toBe("string");
    expect(typeof parsed.doc_title).toBe("string");
    expect(typeof parsed.full_content).toBe("string");
    expect(parsed.chunk_count).toBeGreaterThan(0);
    expect(Array.isArray(parsed.versions)).toBe(true);
    expect(Array.isArray(parsed.project_ids)).toBe(true);
  });
});
