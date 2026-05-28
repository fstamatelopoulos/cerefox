#!/usr/bin/env bun
/**
 * bundle_package_docs.ts — copy repo-root docs into the npm package's
 * publish tree so `@cerefox/memory` ships with the bundled docs that
 * `cerefox docs` and `cerefox sync-self-docs` read at runtime.
 *
 * Called from `packages/memory/package.json#prepublishOnly`. The
 * copied directory (`packages/memory/docs/`) is gitignored — it's a
 * build artifact, not source.
 *
 * What we copy:
 *   <repo>/docs/guides/*.md              → packages/memory/docs/guides/
 *   <repo>/AGENT_GUIDE.md                → packages/memory/AGENT_GUIDE.md
 *   <repo>/AGENT_QUICK_REFERENCE.md      → packages/memory/AGENT_QUICK_REFERENCE.md
 *
 * What we don't copy:
 *   docs/specs/, docs/research/, docs/plan.md — contributor-internal
 *   files. End users don't need them; bundling them just inflates the
 *   tarball.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_ROOT = join(REPO_ROOT, "packages", "memory");

const SRC_GUIDES = join(REPO_ROOT, "docs", "guides");
const DST_GUIDES = join(PKG_ROOT, "docs", "guides");

const TOP_LEVEL_DOCS = ["AGENT_GUIDE.md", "AGENT_QUICK_REFERENCE.md"];

function copyTree(src: string, dst: string): number {
  if (!existsSync(src)) {
    console.error(`bundle_package_docs: source ${src} does not exist; skipping.`);
    return 0;
  }
  mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const name of readdirSync(src)) {
    const full = join(src, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      count += copyTree(full, join(dst, name));
    } else if (name.endsWith(".md")) {
      copyFileSync(full, join(dst, name));
      count++;
    }
  }
  return count;
}

function cleanDir(dst: string): void {
  if (existsSync(dst)) {
    rmSync(dst, { recursive: true, force: true });
  }
}

const wantedGuides = (() => {
  // Curated subset — only guides that an end user (or an agent
  // searching the KB) benefits from. Spec/plan/research docs stay in
  // the repo, not bundled.
  return new Set([
    "quickstart.md",
    "setup-supabase.md",
    "setup-local.md",
    "setup-cloud-run.md",
    "configuration.md",
    "connect-agents.md",
    "access-paths.md",
    "agent-coordination.md",
    "cli.md",
    "ops-scripts.md",
    "operational-cost.md",
    "response-limits.md",
    "upgrading.md",
    // migration-v0.4.md is intentionally NOT in the npm bundle from v0.6
    // onward — anyone reading docs in @cerefox/memory is way past v0.4,
    // and the historical guide stays available in git for the long tail.
    "migration-v0.5.md", // may or may not exist yet — copy if present
  ]);
})();

function copyCuratedGuides(src: string, dst: string): number {
  if (!existsSync(src)) {
    console.error(`bundle_package_docs: ${src} does not exist; skipping.`);
    return 0;
  }
  mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const name of readdirSync(src)) {
    if (!wantedGuides.has(name)) continue;
    copyFileSync(join(src, name), join(dst, name));
    count++;
  }
  return count;
}

console.error("bundle_package_docs: cleaning previous bundle…");
cleanDir(join(PKG_ROOT, "docs"));
for (const name of TOP_LEVEL_DOCS) {
  const dst = join(PKG_ROOT, name);
  if (existsSync(dst)) rmSync(dst);
}

console.error("bundle_package_docs: copying curated docs/guides/…");
const guideCount = copyCuratedGuides(SRC_GUIDES, DST_GUIDES);

console.error("bundle_package_docs: copying root-level agent docs…");
let topCount = 0;
for (const name of TOP_LEVEL_DOCS) {
  const src = join(REPO_ROOT, name);
  const dst = join(PKG_ROOT, name);
  if (existsSync(src)) {
    copyFileSync(src, dst);
    topCount++;
  } else {
    console.error(`bundle_package_docs: ${src} not found; skipping.`);
  }
}

console.error(
  `bundle_package_docs: ✓ ${guideCount} guide(s) + ${topCount} top-level doc(s) bundled.`,
);
