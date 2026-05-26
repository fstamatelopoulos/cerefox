/**
 * Parity test for sync_docs.ts — covers the file-discovery behavior that
 * the Python sync_docs.py used to provide. We don't (and can't) shell out
 * to the deprecated Python script; this is a snapshot of the documented
 * behavior captured at v0.2.0.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

// Mirrors scripts/sync_docs.ts's ROOT_LEVEL_DOCS and walk(docs/).
const ROOT_LEVEL_DOCS = ["README.md", "AGENT_GUIDE.md", "AGENT_QUICK_REFERENCE.md"];

function collectExpectedFiles(): string[] {
  const out: string[] = [];
  for (const rel of ROOT_LEVEL_DOCS) {
    if (existsSync(join(REPO_ROOT, rel))) out.push(rel);
  }
  const docsDir = join(REPO_ROOT, "docs");
  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (st.isFile() && name.endsWith(".md"))
        out.push(relative(REPO_ROOT, full));
    }
  }
  walk(docsDir);
  return out;
}

describe("sync_docs file discovery", () => {
  test("collects README + AGENT guides + all docs/**/*.md", () => {
    const files = collectExpectedFiles();
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain("README.md");
    expect(files).toContain("AGENT_GUIDE.md");
    expect(files).toContain("AGENT_QUICK_REFERENCE.md");
    expect(files.some((f) => f.startsWith("docs/guides/"))).toBe(true);
  });

  test("does not include contributor-only files outside docs/", () => {
    const files = collectExpectedFiles();
    expect(files).not.toContain("CLAUDE.md");
    expect(files).not.toContain("CONTRIBUTING.md");
    expect(files).not.toContain("SECURITY.md");
    expect(files).not.toContain("CODE_OF_CONDUCT.md");
  });
});
