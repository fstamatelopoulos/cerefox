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
import { readdirSync, readFileSync } from "node:fs";
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

/**
 * 0.19.0 dropped the HNSW indexes outright (migration 0034): with the exact
 * scan above they served no query, while every chunk write paid to maintain
 * them. A vector index added back to schema.sql, or by a later migration,
 * would be maintained for nothing at best and, if a future ORDER BY let the
 * planner use it, would bring the 0.18.1 bug back. Adding one is a measured
 * decision (#328), so it has to delete this test on purpose.
 */
const DB = join(import.meta.dir, "..", "..", "src", "cerefox", "db");
const VECTOR_INDEX = /CREATE\s+INDEX[^;]*USING\s+(hnsw|ivfflat)/i;

describe("no vector index (0.19.0)", () => {
  test("the detector matches the DDL it exists to catch", () => {
    expect(VECTOR_INDEX.test("CREATE INDEX IF NOT EXISTS x\n    ON t USING hnsw (e vector_cosine_ops);")).toBe(true);
    expect(VECTOR_INDEX.test("create index x on t using ivfflat (e);")).toBe(true);
    expect(VECTOR_INDEX.test("CREATE INDEX x ON t USING GIN(fts);")).toBe(false);
  });

  test("schema.sql creates none", () => {
    expect(readFileSync(join(DB, "schema.sql"), "utf8")).not.toMatch(VECTOR_INDEX);
  });

  test("migration 0034 drops both former indexes", () => {
    const m = readFileSync(join(DB, "migrations", "0034_drop_vector_indexes.sql"), "utf8");
    expect(m).toContain("DROP INDEX IF EXISTS idx_cerefox_chunks_emb_primary;");
    expect(m).toContain("DROP INDEX IF EXISTS idx_cerefox_chunks_emb_upgrade;");
  });

  test("no later migration creates one", () => {
    const later = readdirSync(join(DB, "migrations")).filter((f) => f.endsWith(".sql") && f > "0034");
    for (const f of later) {
      expect(readFileSync(join(DB, "migrations", f), "utf8")).not.toMatch(VECTOR_INDEX);
    }
  });
});
