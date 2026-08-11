/**
 * `cerefox ingest-dir <dir>` — batch ingest a directory.
 *
 * v0.7+: uses the in-process `IngestionPipeline` directly. Same swap
 * as `cerefox ingest` (Part 25G) — removes the EF round-trip per
 * file.
 *
 * Recursively walks the directory; for each file matching the
 * `--extensions` filter, reads + ingests via the pipeline. Shows a
 * `cli-progress` bar when stdout is a TTY; suppresses progress on
 * non-TTY streams (CI / pipes).
 *
 * Fails-soft on per-file errors: prints a summary including any files
 * that didn't ingest, with exit code 0 (partial success) or 2 (every
 * file failed).
 */

import { resolveEmbedderKind } from "../../../../../_shared/embeddings/index.ts";
import type { Command } from "commander";
import { createClient } from "@supabase/supabase-js";
import cliProgress from "cli-progress";
import { readdirSync, statSync } from "node:fs";
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
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { IngestionPipeline } from "../../ingestion/pipeline.ts";

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
  // undefined = "not provided": re-ingesting existing files keeps their
  // current metadata (v0.11.1). Pass --metadata '{}' to clear on update.
  const metadata = parseJsonObjectArg(options.metadata, "--metadata");

  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    throw userError(
      "Supabase credentials not configured — run `cerefox init` first.",
    );
  }
  if (!settings.openaiApiKey && resolveEmbedderKind() !== "local") {
    // The local ONNX embedder (CEREFOX_EMBEDDER=local, iter-31) needs no API key.
    throw userError(
      "OPENAI_API_KEY not set — required for embeddings during ingest.",
    );
  }
  const supabase = createClient(settings.supabaseUrl, settings.supabaseKey, {
    auth: { persistSession: false },
  });
  const pipeline = new IngestionPipeline({
    supabase,
    openAiApiKey: settings.openaiApiKey,
  });

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
    try {
      const result = await pipeline.ingestFile(file, {
        title: basename(file, extname(file)),
        // The same defect #193 fixed in `document ingest`, and worse here: this
        // is a bulk re-sync, so a default would relabel every matched document
        // in one run — the corpus-scale shape #191 reported (1,317 documents).
        source: options.source ?? null,
        sourceOnCreate: "cli",
        projectName: options.projectName ?? null,
        metadata: metadata ?? null,
        updateExisting: Boolean(options.updateIfExists),
        author,
        authorType: authorType as "user" | "agent",
        // Filesystem-sync semantics: the directory IS the source of truth, so
        // the optimistic-concurrency check is bypassed by design (iter-32).
        lastWriteWins: true,
      });
      outcomes.push({
        file,
        status: "ok",
        detail: `${result.action}: ${result.chunkCount} chunks`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({ file, status: "error", detail: msg });
    }
    bar?.increment();
  }
  bar?.stop();

  const ok = outcomes.filter((o) => o.status === "ok");
  const errs = outcomes.filter((o) => o.status === "error");
  println("");
  println(
    c.bold(`Summary: ${ok.length} ok · ${errs.length} error${errs.length === 1 ? "" : "s"}`),
  );
  if (errs.length > 0) {
    println("");
    printTable(
      errs.map((e) => ({ file: e.file, error: e.detail.slice(0, 100) })),
    );
  }

  if (errs.length === outcomes.length) {
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
    .option(
      "--source <label>",
      "Origin label. Omit it and each matched document keeps the source it already has (#193); newly created ones are recorded as \"cli\".",
    )
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
