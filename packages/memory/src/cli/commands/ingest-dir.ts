/**
 * `cerefox ingest-dir <dir>` — batch ingest a directory.
 *
 * Recursively walks the directory; for each file matching the
 * `--extensions` filter, reads + ingests via the shared `ingestTool`
 * handler. Shows a `cli-progress` bar (N / M files + current path) when
 * stdout is a TTY; suppresses progress on non-TTY streams (CI / pipes).
 *
 * Fails-soft on per-file errors: prints a summary at the end including
 * any files that didn't ingest, with exit code 0 (partial success) or
 * 2 (every file failed).
 */

import type { Command } from "commander";
import cliProgress from "cli-progress";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

import {
  c,
  parseJsonObjectArg,
  println,
  printTable,
  resolveAuthor,
  resolveAuthorType,
  systemError,
  userError,
  warn,
} from "../../../../../_shared/cli-core/index.ts";
import { ingestTool } from "../../../../../_shared/mcp-tools/index.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { getClient } from "../util/client.ts";

interface IngestDirOptions {
  projectName?: string;
  metadata?: string;
  source?: string;
  updateIfExists?: boolean;
  author?: string;
  authorType?: string;
  extensions?: string;
}

function walk(dir: string, extensions: Set<string>): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err) {
    throw userError(
      `Cannot read directory ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const files: string[] = [];
  for (const name of entries) {
    const full = join(dir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      files.push(...walk(full, extensions));
    } else if (stat.isFile()) {
      const ext = extname(name).toLowerCase();
      if (extensions.has(ext)) files.push(full);
    }
  }
  return files;
}

async function action(dir: string, options: IngestDirOptions): Promise<void> {
  const extensions = new Set(
    (options.extensions ?? ".md,.txt")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .map((e) => (e.startsWith(".") ? e : "." + e))
      .filter((e) => e.length > 0),
  );

  const files = walk(dir, extensions);

  if (files.length === 0) {
    println(c.dim(`(no files matching ${[...extensions].join(", ")} in ${dir})`));
    return;
  }

  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  if (author === "unknown") {
    warn(
      "No --author / CEREFOX_AUTHOR_NAME set — audit log will record these writes as 'unknown'.",
    );
  }
  const metadata = parseJsonObjectArg(options.metadata, "--metadata") ?? {};

  const client = getClient();
  const settings = loadSettings();

  const showProgress = process.stdout.isTTY === true;
  const bar = showProgress
    ? new cliProgress.SingleBar(
        {
          format: "  {bar} {value}/{total} {file}",
          hideCursor: true,
          clearOnComplete: false,
          stopOnComplete: false,
        },
        cliProgress.Presets.shades_classic,
      )
    : null;
  bar?.start(files.length, 0, { file: "" });

  type Outcome = { file: string; status: "ok" | "error"; detail: string };
  const outcomes: Outcome[] = [];

  for (const file of files) {
    bar?.update({ file: basename(file) });
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch (err) {
      outcomes.push({ file, status: "error", detail: `read failed: ${err instanceof Error ? err.message : String(err)}` });
      bar?.increment();
      continue;
    }
    if (content.trim() === "") {
      outcomes.push({ file, status: "error", detail: "empty file (skipped)" });
      bar?.increment();
      continue;
    }
    const title = basename(file, extname(file));
    const args: Record<string, unknown> = {
      title,
      content,
      source: options.source ?? "cli",
      metadata,
      update_if_exists: Boolean(options.updateIfExists),
      author,
      author_type: authorType,
    };
    if (options.projectName) args.project_name = options.projectName;

    try {
      const message = await ingestTool.handler(
        client.raw as unknown as Parameters<typeof ingestTool.handler>[0],
        args,
        { openaiApiKey: settings.openaiApiKey, accessPath: "cli" },
      );
      outcomes.push({ file, status: "ok", detail: message });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({ file, status: "error", detail: msg });
    }
    bar?.increment();
  }
  bar?.stop();

  // Summary.
  const ok = outcomes.filter((o) => o.status === "ok");
  const errs = outcomes.filter((o) => o.status === "error");
  println("");
  println(c.bold(`Summary: ${ok.length} ok · ${errs.length} error${errs.length === 1 ? "" : "s"}`));
  if (errs.length > 0) {
    println("");
    printTable(
      errs.map((e) => ({
        file: e.file,
        error: e.detail.slice(0, 100),
      })),
    );
  }

  if (errs.length === outcomes.length) {
    // Every file failed.
    throw systemError(`All ${errs.length} file(s) failed to ingest.`);
  }
}

export function registerIngestDir(program: Command): void {
  program
    .command("ingest-dir")
    .description("Recursively ingest a directory of markdown / text files.")
    .argument("<dir>", "Root directory to walk.")
    .option("-p, --project-name <name>", "Project membership for all ingested docs.")
    .option("-m, --metadata <json>", "JSON metadata applied to every doc.")
    .option("--source <label>", "Origin label (default: cli).", "cli")
    .option("-u, --update-if-exists", "Update an existing doc with the same title.")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .option(
      "-e, --extensions <list>",
      "Comma-separated file extensions to ingest.",
      ".md,.txt",
    )
    .action(action);
}
