/**
 * Locate bundled docs that ship inside `@cerefox/memory`.
 *
 * The npm package's `files` array (see `packages/memory/package.json`)
 * includes `docs/` and `AGENT_GUIDE.md` + `AGENT_QUICK_REFERENCE.md` —
 * the same content that lives in the repo root, copied at build time
 * by `prepublishOnly`.
 *
 * Resolved path:
 *   - When running the bundled bin (`node dist/bin/cerefox.js`): docs
 *     live at `<package-root>/docs/`.
 *   - When running from source (`bun run cli ...` in dev): docs live at
 *     `<repo-root>/docs/` and `<repo-root>/AGENT_*.md`.
 *
 * Detection: walk up from `import.meta.dir` until we find a
 * `package.json` whose `name` is `@cerefox/memory`. The docs sit next
 * to it. Falls back to the legacy "look for AGENT_GUIDE.md" probe so
 * source-tree runs work without rebuilding.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function findPackageRoot(): string {
  // bun build collapses the bundle into a single .js; for that case
  // `import.meta.dir` ends with `/dist/bin/` (or `/dist/`).
  // For source-tree runs it ends in `/packages/memory/src/cli/util/`.
  // In both cases, walking up until we find package.json works.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const pkgJson = join(dir, "package.json");
    if (existsSync(pkgJson)) {
      try {
        const parsed = JSON.parse(readFileSync(pkgJson, "utf8")) as { name?: string };
        if (parsed.name === "@cerefox/memory") return dir;
      } catch {
        // ignore malformed package.json
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: assume we're running from source, two levels up from
  // `packages/memory/` is the repo root.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

const PACKAGE_ROOT = findPackageRoot();

/**
 * Return the absolute path to the bundled docs directory, OR the repo's
 * `docs/` dir when running from source.
 */
export function bundledDocsDir(): string {
  const inPackage = join(PACKAGE_ROOT, "docs");
  if (existsSync(inPackage)) return inPackage;
  // Source-tree fallback: <repo-root>/docs/.
  return resolve(PACKAGE_ROOT, "..", "..", "docs");
}

/** Return the absolute path to the bundled `AGENT_GUIDE.md` (or repo copy). */
export function agentGuidePath(): string | null {
  const candidates = [
    join(PACKAGE_ROOT, "AGENT_GUIDE.md"),
    resolve(PACKAGE_ROOT, "..", "..", "AGENT_GUIDE.md"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export function agentQuickReferencePath(): string | null {
  const candidates = [
    join(PACKAGE_ROOT, "AGENT_QUICK_REFERENCE.md"),
    resolve(PACKAGE_ROOT, "..", "..", "AGENT_QUICK_REFERENCE.md"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export interface DocEntry {
  topic: string;
  path: string;
  size: number;
}

/**
 * List every bundled `.md` doc under `docs/guides/` plus the AGENT_*
 * pair. Topic name is the filename without extension (e.g. "quickstart",
 * "agent-guide"). Used by `cerefox docs` and `cerefox sync-self-docs`.
 */
export function listBundledDocs(): DocEntry[] {
  const entries: DocEntry[] = [];
  const docsDir = bundledDocsDir();
  const guidesDir = join(docsDir, "guides");
  if (existsSync(guidesDir) && statSync(guidesDir).isDirectory()) {
    for (const name of readdirSync(guidesDir)) {
      if (!name.endsWith(".md")) continue;
      const full = join(guidesDir, name);
      entries.push({
        topic: name.replace(/\.md$/, ""),
        path: full,
        size: statSync(full).size,
      });
    }
  }
  const ag = agentGuidePath();
  if (ag) entries.push({ topic: "agent-guide", path: ag, size: statSync(ag).size });
  const aqr = agentQuickReferencePath();
  if (aqr) {
    entries.push({
      topic: "agent-quick-reference",
      path: aqr,
      size: statSync(aqr).size,
    });
  }
  entries.sort((a, b) => a.topic.localeCompare(b.topic));
  return entries;
}

/** Read a bundled doc by topic name; returns null if not found. */
export function readBundledDoc(topic: string): { topic: string; content: string; path: string } | null {
  const entry = listBundledDocs().find((d) => d.topic === topic);
  if (!entry) return null;
  return {
    topic: entry.topic,
    path: entry.path,
    content: readFileSync(entry.path, "utf8"),
  };
}
