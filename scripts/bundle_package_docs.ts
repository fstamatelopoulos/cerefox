#!/usr/bin/env bun
/**
 * bundle_package_docs.ts — copy repo docs into the npm package's publish tree
 * so `@cerefox/memory` ships with the docs the web server (`GET /api/v1/docs`,
 * `GET /api/v1/openapi.json`) and `cerefox guides …` read at runtime.
 *
 * Called from `packages/memory/package.json#prepublishOnly`. The copied
 * directory (`packages/memory/docs/`) is gitignored — it's a build artifact,
 * not source. The Cerefox Local image is built from the same step.
 *
 * What we copy:
 *   <repo>/docs/guides/*.md              → packages/memory/docs/guides/
 *                                          (EVERY guide, minus GUIDE_EXCLUSIONS)
 *   <repo>/docs/api/openapi.json         → packages/memory/docs/api/openapi.json
 *   <repo>/AGENT_GUIDE.md                → packages/memory/AGENT_GUIDE.md
 *   <repo>/AGENT_QUICK_REFERENCE.md      → packages/memory/AGENT_QUICK_REFERENCE.md
 *
 * What we don't copy:
 *   docs/specs/, docs/research/, docs/plan.md — contributor-internal files.
 *
 * ## Why every guide by default
 *
 * This used to copy a hand-written list of 15 guides. Every guide written after
 * the list was not shipped — `api.md`, `securing-local-access.md`, `linking.md`,
 * `staging-env.md` — so a store could not serve its own API guide, and an agent
 * asking a Local store how its API works was sent to the repo (#303). A list
 * that has to match a directory drifts; the directory is the list now, and a
 * guide stays out only by being named below WITH a reason.
 * `_shared/__tests__/package-docs.test.ts` checks the exclusions in both
 * directions, so a deleted guide cannot leave a stale excuse behind.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_ROOT = join(REPO_ROOT, "packages", "memory");

const SRC_GUIDES = join(REPO_ROOT, "docs", "guides");
const DST_GUIDES = join(PKG_ROOT, "docs", "guides");
const SRC_OPENAPI = join(REPO_ROOT, "docs", "api", "openapi.json");
const DST_OPENAPI = join(PKG_ROOT, "docs", "api", "openapi.json");

const TOP_LEVEL_DOCS = ["AGENT_GUIDE.md", "AGENT_QUICK_REFERENCE.md"];

/**
 * Guides deliberately NOT shipped, each with the reason. Empty today: every
 * guide in `docs/guides/` is written for someone running Cerefox. Add one only
 * with a reason a user would accept, e.g. "describes the maintainers' release
 * process"; "not needed" is how the old list lost four guides.
 */
export const GUIDE_EXCLUSIONS: Record<string, string> = {};

/** The guides that ship, given the `.md` files in `docs/guides/`. */
export function guidesToBundle(names: string[]): string[] {
  return names.filter((n) => n.endsWith(".md") && !(n in GUIDE_EXCLUSIONS)).sort();
}

function main(): void {
  console.error("bundle_package_docs: cleaning previous bundle…");
  rmSync(join(PKG_ROOT, "docs"), { recursive: true, force: true });
  for (const name of TOP_LEVEL_DOCS) rmSync(join(PKG_ROOT, name), { force: true });

  console.error("bundle_package_docs: copying docs/guides/…");
  mkdirSync(DST_GUIDES, { recursive: true });
  const guides = guidesToBundle(readdirSync(SRC_GUIDES));
  for (const name of guides) copyFileSync(join(SRC_GUIDES, name), join(DST_GUIDES, name));

  // The API description the server serves at GET /api/v1/openapi.json. A
  // missing file fails the publish rather than shipping a server that 404s on
  // its own contract.
  if (!existsSync(SRC_OPENAPI)) {
    throw new Error(`bundle_package_docs: ${SRC_OPENAPI} is missing. Run: bun scripts/gen_openapi.ts`);
  }
  mkdirSync(dirname(DST_OPENAPI), { recursive: true });
  copyFileSync(SRC_OPENAPI, DST_OPENAPI);

  console.error("bundle_package_docs: copying root-level agent docs…");
  let topCount = 0;
  for (const name of TOP_LEVEL_DOCS) {
    const src = join(REPO_ROOT, name);
    if (existsSync(src)) {
      copyFileSync(src, join(PKG_ROOT, name));
      topCount++;
    } else {
      console.error(`bundle_package_docs: ${src} not found; skipping.`);
    }
  }

  console.error(
    `bundle_package_docs: ✓ ${guides.length} guide(s), openapi.json and ${topCount} top-level doc(s) bundled.`,
  );
}

if (import.meta.main) main();
