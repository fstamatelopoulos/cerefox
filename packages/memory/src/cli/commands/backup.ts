/**
 * `cerefox backup` — write JSON snapshot of the knowledge base.
 *
 * Faithful port of `src/cerefox/backup/fs_backup.py:FileSystemBackup.create()`.
 * Produces a single `cerefox-<utc-timestamp>[-label].json` file in
 * `--output-dir` (defaults to `~/.cerefox/backups`) containing all
 * non-deleted documents + their chunks (with embeddings).
 *
 * v0.5 limitations: no `--git` commit support (port deferred to a
 * follow-up; the Python CLI's `--git` flag is rare).
 */

import type { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  c,
  println,
  systemError,
} from "../../../../../_shared/cli-core/index.ts";
import { fetchAllPages } from "../../../../../_shared/db-client/paginate.ts";
import { getClient } from "../util/client.ts";

interface BackupOptions {
  outputDir?: string;
  includeVersions?: boolean;
  label?: string;
  git?: boolean;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function utcStamp(): string {
  const d = new Date();
  const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

async function action(options: BackupOptions): Promise<void> {
  const outDir = resolve(
    expandHome(options.outputDir ?? process.env.CEREFOX_BACKUP_DIR ?? "~/.cerefox/backups"),
  );
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const stamp = utcStamp();
  const filename = `cerefox-${stamp}${options.label ? "-" + options.label : ""}.json`;
  const dest = join(outDir, filename);

  const client = getClient();

  // Pull all non-deleted documents. Paginated: an unbounded select caps at
  // the PostgREST row limit (1000) and silently truncates the backup (#131).
  let docs: Array<Record<string, unknown>>;
  try {
    docs = await fetchAllPages<Record<string, unknown>>((from, to) =>
      client.raw
        .from("cerefox_documents")
        .select(
          "id, title, content_hash, source, metadata, total_chars, chunk_count, " +
            "review_status, created_at, updated_at, deleted_at",
        )
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
  } catch (err) {
    throw systemError(
      `Document fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // For each doc, pull its chunks.
  let chunkTotal = 0;
  const enriched: Array<Record<string, unknown>> = [];
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const docId = doc.id as string;
    // Paginated for the same reason: a single document with >1000 chunks
    // would otherwise back up a truncated chunk list.
    let chunks: Array<Record<string, unknown>>;
    try {
      chunks = await fetchAllPages<Record<string, unknown>>((from, to) =>
        client.raw
          .from("cerefox_chunks")
          .select("*")
          .eq("document_id", docId)
          .is("version_id", null)
          .order("chunk_index", { ascending: true })
          .range(from, to),
      );
    } catch (err) {
      throw systemError(
        `Chunk fetch failed for ${docId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    chunkTotal += chunks.length;
    enriched.push({ ...doc, chunks });
    if (process.stdout.isTTY) {
      process.stderr.write(
        `\r  Dumping documents: ${i + 1}/${docs.length} (${chunkTotal} chunks so far)…`,
      );
    }
  }
  if (process.stdout.isTTY) process.stderr.write("\n");

  const payload = {
    created_at: new Date().toISOString(),
    cerefox_version: process.env.npm_package_version ?? "unknown",
    document_count: docs.length,
    chunk_count: chunkTotal,
    documents: enriched,
  };

  writeFileSync(dest, JSON.stringify(payload, null, 2), "utf8");

  println("");
  println(c.green("✓ ") + `Backup written: ${dest}`);
  println(c.dim(`  documents: ${docs.length} · chunks: ${chunkTotal}`));

  if (options.git) {
    println(c.yellow("⚠ ") + "--git commit is not implemented; the snapshot was written without a git checkpoint.");
    println(c.dim("  Commit the backup directory yourself if you want it version-controlled."));
  }
}

export function registerBackup(program: Command): void {
  program
    .command("backup")
    .description("Write a JSON snapshot of the knowledge base.")
    .option(
      "-o, --output-dir <dir>",
      "Snapshot output directory (default: CEREFOX_BACKUP_DIR or ~/.cerefox/backups).",
    )
    .option("-l, --label <label>", "Optional suffix added to the filename.")
    .option("--include-versions", "Include archived versions in the snapshot. (v0.5: ignored — current chunks only.)")
    .option("--git", "Commit the snapshot to the output dir as a git checkpoint. (v0.5: ignored.)")
    .action(action);
}
