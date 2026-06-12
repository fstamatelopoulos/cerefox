/**
 * `cerefox ingest [path]` — ingest a file or stdin-paste into the KB.
 *
 * v0.7+ (iter-25 Part 25G): calls the in-process `IngestionPipeline`
 * directly. Pre-v0.7 this command routed through `ingestTool.handler`
 * in `_shared/mcp-tools/` which called the deployed cerefox-ingest
 * Edge Function — the CLI was a network client of its own remote
 * server. v0.7's in-process pipeline removes the EF round-trip,
 * making the CLI both faster and usable offline (with Supabase
 * reachable for the RPC + OpenAI reachable for embeddings).
 *
 * The MCP server's path (`_shared/mcp-tools/ingest.ts`) is unchanged:
 * MCP clients keep routing through the EF, which the remote MCP needs
 * (Deno on Supabase has no in-process pipeline alternative). Local
 * MCP server stays consistent with remote — same ingest path; future
 * iteration may switch local MCP to the in-process pipeline.
 *
 * Three input modes:
 *   - `cerefox ingest file.md`            — read from a file path
 *   - `cerefox ingest --paste -t Title`   — read from stdin
 *   - (`--paste` without `--title`)       — exit 1; title is required
 */

import type { Command } from "commander";
import { createClient } from "@supabase/supabase-js";
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
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { IngestionPipeline } from "../../ingestion/pipeline.ts";

interface IngestOptions {
  title?: string;
  paste?: boolean;
  projectName?: string;
  projectNames?: string;
  metadata?: string;
  source?: string;
  updateIfExists?: boolean;
  expectedContentHash?: string;
  lastWriteWins?: boolean;
  documentId?: string;
  author?: string;
  authorType?: string;
}

async function readContent(
  path: string | undefined,
  paste: boolean,
): Promise<{ content: string; titleFromPath: string | undefined }> {
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

async function action(
  path: string | undefined,
  options: IngestOptions,
): Promise<void> {
  const { content, titleFromPath } = await readContent(
    path,
    Boolean(options.paste),
  );

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

  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    throw userError(
      "Supabase credentials not configured — run `cerefox init` first.",
    );
  }
  if (!settings.openaiApiKey) {
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

  try {
    const result =
      path && !options.paste
        ? await pipeline.ingestFile(path, {
            title,
            source: options.source ?? "cli",
            projectName: options.projectName ?? null,
            projectNames: projectNames ?? null,
            metadata: metadata as Record<string, unknown>,
            updateExisting: Boolean(options.updateIfExists),
            documentId: options.documentId ?? null,
            author,
            authorType: authorType as "user" | "agent",
            expectedContentHash: options.expectedContentHash ?? null,
            lastWriteWins: Boolean(options.lastWriteWins),
          })
        : await pipeline.ingestText({
            text: content,
            title,
            source: options.source ?? "cli",
            projectName: options.projectName ?? null,
            projectNames: projectNames ?? null,
            metadata: metadata as Record<string, unknown>,
            updateExisting: Boolean(options.updateIfExists),
            documentId: options.documentId ?? null,
            author,
            authorType: authorType as "user" | "agent",
            expectedContentHash: options.expectedContentHash ?? null,
            lastWriteWins: Boolean(options.lastWriteWins),
          });

    // Match the legacy `ingestTool.handler` output shape — users may
    // have grep / pipe expectations against this string.
    // Match the legacy `_shared/mcp-tools/ingest.ts` output strings:
    // tooling pipes the CLI's stdout and greps for "up-to-date" /
    // "updated" / "saved". When the pipeline returns action="updated"
    // with reindexed=false, the user-visible outcome is "nothing
    // changed" — same as a hash-match skip — so we collapse those two
    // cases to the same "already up-to-date" message.
    let verb: string;
    if (result.action === "created") {
      verb = "Document saved";
    } else if (result.action === "updated" && result.reindexed) {
      verb = "Document updated";
    } else {
      // skipped, OR updated+!reindexed (metadata-only or no-op).
      verb = "Document already up-to-date";
    }

    const projects =
      result.projectIds.length > 0
        ? ` [projects: ${result.projectIds.length}]`
        : "";
    const note = result.note ? ` (${result.note})` : "";
    println(
      c.green("✓ ") +
        `${verb}: ${JSON.stringify(result.title)} (id: ${result.documentId}), ` +
        `${result.chunkCount} chunk(s), ${result.totalChars} chars.${projects}${note}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw systemError(`Ingest failed: ${msg}`);
  }
}

export function registerIngest(program: Command): void {
  program
    .command("ingest")
    .description("Ingest a file (or stdin paste) into the knowledge base.")
    .argument("[path]", "Path to the file to ingest. Omit when using --paste.")
    .option("--paste", "Read content from stdin instead of a file.")
    .option(
      "-t, --title <title>",
      "Document title (required with --paste; defaults to filename without extension).",
    )
    .option(
      "-p, --project-name <name>",
      "Single project membership (non-destructive on update).",
    )
    .option(
      "-P, --project-names <names>",
      "Comma-separated full project membership set (destructive replace on update).",
    )
    .option("-m, --metadata <json>", "JSON metadata object.")
    .option("--source <label>", "Origin label (default: cli).", "cli")
    .option("-u, --update-if-exists", "Update an existing doc with the same title.")
    .option(
      "-i, --document-id <uuid>",
      "Update a specific document by UUID (overrides --update-if-exists).",
    )
    .option(
      "--expected-content-hash <sha256>",
      "Optimistic-concurrency token: the content_hash of the version this edit is based on (shown by `document get` / `search`). Required on content updates unless --last-write-wins.",
    )
    .option(
      "--last-write-wins",
      "Skip the concurrency check and overwrite regardless of concurrent changes (recorded in the audit log).",
    )
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option(
      "--author-type <type>",
      "'user' or 'agent' (default: user).",
      "user",
    )
    .action(action);
}
