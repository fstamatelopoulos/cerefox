/**
 * Guard against the #183 defect class: a parameter whose value is meant to come
 * from `cerefox_config` must declare `DEFAULT NULL`.
 *
 * The RPCs resolve settings as `COALESCE(p_param, cerefox_config_*(key, builtin))`.
 * That chain only reaches the store when the parameter arrives NULL — and it
 * arrives NULL only when the caller omits it AND the declared default is NULL.
 * Give the parameter a concrete default instead and PostgreSQL substitutes that
 * value on every omitted call, so the COALESCE short-circuits on argument one
 * and the store's setting is never read.
 *
 * That is exactly what happened in #183: `cerefox_ingest_document` kept
 * `p_retention_hours INT DEFAULT 48` / `p_cleanup_enabled BOOLEAN DEFAULT TRUE`
 * after v1.1.0 moved retention into the config table. It is the only caller of
 * `cerefox_snapshot_version`, so the store's policy was inert on the one path
 * that writes — `version_cleanup_enabled = false` was silently ignored and
 * version history was pruned against the operator's explicit instruction.
 *
 * The failure is invisible at runtime: nothing errors, and the config table
 * keeps reporting the setting the operator chose. Only the behaviour disagrees.
 * So the check is static — parse the SQL and assert the declaration.
 *
 * Pure text analysis of `rpcs.sql`. No DB, no network.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RPCS = readFileSync(
  join(import.meta.dir, "..", "..", "src", "cerefox", "db", "rpcs.sql"),
  "utf8",
);

/**
 * Parameters that must defer to `cerefox_config`. Keyed by parameter name
 * because the same setting is threaded through several RPCs under one name.
 */
const CONFIG_BACKED = [
  "p_retention_hours",
  "p_cleanup_enabled",
  "p_alpha",
  "p_min_term_coverage",
] as const;

/** All declarations of `param  TYPE  DEFAULT <value>` in a CREATE FUNCTION list. */
function declarationsOf(param: string): string[] {
  const re = new RegExp(`^\\s*${param}\\s+[A-Z0-9()]+\\s+DEFAULT\\s+([^,\\n]+)`, "gim");
  return [...RPCS.matchAll(re)].map((m) => m[1].trim().replace(/,$/, ""));
}

describe("config-backed RPC parameters default to NULL (#183)", () => {
  for (const param of CONFIG_BACKED) {
    test(`${param} is never given a concrete default`, () => {
      const defaults = declarationsOf(param);
      // A typo in the parameter name would make this vacuously pass.
      expect(defaults.length).toBeGreaterThan(0);
      for (const d of defaults) expect(d.toUpperCase()).toBe("NULL");
    });
  }

  test("cerefox_ingest_document forwards retention to snapshot_version unresolved", () => {
    // It must hand the parameters straight through. Resolving them here — or
    // substituting its own fallbacks — would reinstate #183 one layer up.
    expect(RPCS).toContain(
      "cerefox_snapshot_version(v_doc_id, p_source_label, p_retention_hours, p_cleanup_enabled)",
    );
  });

  test("cerefox_snapshot_version resolves retention through cerefox_config", () => {
    const body = RPCS.slice(RPCS.indexOf("CREATE FUNCTION cerefox_snapshot_version"));
    expect(body).toContain("cerefox_config_int('version_retention_hours'");
    expect(body).toContain("cerefox_config_bool('version_cleanup_enabled'");
  });
});
