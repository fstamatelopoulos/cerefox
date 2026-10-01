/**
 * Search must not let the approximate HNSW index pick its vector candidates
 * (schema 0.18.1).
 *
 * pgvector's HNSW scan returns at most `hnsw.ef_search` rows (40 by default)
 * and, on a store whose index has seen heavy version churn, not the nearest
 * ones: a hybrid search received far fewer vector candidates than it asked
 * for, most of them outside the true nearest set, so documents that matched by meaning
 * were scored as if they had not. The planner uses the index only when a query
 * orders by the bare `embedding <=> query` distance (which the RPCs' CASE folds
 * to once p_use_upgrade is known), so the search RPCs order by the computed
 * similarity instead. An exact scan is also faster at knowledge-base scale.
 *
 * Pure text analysis of rpcs.sql.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RPCS = readFileSync(join(import.meta.dir, "..", "..", "src", "cerefox", "db", "rpcs.sql"), "utf8");

function body(name: string): string {
  const start = RPCS.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = RPCS.indexOf("\n$$;", start);
  return RPCS.slice(start, end);
}

/** Every ORDER BY clause, up to its LIMIT. */
function orderBys(src: string): string[] {
  return [...src.matchAll(/ORDER BY([\s\S]*?)LIMIT/g)].map((m) => m[1]!);
}

describe("search RPCs order vector candidates exactly (0.18.1)", () => {
  for (const fn of ["cerefox_hybrid_search", "cerefox_semantic_search"]) {
    test(`${fn} never orders by the bare distance operator`, () => {
      const clauses = orderBys(body(fn));
      expect(clauses.length).toBeGreaterThan(0);
      for (const c of clauses) expect(c).not.toContain("<=>");
    });
  }

  test("keyword matches carry their exact cosine into fusion", () => {
    const hybrid = body("cerefox_hybrid_search");
    expect(hybrid).toContain("AS fts_vec_score");
    expect(hybrid).toContain("COALESCE(v.vec_score, f.fts_vec_score, 0.0)");
  });
});
