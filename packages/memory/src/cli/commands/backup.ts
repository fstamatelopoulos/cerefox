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
import { loadEnv } from "../../../../../_shared/config/index.ts";
import { fetchAllPages } from "../../../../../_shared/db-client/paginate.ts";
import { getClient } from "../util/client.ts";
import { PKG_VERSION } from "../../meta.ts";

interface BackupOptions {
  outputDir?: string;
  includeVersions?: boolean;
  label?: string;
  git?: boolean;
  trash?: boolean;
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
  // Load `.env` BEFORE reading CEREFOX_BACKUP_DIR.
  //
  // Nothing loads it at CLI startup — `loadSettings()` runs inside
  // `getClient()`, which happens further down. So this line used to read a
  // `process.env` that the config file had not been merged into yet, and
  // `CEREFOX_BACKUP_DIR` set in `.env` was silently ignored: snapshots went to
  // the built-in default no matter what the user configured. It appeared to
  // work only when the variable was exported in the shell, or when Bun's
  // auto-dotenv happened to inject a working-directory `.env`, which is why
  // the same setting sent two machines' backups to two different places.
  //
  // loadEnv() is idempotent, so calling it here is free when something else
  // already did.
  loadEnv();

  const configuredDir = options.outputDir ?? process.env.CEREFOX_BACKUP_DIR;
  const outDir = resolve(expandHome(configuredDir ?? "~/.cerefox/backups"));

  // A *relative* CEREFOX_BACKUP_DIR resolves against the working directory, so
  // the same command writes to a different place depending on where it is run
  // from — and the snapshots quietly scatter. `./backups` was the pre-v0.3.0
  // default and still sits in `.env` files created back then, which is how one
  // store ended up with backups split between `~/.cerefox/backups` and a repo
  // checkout. Harmless individually, dangerous in aggregate: you believe you
  // have backups and cannot find them. Say so rather than silently complying.
  if (
    configuredDir !== undefined &&
    !configuredDir.startsWith("/") &&
    !configuredDir.startsWith("~")
  ) {
    println(
      c.yellow("⚠ ") +
        `Backup directory "${configuredDir}" is relative — it resolves against the ` +
        "current working directory, so backups land in different places depending " +
        "on where you run this from.",
    );
    println(c.dim(`  Writing to: ${outDir}`));
    println(c.dim("  Set an absolute path (e.g. ~/.cerefox/backups) to keep them together."));
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const stamp = utcStamp();
  const filename = `cerefox-${stamp}${options.label ? "-" + options.label : ""}.json`;
  const dest = join(outDir, filename);

  const client = getClient();

  // Stamped into the payload so a restore (possibly on a different Cerefox
  // version) can tell which schema produced it.
  let schemaVersion = "unknown";
  try {
    schemaVersion = (await client.rpc<string>("cerefox_schema_version", {})) ?? "unknown";
  } catch {
    // Non-fatal: an older server without the RPC still backs up fine.
  }

  // Trashed documents are captured by default (backup format 4).
  //
  // Soft-delete is not a purge: `cerefox_delete_document` only stamps
  // `deleted_at`, and nothing ever collects it — the 48h retention sweep prunes
  // document *versions*, never the trash. So the trash is durable state that
  // survives indefinitely until someone runs an explicit purge, and a snapshot
  // that omitted it was quietly the one lossy part of "back up everything".
  //
  // Restore replays `deleted_at` verbatim, so trashed documents come back
  // trashed, never resurrected. That is what makes this safe to default on:
  // every read and search RPC filters `deleted_at IS NULL`, so restored trash
  // is as invisible as it was on the source, and `document restore` still
  // recovers it. `--no-trash` opts out for anyone who deletes at volume.
  const includeTrash = options.trash !== false;

  // The column allow-list is explicit on purpose: a `select("*")` is how the
  // membership columns went missing unnoticed in the first place (#166).
  //
  // `lifecycle_status` arrived with schema 0.10.0, but a newer CLI is routinely
  // pointed at an older server — backing up production before upgrading it is
  // the single most important time this command has to work. Naming the column
  // unconditionally made `backup create` fail outright against any 0.9.x
  // database ("column cerefox_documents.lifecycle_status does not exist"), so
  // the fallback below drops it and re-runs. Restore already tolerates its
  // absence.
  const BASE_COLUMNS =
    "id, title, content_hash, source, metadata, total_chars, chunk_count, " +
    "review_status, created_at, updated_at, deleted_at";

  const fetchDocs = (columns: string): Promise<Array<Record<string, unknown>>> =>
    fetchAllPages<Record<string, unknown>>((from, to) => {
      // Paginated: an unbounded select caps at the PostgREST row limit (1000)
      // and silently truncates the backup (#131).
      const q = client.raw.from("cerefox_documents").select(columns);
      return (includeTrash ? q : q.is("deleted_at", null))
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to);
    });

