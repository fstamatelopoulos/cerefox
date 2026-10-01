/**
 * The min_term_coverage default must mean what its documentation says
 * (schema 0.18.2).
 *
 * The gate is `terms_matched >= coverage * total_terms`. 0.18.0 shipped 0.67,
 * described as "two of three", but 0.67 * 3 = 2.01, so a three-term query
 * needed all three terms in one chunk. On real data that made multi-word keyword
 * queries rank markedly worse while every synthetic category looked fine.
 * A k-of-n rule needs the value at or below k/n; this pins the arithmetic, not
 * the prose.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_CATALOG } from "../config-catalog/index.ts";

const RPCS = readFileSync(join(import.meta.dir, "..", "..", "src", "cerefox", "db", "rpcs.sql"), "utf8");
const sqlDefaults = [...RPCS.matchAll(/cerefox_config_float\('min_term_coverage', ([0-9.]+)\)/g)].map((m) => Number(m[1]));
const catalogDefault = Number(CONFIG_CATALOG.find((k) => k.key === "min_term_coverage")!.defaultValue);
/** Terms a chunk must match, exactly as the RPC compares. */
const needed = (coverage: number, n: number) => {
  for (let k = 0; k <= n; k++) if (k >= coverage * n) return k;
  return n + 1;
};

describe("min_term_coverage default (0.18.2)", () => {
  test("every RPC and the config catalog agree on one value", () => {
    expect(sqlDefaults.length).toBeGreaterThanOrEqual(2);
    expect(new Set([...sqlDefaults, catalogDefault]).size).toBe(1);
  });

  test("it is a two-of-three rule: 2 of 2, 2 of 3, 3 of 4, 4 of 5, 4 of 6", () => {
    expect([2, 3, 4, 5, 6].map((n) => needed(catalogDefault, n))).toEqual([2, 2, 3, 4, 4]);
  });

  test("the shipped 0.67 really did require all three of three (the bug this pins)", () => {
    expect(needed(0.67, 3)).toBe(3);
  });
});
