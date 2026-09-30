/**
 * The config catalog and the RPC allow-list must agree (#239).
 *
 * `cerefox config list` used to carry its own hand-written key list, and it
 * fell behind: three keys the web Settings page offered were absent from the
 * CLI. The CLI now derives from `CONFIG_CATALOG`, so there is one list to
 * keep in step with `v_allowed` in `cerefox_set_config` — and this test is
 * what keeps it there. A key in the catalog the RPC rejects is a write error
 * at runtime; a key in the RPC the catalog lacks is invisible to every UI.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CONFIG_CATALOG, validateConfigValue } from "../config-catalog/index.ts";

const RPCS = join(import.meta.dir, "..", "..", "src", "cerefox", "db", "rpcs.sql");

/** The `v_allowed TEXT[] := ARRAY[ ... ]` literal, as a sorted key list. */
function allowedKeysFromRpcs(): string[] {
  const sql = readFileSync(RPCS, "utf8");
  const m = sql.match(/v_allowed TEXT\[\] := ARRAY\[([\s\S]*?)\];/);
  if (!m) throw new Error("v_allowed literal not found in rpcs.sql");
  const body = m[1].replace(/--.*$/gm, "");
  return [...body.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
}

describe("CONFIG_CATALOG ⟷ cerefox_set_config allow-list", () => {
  test("the two key sets are identical", () => {
    const catalog = CONFIG_CATALOG.map((k) => k.key).sort();
    expect(catalog).toEqual(allowedKeysFromRpcs());
  });

  test("the parser found the list", () => {
    expect(allowedKeysFromRpcs().length).toBeGreaterThanOrEqual(10);
  });

  test("the review workflow flag is catalogued as a high-impact boolean (#241)", () => {
    const spec = CONFIG_CATALOG.find((k) => k.key === "review_workflow_enabled");
    expect(spec?.kind).toBe("boolean");
    expect(spec?.defaultValue).toBe("false");
    expect(spec?.highImpact).toBe(true);
  });
});

describe("trash auto-purge keys (#251)", () => {
  test("off by default, 60 days by default, both high-impact", () => {
    const on = CONFIG_CATALOG.find((k) => k.key === "trash_auto_purge_enabled");
    const days = CONFIG_CATALOG.find((k) => k.key === "trash_retention_days");
    expect([on?.defaultValue, on?.highImpact]).toEqual(["false", true]);
    expect([days?.defaultValue, days?.highImpact, days?.integer]).toEqual(["60", true, true]);
  });

  test("the period must be whole days between 1 and 3650", () => {
    expect(validateConfigValue("trash_retention_days", "60")).toBeNull();
    expect(validateConfigValue("trash_retention_days", "1")).toBeNull();
    for (const bad of ["0", "-1", "1.5", "3651", "abc", ""]) {
      expect({ bad, ok: validateConfigValue("trash_retention_days", bad) === null }).toEqual({ bad, ok: false });
    }
  });
});