  let docs: Array<Record<string, unknown>>;
  let lifecycleCaptured = true;
  try {
    docs = await fetchDocs(`${BASE_COLUMNS}, lifecycle_status`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/lifecycle_status/.test(message)) {
      throw systemError(`Document fetch failed: ${message}`);
    }
    lifecycleCaptured = false;
    try {
      docs = await fetchDocs(BASE_COLUMNS);
    } catch (retryErr) {
      throw systemError(
        `Document fetch failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`,
      );
    }
    println(
      c.dim("  (server predates lifecycle_status — captured without it)"),
    );
  }

  const trashedCount = docs.filter((d) => d.deleted_at != null).length;


  // Projects + memberships (#166). These were never captured, so every
  // restore silently landed documents with no project assignments — and the
  // restore command's help text claimed the opposite. Both tables are small
  // (tens of projects, one row per membership) but paginated anyway: the
  // membership count tracks the document count, which is unbounded.
  let projects: Array<Record<string, unknown>> = [];
  let memberships: Array<Record<string, unknown>> = [];
  try {
    projects = await fetchAllPages<Record<string, unknown>>((from, to) =>
      client.raw
        .from("cerefox_projects")
        .select("id, name, description, created_at, updated_at")
        .order("id", { ascending: true })
        .range(from, to),
    );
    memberships = await fetchAllPages<Record<string, unknown>>((from, to) =>
      client.raw
        .from("cerefox_document_projects")
        .select("document_id, project_id")
        .order("document_id", { ascending: true })
        .order("project_id", { ascending: true })
        .range(from, to),
    );
  } catch (err) {
    throw systemError(
      `Project/membership fetch failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Document relations (iteration 29). Absent on pre-0.10.0 servers, so a
  // missing table is not an error — it just means this store has no graph.
  let relations: Array<Record<string, unknown>> = [];
  try {
    relations = await fetchAllPages<Record<string, unknown>>((from, to) =>
      client.raw
        .from("cerefox_document_relations")
        .select("source_id, target_id, rel_type, metadata, author, author_type, created_at")
        .order("source_id", { ascending: true })
        .order("target_id", { ascending: true })
        .order("rel_type", { ascending: true })
        .range(from, to),
    );
  } catch {
    // Older server without the relations table — nothing to capture.
  }

  // Drop memberships whose document is not in this snapshot. With trash
  // captured (format 4) this is usually a no-op, but it still matters under
  // `--no-trash`, and it guards the general case of a junction row outliving
  // its document. Restore already ignores such rows, so
  // this is about the file being internally consistent: every membership in a
  // snapshot should point at a document the snapshot contains.
  {
    const captured = new Set(docs.map((d) => d.id as string));
    const before = memberships.length;
    memberships = memberships.filter((m) => captured.has(m.document_id as string));
    const dropped = before - memberships.length;
    if (dropped > 0) {
      println(
        c.dim(`  (skipped ${dropped} membership(s) belonging to trashed documents)`),
      );
    }
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

  // backup_format 2 (#166) adds projects + memberships. Restore accepts
  // format 1 (documents + chunks only) unchanged, so older snapshots keep
  // working — they simply have no memberships to recreate.
  const payload = {
    created_at: new Date().toISOString(),
    cerefox_version: PKG_VERSION,
    // 3 = adds relations + lifecycle_status (iteration 29).
    // 4 = trashed documents are captured (with deleted_at preserved).
    backup_format: 4,
    schema_version: schemaVersion,
    document_count: docs.length,
    trashed_count: trashedCount,
    includes_trash: includeTrash,
    // False when taken against a pre-0.10.0 server, so a restore can tell an
    // absent lifecycle_status from one that was genuinely never set.
    includes_lifecycle_status: lifecycleCaptured,
    chunk_count: chunkTotal,
    project_count: projects.length,
    membership_count: memberships.length,
    relation_count: relations.length,
    projects,
    memberships,
    relations,
    documents: enriched,
  };

  writeFileSync(dest, JSON.stringify(payload, null, 2), "utf8");

  println("");
  println(c.green("✓ ") + `Backup written: ${dest}`);
  println(
    c.dim(
      `  documents: ${docs.length} · chunks: ${chunkTotal} · ` +
        `projects: ${projects.length} · memberships: ${memberships.length}` +
          (relations.length > 0 ? ` · relations: ${relations.length}` : ""),
    ),
  );
  // Counted on its own line: the trash is included in document_count, and a
  // silent inclusion is exactly the kind of surprise this feature exists to
  // remove. Say so either way.
  if (!includeTrash) {
    println(c.dim("  trashed documents: excluded (--no-trash)"));
  } else if (trashedCount > 0) {
    println(
      c.dim(
        `  of which trashed: ${trashedCount} (restored as trash, not resurrected)`,
      ),
    );
  }

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
    .option(
      "--no-trash",
      "Exclude soft-deleted documents. Default: they are captured and restored as trash.",
    )
    .action(action);
}
