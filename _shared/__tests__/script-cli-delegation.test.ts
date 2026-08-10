/**
 * A contributor script that duplicates a CLI operation must **delegate** to the
 * CLI, not carry its own copy of the logic (#194).
 *
 * `scripts/backup_create.ts` and `backup_restore.ts` used to implement capture
 * and restore themselves via a `_shared/backup/` module. Every #166 fix landed
 * in the CLI command — memberships in v1.0.7, relations and `lifecycle_status`
 * in v1.1.0 — and none reached the scripts. They stayed on backup format 1 for
 * two releases while compiling, running, reporting success, and writing a file.
 *
 * The only symptom was a snapshot missing tables, discoverable by opening the
 * JSON. And `docs/guides/ops-scripts.md` pointed at exactly that path as the
 * pre-migration safety step — so the backup taken to make a migration
 * reversible was the incomplete one.
 *
 * This guards the class, not the instance. The rule is deliberately narrow:
 *
 * - It applies only to scripts with a **CLI equivalent**. `cerefox_export.ts`
 *   reads the database directly and that is fine — it is a one-way markdown
 *   dump with no CLI command behind it.
 * - Build tooling (`bundle_help.ts`, `check_ef_parity.ts`, `cut_release.ts`)
 *   imports `_shared/mcp-tools` to read tool metadata. That is inspection, not
 *   a second implementation.
 *
 * So: a registered script must spawn the CLI with the expected verb, and must
 * not import the data-access modules that would let it do the work itself.
 *
 * Pure text analysis. No network, no execution.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..", "..");
const script = (name: string) => readFileSync(join(REPO, "scripts", name), "utf8");

/** Module specifiers from real import statements — not from comments or strings. */
function importsOf(src: string): string[] {
  return [
    ...src.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm),
    ...src.matchAll(/\bawait\s+import\(\s*["']([^"']+)["']\s*\)/g),
  ].map((m) => m[1]);
}

/**
 * Scripts that duplicate a CLI operation, and the verb they must delegate to.
 * Adding a script that wraps a CLI command means adding a row here.
 */
const DELEGATING = [
  { file: "backup_create.ts", verb: ["backup", "create"] },
  { file: "backup_restore.ts", verb: ["backup", "restore"] },
  { file: "reindex_all.ts", verb: ["reindex"] },
] as const;

/**
 * Modules that would let a script re-implement rather than delegate. These are
 * data access and content processing — the ingredients of a second copy.
 * `cli-core`, `config`, `db-deploy`, `server-assets` are infrastructure and stay
 * allowed.
 */
const REIMPLEMENTATION_MODULES = ["db-client", "embeddings", "ingest", "partial-edits", "backup"];

describe("contributor scripts delegate to the CLI (#194)", () => {
  for (const { file, verb } of DELEGATING) {
    test(`${file} spawns the CLI`, () => {
      const src = script(file);
      // Either spawn or spawnSync; both are delegation.
      expect(/\bspawn(Sync)?\s*\(/.test(src)).toBe(true);
      expect(src).toMatch(/bin[\/"'\s,\]]|cerefox\.js|cerefox\.ts/);
    });

    test(`${file} delegates the ${verb.join(" ")} verb`, () => {
      const src = script(file);
      for (const word of verb) {
        expect(src).toContain(`"${word}"`);
      }
    });

    test(`${file} does not import re-implementation modules`, () => {
      // Match import specifiers only. Both shims *describe* the deleted
      // `_shared/backup/` module in their header comments — that history is
      // why they are shims — and a guard that fires on prose is a guard
      // people learn to ignore.
      const found = REIMPLEMENTATION_MODULES.filter((m) =>
        importsOf(script(file)).some((spec) => spec.includes(`_shared/${m}/`)),
      );
      // This is the #166 shape: the script grows its own capture/restore path
      // and silently diverges from the command it is supposed to mirror.
      expect(found).toEqual([]);
    });
  }

  test("_shared/backup does not come back", () => {
    // Deleted in v1.3.0. Its return would mean a second implementation exists
    // again, which is the whole defect.
    expect(existsSync(join(REPO, "_shared", "backup"))).toBe(false);
  });

  test("the detector fires on the shape it exists to catch", () => {
    // Without this, a matcher that silently stopped matching would leave every
    // assertion above passing vacuously — the same failure mode as the bug.
    const reimplementing = `
      import { createClient } from "../_shared/db-client/index.js";
      import { embedBatch } from "../_shared/embeddings/index.js";
    `;
    const found = REIMPLEMENTATION_MODULES.filter((m) =>
      importsOf(reimplementing).some((spec) => spec.includes(`_shared/${m}/`)),
    );
    expect(found).toEqual(["db-client", "embeddings"]);

    // And a header comment mentioning the module is not an import.
    const commentOnly = `/** previously carried its own logic via \`_shared/backup/\` */`;
    expect(importsOf(commentOnly)).toEqual([]);
  });

  test("the registry names scripts that actually exist", () => {
    for (const { file } of DELEGATING) {
      expect(existsSync(join(REPO, "scripts", file))).toBe(true);
    }
  });
});
