/**
 * `cerefox ingest [path]` — ingest a file or stdin-paste into the KB.
 *
 * Calls the shared `ingestTool.handler` from `_shared/mcp-tools/ingest.ts` —
 * same code the MCP server and Edge Function use. Chunking + embedding +
 * write happen inside that handler; the CLI command is a thin shell.
 *
 * Three input modes:
 *   - `cerefox ingest file.md`            — read from a file path
 *   - `cerefox ingest --paste -t Title`   — read from stdin
 *   - (`--paste` without `--title`)       — exit 1; title is required
 */

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

import {
  c,
  parseJsonObjectArg,
  println,
  resolveAuthor,
  resolveAuthorType,
  systemError,
  userError,
  warn,
} from "../../../../../_shared/cli-core/index.ts";
import { ingestTool } from "../../../../../_shared/mcp-tools/index.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { getClient } from "../util/client.ts";

interface IngestOptions {
  title?: string;
  paste?: boolean;
  projectName?: string;
  projectNames?: string;
  metadata?: string;
  source?: string;
  updateIfExists?: boolean;
  documentId?: string;
  author?: string;
  authorType?: string;
}

async function readContent(path: string | undefined, paste: boolean): Promise<{ content: string; titleFromPath: string | undefined }> {
  if (paste) {
    if (path) {
      throw userError("--paste and a positional path are mutually exclusive.");
    }
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks).toString("utf8");
    if (content.trim() === "") {
      throw userError("Empty paste — nothing to ingest.");
    }
    return { content, titleFromPath: undefined };
  }
  if (!path) {
    throw userError(
      "Provide a file path or use --paste.",
      "Example: cerefox ingest notes.md --title 'My Note'",
    );
  }
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw userError(`Cannot read ${path}: ${msg}`);
  }
  const titleFromPath = basename(path, extname(path));
  return { content, titleFromPath };
}

async function action(path: string | undefined, options: IngestOptions): Promise<void> {
  const { content, titleFromPath } = await readContent(path, Boolean(options.paste));

  const title = options.title ?? titleFromPath;
  if (!title || title.trim() === "") {
    throw userError(
      options.paste
        ? "--title is required with --paste."
        : "Cannot derive a title from the file path; pass --title explicitly.",
    );
  }

  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  if (author === "unknown") {
    warn(
      "No --author / CEREFOX_AUTHOR_NAME set — audit log will record this write as 'unknown'.",
    );
  }
  const metadata = parseJsonObjectArg(options.metadata, "--metadata") ?? {};

  let projectNames: string[] | undefined;
  if (options.projectNames) {
    projectNames = options.projectNames
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (projectNames.length === 0) projectNames = undefined;
  }

  const client = getClient();
  const settings = loadSettings();

  // Build args matching the ingest tool's JSON schema.
  const args: Record<string, unknown> = {
    title,
    content,
    source: options.source ?? "cli",
    metadata,
    update_if_exists: Boolean(options.updateIfExists),
    author,
    author_type: authorType,
  };
  if (options.documentId) args.document_id = options.documentId;
  if (options.projectName) args.project_name = options.projectName;
  if (projectNames) args.project_names = projectNames;

  let message: string;
  try {
    message = await ingestTool.handler(
      client.raw as unknown as Parameters<typeof ingestTool.handler>[0],
      args,
      {
        openaiApiKey: settings.openaiApiKey,
        accessPath: "cli",
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw systemError(`Ingest failed: ${msg}`);
  }

  // ingest tool returns a string like:
  //   Document saved: "Title" (id: <uuid>), 4 chunk(s), 12345 chars.
  println(c.green("✓ ") + message);
}

export function registerIngest(program: Command): void {
  program
    .command("ingest")
    .description("Ingest a file (or stdin paste) into the knowledge base.")
    .argument("[path]", "Path to the file to ingest. Omit when using --paste.")
    .option("--paste", "Read content from stdin instead of a file.")
    .option("-t, --title <title>", "Document title (required with --paste; defaults to filename without extension).")
    .option("-p, --project-name <name>", "Single project membership (non-destructive on update).")
    .option(
      "-P, --project-names <names>",
      "Comma-separated full project membership set (destructive replace on update).",
    )
    .option("-m, --metadata <json>", "JSON metadata object.")
    .option("--source <label>", "Origin label (default: cli).", "cli")
    .option("-u, --update-if-exists", "Update an existing doc with the same title.")
    .option("-i, --document-id <uuid>", "Update a specific document by UUID (overrides --update-if-exists).")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option(
      "--author-type <type>",
      "'user' or 'agent' (default: user).",
      "user",
    )
    .action(action);
}
