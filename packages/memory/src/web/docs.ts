/**
 * Bundled-docs resolver — TS equivalent of `src/cerefox/docs_resources.py`.
 *
 * Two modes (matching Python's resolver):
 *   1. Bundled: `<pkg>/docs/guides/*.md` + top-level `README.md`,
 *      `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`. Populated at publish
 *      time by `scripts/bundle_package_docs.ts`.
 *   2. Source / dev: `<repo>/docs/guides/*.md` + repo-root markdown.
 *
 * Paths are forward-slash form (`README.md`, `guides/quickstart.md`) and
 * are stable across modes — `GET /api/v1/docs/<path>` works identically
 * regardless of whether the server is running from source or npm.
 *
 * Path-traversal: `readDoc` only opens files whose resolved path stays
 * inside the docs root. Any `../` that escapes returns null.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TOP_LEVEL_DOCS: ReadonlyArray<{
  filename: string;
  path: string;
  category: string;
}> = [
  { filename: "README.md", path: "README.md", category: "readme" },
  {
    filename: "AGENT_GUIDE.md",
    path: "AGENT_GUIDE.md",
    category: "agent-guide",
  },
  {
    filename: "AGENT_QUICK_REFERENCE.md",
    path: "AGENT_QUICK_REFERENCE.md",
    category: "agent-guide",
  },
];

export interface DocEntry {
  path: string;
  title: string;
  category: string;
}

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/**
 * Resolve the package directory holding bundled docs.
 *
 * In built mode, `import.meta.url` is `<install>/dist/bin/cerefox.js` and
 * the bundled docs live at `<install>/docs/` (one level up from dist/).
 * In source mode, the same module path walks back to `<repo>/packages/memory/`,
 * where `docs/guides/` exists only after `bundle-docs` has run; we fall
 * back to the repo root in that case.
 */
function resolveDocsRoots(): {
  pkgGuides: string | null;
  pkgTopLevel: string | null;
  repoGuides: string | null;
  repoTopLevel: string | null;
} {
  const here = moduleDir();
  // Built bundle: <install>/dist/bin/cerefox.js → <install>/docs/
  // Source static.ts: <repo>/packages/memory/src/web/docs.ts → <repo>/packages/memory/docs/
  const pkgRootCandidates = [
    join(here, "..", ".."),
    join(here, "..", "..", "..", ".."),
  ];
  let pkgGuides: string | null = null;
  let pkgTopLevel: string | null = null;
  for (const pkg of pkgRootCandidates) {
    const guides = join(pkg, "docs", "guides");
    if (existsSync(guides) && statSync(guides).isDirectory()) {
      pkgGuides = guides;
      pkgTopLevel = pkg;
      break;
    }
  }

  // Repo fallback: <repo>/docs/guides/ + repo-root README/AGENT_*.
  // Source mode: <repo>/packages/memory/src/web/docs.ts → 4 levels up = <repo>.
  const repoCandidate = join(here, "..", "..", "..", "..");
  const repoGuides = join(repoCandidate, "docs", "guides");
  const repoTopLevel = repoCandidate;

  return {
    pkgGuides,
    pkgTopLevel,
    repoGuides: existsSync(repoGuides) ? repoGuides : null,
    repoTopLevel: existsSync(join(repoTopLevel, "README.md"))
      ? repoTopLevel
      : null,
  };
}

function readH1(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf8");
    const match = content.match(/^#\s+(.+?)\s*$/m);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function slugifiedTitle(filename: string): string {
  return filename
    .replace(/\.md$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function entryForFile(absPath: string, relPath: string, category: string): DocEntry {
  const title = readH1(absPath) ?? slugifiedTitle(basename(relPath));
  return { path: relPath, title, category };
}

export function listBundledDocs(): DocEntry[] {
  const { pkgGuides, pkgTopLevel, repoGuides, repoTopLevel } = resolveDocsRoots();
  const entries: DocEntry[] = [];

  const topRoot = pkgTopLevel ?? repoTopLevel;
  if (topRoot) {
    for (const t of TOP_LEVEL_DOCS) {
      const abs = join(topRoot, t.filename);
      if (existsSync(abs)) {
        entries.push(entryForFile(abs, t.path, t.category));
      }
    }
  }

  const guidesRoot = pkgGuides ?? repoGuides;
  if (guidesRoot) {
    const names = readdirSync(guidesRoot)
      .filter((n) => n.endsWith(".md"))
      .sort();
    for (const name of names) {
      const abs = join(guidesRoot, name);
      entries.push(entryForFile(abs, `guides/${name}`, "guide"));
    }
  }

  return entries;
}

/**
 * Read a single bundled doc. Returns null when the path doesn't exist or
 * the resolved absolute path escapes the docs roots (path-traversal).
 */
export function readDoc(docPath: string): string | null {
  const { pkgTopLevel, repoTopLevel } = resolveDocsRoots();
  const roots = [pkgTopLevel, repoTopLevel].filter((r): r is string => r !== null);
  for (const root of roots) {
    const candidate = resolve(root, docPath);
    if (!candidate.startsWith(resolve(root) + "/") && candidate !== resolve(root)) {
      continue;
    }
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      try {
        return readFileSync(candidate, "utf8");
      } catch {
        return null;
      }
    }
  }
  return null;
}
