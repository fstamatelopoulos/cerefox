/**
 * Every `_shared/` subtree the Edge Functions import must be in the bundle.
 *
 * `scripts/bundle_server_assets.ts` copies an allow-list of `_shared` subtrees
 * into the npm package so that `cerefox server deploy` can deploy the Edge
 * Functions from an installed package rather than a repo clone. Allow-lists
 * fail silently in one direction: add a shared module, import it from an EF,
 * forget the list, and everything passes — unit tests, typecheck, the local MCP
 * server, the CLI — because they all resolve against the repo, where the file
 * exists.
 *
 * The failure only appears at deploy time, on a user's machine, as:
 *
 *     Module not found "file:///…/source/_shared/partial-edits/index.ts"
 *     ✗ 1 Edge Function(s) failed: cerefox-mcp
 *
 * which is exactly what v1.3.0-beta.1 did: 8 of 9 functions deployed, and the
 * ninth — the remote MCP server — could not bundle. Recoverable (the previous
 * deployment keeps serving) but it takes a new release to fix properly.
 *
 * So this walks the import graph from the EF entry points, collects every
 * `_shared/<sub>` actually reachable, and asserts the list covers it.
 *
 * Pure text analysis of the repo. No network, no deploy.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { SHARED_SUBTREES } from "../../scripts/bundle_server_assets.ts";

const REPO = join(import.meta.dir, "..", "..");
const FUNCTIONS = join(REPO, "supabase", "functions");
const SHARED = join(REPO, "_shared");

/** Every relative import in a TS file, as written. */
function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return [...src.matchAll(/from\s+["'](\.[^"']+)["']/g)].map((m) => m[1]);
}

/**
 * Walk the import graph from every EF entry point and return the set of
 * `_shared/<sub>` directories reached.
 */
function reachableSharedSubtrees(): Set<string> {
  const reached = new Set<string>();
  const seen = new Set<string>();

  const visit = (file: string): void => {
    const real = resolve(file);
    if (seen.has(real) || !existsSync(real)) return;
    seen.add(real);

    const rel = relative(SHARED, real);
    if (!rel.startsWith("..")) {
      const sub = rel.split("/")[0];
      if (sub) reached.add(sub);
    }

    for (const spec of importsOf(real)) {
      // Deno-style imports carry the extension, so no resolution guessing.
      visit(join(dirname(real), spec));
    }
  };

  for (const fn of readdirSync(FUNCTIONS)) {
    const entry = join(FUNCTIONS, fn, "index.ts");
    if (existsSync(entry) && statSync(entry).isFile()) visit(entry);
  }
  return reached;
}

describe("server-asset bundle covers what the Edge Functions import", () => {
  test("every reachable _shared subtree is in SHARED_SUBTREES", () => {
    const reached = [...reachableSharedSubtrees()].sort();
    const bundled = [...SHARED_SUBTREES];
    const missing = reached.filter((s) => !bundled.includes(s as never));

    // Missing entries are the bug this test exists for: the package would ship
    // without them and `cerefox server deploy` would fail at bundle time.
    expect(missing).toEqual([]);
    // Sanity: the walk found something, so a broken walk cannot pass vacuously.
    expect(reached.length).toBeGreaterThan(3);
  });

  test("the import walk reaches the partial-edits module", () => {
    // The specific regression: get-document.ts and partial-edits.ts import it,
    // and it was omitted from the bundle for the whole of v1.3.0-beta.1.
    expect([...reachableSharedSubtrees()]).toContain("partial-edits");
  });

  test("SHARED_SUBTREES lists nothing that does not exist", () => {
    for (const sub of SHARED_SUBTREES) {
      expect(existsSync(join(SHARED, sub))).toBe(true);
    }
  });
});
