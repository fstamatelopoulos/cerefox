/**
 * Every script under `scripts/` is either documented or deliberately classified.
 *
 * `docs/guides/ops-scripts.md` is the only reference a contributor has for the
 * operational scripts, and CLAUDE.md advertises it as covering "All `scripts/`".
 * It did not. When this test was written there were 15 scripts on disk and 7 in
 * the guide's table: `gen_openapi.ts` and `cerefox_export.ts` had shipped without
 * an entry, and `cut_release.ts` had never had one.
 *
 * Same shape as every other drift this project has hit — a hand-maintained list
 * that has to match another list, which is why the route table, the Data API
 * grants, the config catalog and the Node floor are all derived rather than
 * written. So the list is derived from `scripts/*.ts`, and a script that is NOT
 * operator-facing has to be named in `NOT_OPERATOR_FACING` **with a reason**.
 * That turns an omission from something you forget into something you decide.
 *
 * Deliberately NOT checked: whether a documented script's flags or behavior are
 * still accurate. That is a human judgment, and a test that pretended to cover
 * it would be worse than one that admits the boundary.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");
const GUIDE = join(REPO_ROOT, "docs", "guides", "ops-scripts.md");

/**
 * Scripts nobody runs by hand, each with why. A build step or a CI check has no
 * place in an operator's guide; being in this map is the claim that it is one.
 */
const NOT_OPERATOR_FACING: Record<string, string> = {
  "bundle_help.ts": "prepublishOnly step — bundles AGENT_QUICK_REFERENCE into get_help",
  "bundle_package_docs.ts": "prepublishOnly step — copies curated guides into the package",
  "bundle_server_assets.ts": "prepublishOnly step — bundles the SQL assets",
  "check_ef_parity.ts": "CI check — Edge Function parity",
  "check_help_bundle.ts": "CI check — the bundled help matches its source",
};

function scriptsOnDisk(): string[] {
  return readdirSync(SCRIPTS_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort();
}

/** Mentioned anywhere in the guide — a table row, a heading, or a command line. */
function documented(guide: string, script: string): boolean {
  return guide.includes(script);
}

describe("docs/guides/ops-scripts.md covers the scripts a contributor runs", () => {
  const scripts = scriptsOnDisk();
  const guide = readFileSync(GUIDE, "utf8");

  test("the scan finds the scripts it is meant to police", () => {
    // A guard that inspected an empty directory would pass while checking
    // nothing — the vacuous shape this repo has shipped before.
    expect(scripts.length).toBeGreaterThanOrEqual(12);
    expect(scripts).toContain("gen_openapi.ts");
    expect(scripts).toContain("cerefox_export.ts");
    expect(guide.length).toBeGreaterThan(2000);
  });

  test("every script is documented or classified as not operator-facing", () => {
    const unaccounted = scripts.filter(
      (s) => !documented(guide, s) && !(s in NOT_OPERATOR_FACING),
    );
    expect(unaccounted).toEqual([]);
  });

  test("nothing is classified as internal AND documented as operational", () => {
    // If a script grows an operator-facing mode it should leave the map, or the
    // map becomes a lie that outlives whoever wrote it.
    const both = Object.keys(NOT_OPERATOR_FACING).filter((s) =>
      guide.includes(`## ${s}`),
    );
    expect(both).toEqual([]);
  });

  test("the classification map has no entries for scripts that no longer exist", () => {
    // The other direction of the same drift: a deleted script leaving a stale
    // excuse behind, which then silently covers a NEW script of the same name.
    const ghosts = Object.keys(NOT_OPERATOR_FACING).filter((s) => !scripts.includes(s));
    expect(ghosts).toEqual([]);
  });

  test("every classification carries a reason", () => {
    const empty = Object.entries(NOT_OPERATOR_FACING)
      .filter(([, why]) => why.trim().length < 15)
      .map(([s]) => s);
    expect(empty).toEqual([]);
  });

  test("it fires on a new undocumented script", () => {
    // The shape it exists to catch: a script added with no guide entry. Proven
    // against a synthetic name so the assertion cannot pass by accident.
    const pretend = [...scripts, "totally_new_script.ts"];
    const unaccounted = pretend.filter(
      (s) => !documented(guide, s) && !(s in NOT_OPERATOR_FACING),
    );
    expect(unaccounted).toEqual(["totally_new_script.ts"]);
  });
});
