/**
 * `cerefox sync-docs` — sync repo docs into a Cerefox project.
 *
 * Direct port of `scripts/sync_docs.ts` (v0.3.0) into a first-class CLI
 * subcommand. v0.5 stays consistent with the existing script's behaviour:
 *
 *   - Targets: `README.md`, `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`,
 *     plus every `.md` under `docs/` recursively.
 *   - Ingests via the shared `ingestTool.handler` (same path as the MCP
 *     server) — no separate code path to maintain.
 *   - Updates in place via `update_if_exists=true` on the document title.
 *
 * Note: this is **NOT** the same as `sync-self-docs` (Part 23F). That one
 * ingests the bundled-with-npm-package docs under the dedicated
 * `_cerefox-self-docs` project; this one walks the **current working
 * directory's** repo and syncs to whatever `--project` you pick. Useful
 * for development; the `_cerefox-self-docs` flow is for end users.
 */

import type { Command } from "commander";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, extname, join, relative } from "node:path";

import {
  c,
  println,
  printTable,
  resolveAuthor,
  resolveAuthorType,
} from "../../../../../_shared/cli-core/index.ts";
import { ingestTool } from "../../../../../_shared/mcp-tools/index.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { getClient } from "../util/client.ts";

interface SyncDocsOptions {
  dryRun?: boolean;
  project?: string;
}

const ROOT_LEVEL_DOCS = ["README.md", "AGENT_GUIDE.md", "AGENT_QUICK_REFERENCE.md"];

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      out.push(...walkMarkdown(full));
    } else if (stat.isFile() && name.toLowerCase().endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

async function action(options: SyncDocsOptions): Promise<void> {
  const cwd = process.cwd();
  const project = options.project ?? "cerefox";

  // Collect targets.
  const targets: Array<{ abs: string; rel: string }> = [];
  for (const rel of ROOT_LEVEL_DOCS) {
    const abs = join(cwd, rel);
    if (existsSync(abs)) targets.push({ abs, rel });
  }
  for (const abs of walkMarkdown(join(cwd, "docs"))) {
    targets.push({ abs, rel: relative(cwd, abs) });
  }

  if (targets.length === 0) {
    println(c.dim(`(no markdown files found in ${cwd})`));
    return;
  }

  println(c.bold(`Syncing ${targets.length} markdown file(s) to project "${project}"`));
  if (options.dryRun) println(c.yellow("(dry run — no writes)"));
  println("");

  if (options.dryRun) {
    printTable(
      targets.map((t) => ({
        file: t.rel,
        title: basename(t.abs, extname(t.abs)),
      })),
    );
    return;
  }

  const client = getClient();
  const settings = loadSettings();
  const author = resolveAuthor(undefined);
  const authorType = resolveAuthorType("agent");

  const outcomes: Array<{ file: string; status: "ok" | "error"; detail: string }> = [];
  for (const t of targets) {
    const content = readFileSync(t.abs, "utf8");
    const title = basename(t.abs, extname(t.abs));
    try {
      const message = await ingestTool.handler(
        client.raw as unknown as Parameters<typeof ingestTool.handler>[0],
        {
          title,
          content,
          source: "sync-docs",
          metadata: { source_path: t.rel },
          update_if_exists: true,
          project_name: project,
          author,
          author_type: authorType,
        },
        { openaiApiKey: settings.openaiApiKey, accessPath: "cli" },
      );
      outcomes.push({ file: t.rel, status: "ok", detail: message });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({ file: t.rel, status: "error", detail: msg });
    }
  }

  const ok = outcomes.filter((o) => o.status === "ok");
  const errs = outcomes.filter((o) => o.status === "error");
  println("");
  println(c.bold(`Summary: ${ok.length} ok · ${errs.length} error${errs.length === 1 ? "" : "s"}`));
  if (errs.length > 0) {
    println("");
    printTable(errs.map((e) => ({ file: e.file, error: e.detail.slice(0, 100) })));
  }
}

export function registerSyncDocs(program: Command): void {
  program
    .command("sync-docs")
    .description("Sync repo docs (README, AGENT_*, docs/) into a Cerefox project.")
    .option("--dry-run", "Print what would be synced without writing.")
    .option("-p, --project <name>", "Target project for the sync.", "cerefox")
    .action(action);
}
