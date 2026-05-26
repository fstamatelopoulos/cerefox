#!/usr/bin/env bun
/**
 * sync_docs.ts — TypeScript port of scripts/sync_docs.py (v0.3.0).
 *
 * Ingests README.md, AGENT_GUIDE.md, AGENT_QUICK_REFERENCE.md, and every
 * Markdown file under docs/ into the specified Cerefox project. Existing
 * documents are updated in place (matched by source path), so this is a
 * safe-to-rerun "keep my Cerefox project in sync with the repo docs" script.
 *
 * Usage:
 *   bun scripts/sync_docs.ts
 *   bun scripts/sync_docs.ts --project "My Project"
 *   bun scripts/sync_docs.ts --dry-run
 *
 * Requires:
 *   CEREFOX_SUPABASE_URL       — base URL of the Supabase project
 *   CEREFOX_SUPABASE_ANON_KEY  — legacy anon JWT used to invoke Edge Functions
 *
 * Why not import the chunking + embedding code locally? Because the Python
 * ingestion pipeline isn't ported to TS until v0.7. For v0.3.0 we delegate
 * to the existing `cerefox-ingest` Edge Function — same path GPT Actions and
 * remote MCP use. One round-trip per file; no embedding logic in TS yet.
 */

import { readFileSync, statSync, readdirSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { env, exit } from "node:process";

import { loadSettings } from "../_shared/config/index.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Targets — kept in sync with scripts/sync_docs.py for parity.
const ROOT_LEVEL_DOCS = ["README.md", "AGENT_GUIDE.md", "AGENT_QUICK_REFERENCE.md"];
const DOCS_DIR = join(REPO_ROOT, "docs");

interface DocFile {
  absPath: string;
  sourcePath: string; // repo-relative path, used as the document source path
}

function collectFiles(): DocFile[] {
  const files: DocFile[] = [];

  for (const rel of ROOT_LEVEL_DOCS) {
    const abs = join(REPO_ROOT, rel);
    if (existsSync(abs)) files.push({ absPath: abs, sourcePath: rel });
  }

  function walk(dir: string): void {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile() && name.endsWith(".md")) {
        files.push({ absPath: full, sourcePath: relative(REPO_ROOT, full) });
      }
    }
  }
  walk(DOCS_DIR);

  return files;
}

function extractTitle(content: string, fallback: string): string {
  for (const line of content.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("# ")) return t.slice(2).trim();
  }
  return fallback.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Args {
  project: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { project: "cerefox", dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "-n") {
      out.dryRun = true;
    } else if (a === "--project" || a === "-p") {
      const next = argv[i + 1];
      if (!next) {
        console.error("--project requires an argument");
        exit(2);
      }
      out.project = next;
      i++;
    } else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Usage:",
          "  bun scripts/sync_docs.ts [OPTIONS]",
          "",
          "Options:",
          "  --project, -p NAME    Project to assign documents to (default: 'cerefox')",
          "  --dry-run, -n         List files that would be synced; do not ingest.",
        ].join("\n"),
      );
      exit(0);
    } else {
      console.error(`Unknown argument: ${a}`);
      exit(2);
    }
  }
  return out;
}

interface IngestResult {
  status: number;
  body: unknown;
  err?: string;
}

async function ingestOne(
  supabaseUrl: string,
  anonKey: string,
  title: string,
  content: string,
  sourcePath: string,
  projectName: string,
): Promise<IngestResult> {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/cerefox-ingest`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({
        title,
        content,
        source: "file",
        source_path: sourcePath,
        project_name: projectName,
        update_if_exists: true,
        author: "sync_docs.ts",
        author_type: "user",
      }),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    return { status: res.status, body };
  } catch (err) {
    return { status: 0, body: null, err: (err as Error).message };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const settings = loadSettings();

  if (!settings.supabaseUrl) {
    console.error("❌  CEREFOX_SUPABASE_URL is not set in your .env.");
    exit(2);
  }
  const anonKey =
    env.CEREFOX_SUPABASE_ANON_KEY ??
    env.SUPABASE_ANON_KEY ??
    "";
  if (!anonKey) {
    console.error(
      "❌  CEREFOX_SUPABASE_ANON_KEY is not set.\n" +
        "    The Edge Function gateway requires the legacy anon JWT (eyJ…).\n" +
        "    See docs/guides/setup-supabase.md → Supabase API keys (2026).",
    );
    exit(2);
  }

  const files = collectFiles();
  console.log(`Syncing ${files.length} file(s) → project "${args.project}"`);

  if (args.dryRun) {
    console.log("  (dry run — nothing will be ingested)");
    for (const f of files) console.log(`  ${f.sourcePath}`);
    return;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const f of files) {
    let content: string;
    try {
      content = readFileSync(f.absPath, "utf8");
    } catch (err) {
      console.error(`  ✗  ${f.sourcePath}: read error — ${(err as Error).message}`);
      errors++;
      continue;
    }
    const stem = f.sourcePath.replace(/^.*[\\/]/, "").replace(/\.md$/, "");
    const title = extractTitle(content, stem);

    const result = await ingestOne(
      settings.supabaseUrl,
      anonKey,
      title,
      content,
      f.sourcePath,
      args.project,
    );

    if (result.err) {
      console.error(`  ✗  ${f.sourcePath}: ${result.err}`);
      errors++;
      continue;
    }
    if (result.status >= 400) {
      console.error(`  ✗  ${f.sourcePath}: HTTP ${result.status} — ${JSON.stringify(result.body)}`);
      errors++;
      continue;
    }

    // The Edge Function returns { action: "created" | "updated" | "skipped", ... }.
    const action =
      typeof result.body === "object" &&
      result.body !== null &&
      "action" in result.body
        ? String((result.body as { action: unknown }).action)
        : "ok";

    if (action === "skipped") {
      skipped++;
      console.log(`  =  ${f.sourcePath}  (${title})`);
    } else if (action === "updated") {
      updated++;
      console.log(`  ↑  ${f.sourcePath}  (${title})`);
    } else {
      created++;
      console.log(`  ✓  ${f.sourcePath}  (${title})`);
    }
  }

  console.log(
    `\nDone. ${created} new · ${updated} updated · ${skipped} unchanged · ${errors} errors`,
  );
  exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  exit(2);
});
