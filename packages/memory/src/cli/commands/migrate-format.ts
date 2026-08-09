/**
 * `cerefox server migrate-format` — convert legacy-format documents to the
 * current chunk-reconstruction format.
 *
 * Why this exists (#164): `cerefox doctor` reports how many documents still
 * use `content_format = 1`, and both the guide and doctor used to point at
 * `server reindex` to clear it. Reindex cannot: it patches `embedding_primary`
 * and `embedder_primary` on existing chunk rows and never re-chunks, so the
 * stored format never advances. Verified on a 3,203-chunk store: reindex
 * touched every chunk and moved exactly zero of them.
 *
 * The only write path that stamps the current format is real ingestion, so
 * that is what this command drives: read each legacy document's reconstructed
 * content, then re-ingest it through the normal pipeline (re-chunk, re-embed,
 * stamp format 2) as an update in place.
 *
 * Cost and safety:
 *   - This RE-EMBEDS every converted document, so it costs real embedding
 *     spend. It is opt-in, never automatic, and `--dry-run` reports the work
 *     without doing it.
 *   - Each document is converted under optimistic concurrency using the hash
 *     read moments earlier. If something edits a document mid-run, that
 *     document is skipped and reported rather than overwritten — a conversion
 *     must never clobber a concurrent human edit.
 *   - Legacy format is not broken. Documents that stay on format 1 reconstruct
 *     exactly as they always have; converting is housekeeping, not a repair.
 */

import type { Command } from "commander";

import {
  c,
  parsePositiveInt,
  println,
  printTable,
  resolveAuthor,
  resolveAuthorType,
  systemError,
} from "../../../../../_shared/cli-core/index.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { fetchAllPages } from "../../../../../_shared/db-client/paginate.ts";
import { IngestionPipeline } from "../../ingestion/pipeline.ts";
import { warnLargeBulkWrite } from "../util/bulk-write-warning.ts";
import { getClient } from "../util/client.ts";

/** The format written by the current chunker (see docs/guides/content-format.md). */
const CURRENT_FORMAT = 2;

interface MigrateOptions {
  dryRun?: boolean;
  limit?: string;
  documentId?: string;
  author?: string;
}

async function action(options: MigrateOptions): Promise<void> {
  const settings = loadSettings();
  const client = getClient();
  const supabase = client.raw;

  // Documents holding at least one current chunk below the target format.
  // Paginated: the chunk table is the largest in the store (#131).
  let legacyChunkRows: Array<{ document_id: string }>;
  try {
    legacyChunkRows = await fetchAllPages<{ document_id: string }>((from, to) => {
      let q = supabase
        .from("cerefox_chunks")
        .select("document_id")
        .is("version_id", null)
        .lt("content_format", CURRENT_FORMAT);
      if (options.documentId) q = q.eq("document_id", options.documentId);
      return q.order("document_id", { ascending: true }).range(from, to);
    }, 1000);
  } catch (err) {
    throw systemError(
      `Could not list legacy chunks: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Exclude trashed documents.
  //
  // Chunks outlive a soft delete, so the query above happily returns documents
  // sitting in the trash — which is both a waste of embedding spend on content
  // the user deleted, and a reporting mismatch: `doctor` counts live documents
  // only, so it said "207 of 319" while this command said 214. Two numbers for
  // the same question is how people stop trusting either. Anything restored
  // later still converts on its next edit.
  let liveIds = new Set<string>();
  try {
    const liveRows = await fetchAllPages<{ id: string }>((from, to) =>
      supabase
        .from("cerefox_documents")
        .select("id")
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    );
    liveIds = new Set(liveRows.map((r) => r.id));
  } catch (err) {
    throw systemError(
      `Could not list documents: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const allLegacy = [...new Set(legacyChunkRows.map((r) => r.document_id))];
  const docIds = allLegacy.filter((id) => liveIds.has(id));
  const trashedSkipped = allLegacy.length - docIds.length;
  const limit = options.limit ? parsePositiveInt(options.limit, "--limit", docIds.length) : docIds.length;
  const targets = docIds.slice(0, limit);

  if (targets.length === 0) {
    println(c.green("✓ Nothing to migrate — every document already uses the current format."));
    return;
  }

  println(
    c.bold(
      `${docIds.length} document(s) on the legacy format` +
        (targets.length < docIds.length ? `; converting ${targets.length} (--limit)` : ""),
    ),
  );
  if (trashedSkipped > 0) {
    println(
      c.dim(`  (${trashedSkipped} trashed document(s) on the legacy format ignored)`),
    );
  }
  // Heaviest write path in the CLI: per document this re-chunks, archives the
  // previous chunks as a version snapshot, and inserts new rows.
  //
  // Threshold raised from 200 back up once the Disk IO incident that motivated
  // the lower number was traced to a retry loop rather than to bulk rewrites
  // (see bulk-write-warning.ts). A few hundred documents is an ordinary
  // maintenance run on a real knowledge base; warning there is noise. A
  // thousand is unambiguously a large job.
  warnLargeBulkWrite({
    count: targets.length,
    threshold: 1000,
    unit: "document",
    batchHint: "run it in batches with --limit 100",
  });

  if (options.dryRun) {
    println(c.yellow("⚠  --dry-run: nothing was written."));
    println(c.dim("   Each document would be re-chunked and RE-EMBEDDED (embedding spend)."));
    return;
  }
  println(c.dim("Each document is re-chunked and re-embedded — this costs embedding spend."));
  println("");

  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(undefined);
  const pipeline = new IngestionPipeline({
    supabase,
    openAiApiKey: settings.openaiApiKey,
  });

  let converted = 0;
  let skipped = 0;
  // Documents whose content is byte-identical to another document: the
  // ingestion pipeline refuses those by design (content-hash dedup), so they
  // cannot be converted by re-ingesting. That is a data-hygiene finding, not a
  // migration failure — surface them instead of failing the run.
  const duplicates: Array<{ document: string; reason: string }> = [];
  const failures: Array<{ document: string; reason: string }> = [];

  for (let i = 0; i < targets.length; i++) {
    const id = targets[i];
    if (process.stdout.isTTY) {
      process.stderr.write(`\r  Converting ${i + 1}/${targets.length}…`);
    }

    // Reconstructed content + the concurrency token, from the same RPC every
    // other reader uses — so we convert exactly what a reader would see.
    // Column names are the RPC's own (doc_title / full_content), not the
    // table's — an easy mismatch to assume wrong, so it is spelled out here.
    let doc:
      | { doc_title: string; doc_source: string; full_content: string; content_hash: string }
      | null = null;
    try {
      const rows = await client.rpc<
        Array<{ doc_title: string; doc_source: string; full_content: string; content_hash: string }>
      >("cerefox_get_document", { p_document_id: id, p_version_id: null });
      doc = rows?.[0] ?? null;
    } catch (err) {
      failures.push({ document: id, reason: `read: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }
    if (!doc) {
      failures.push({ document: id, reason: "read: document not found" });
      continue;
    }

    try {
      const result = await pipeline.ingestText({
        text: doc.full_content,
        title: doc.doc_title,
        documentId: id,
        // A format conversion is not a change of origin, so the document keeps
        // the source it came in with (#191 — this used to hardcode
        // "migrate-format" and overwrite provenance corpus-wide). The version
        // row still records that this run performed the write.
        source: doc.doc_source,
        sourceLabel: "migrate-format",
        author,
        authorType,
        // Compare-and-swap against what we just read: a concurrent edit makes
        // this document skip rather than lose that edit.
        expectedContentHash: doc.content_hash,
        // Essential, not an optimisation. This command re-ingests byte-
        // identical content by design, and the pipeline's normal response to
        // an unchanged hash is a metadata-only update: no re-chunk, so no
        // format advance. Without this the command reported "Converted N"
        // while every document stayed on the legacy format — the exact #164
        // defect it exists to fix, reproduced one layer up.
        forceRechunk: true,
      });
      // Trust the outcome, not the absence of an exception. `reindexed` is
      // the pipeline's own statement that chunks were rewritten; anything else
      // means the document did NOT convert, and reporting it as converted is
      // how this class of silent no-op survived a release.
      if (result.reindexed) {
        converted++;
      } else {
        failures.push({
          document: `${doc.doc_title} (${id})`,
          reason: `pipeline reported no re-chunk (action=${result.action}); format not advanced`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/conflict/i.test(message)) {
        skipped++;
      } else if (/identical content already exists/i.test(message)) {
        duplicates.push({ document: `${doc.doc_title} (${id})`, reason: message });
      } else {
        failures.push({ document: `${doc.doc_title} (${id})`, reason: message });
      }
    }
  }
  if (process.stdout.isTTY) process.stderr.write("\n");

  println("");
  println(
    c.bold(
      `Converted ${converted} · skipped ${skipped} (changed mid-run) · failed ${failures.length}`,
    ),
  );
  if (targets.length < docIds.length) {
    println(c.dim(`  ${docIds.length - targets.length} document(s) still pending — re-run to continue.`));
  }
  if (duplicates.length > 0) {
    println("");
    println(
      c.yellow(
        `⚠ ${duplicates.length} document(s) could not be converted because their content is ` +
          "byte-identical to another document.",
      ),
    );
    println(
      c.dim(
        "  Re-ingesting them would collide with the content-hash dedup check. They keep working " +
          "on the legacy format; de-duplicate them if you want them converted.",
      ),
    );
    printTable(duplicates.map((d) => ({ document: d.document })));
  }
  if (failures.length > 0) {
    println("");
    printTable(failures);
    throw systemError(`${failures.length} document(s) failed to convert.`);
  }
}

export function registerMigrateFormat(program: Command): void {
  program
    .command("migrate-format")
    .description(
      "Convert legacy-format documents to the current chunk format (re-chunks + re-embeds).",
    )
    .option("--dry-run", "Report how many documents would be converted; write nothing.")
    .option("-l, --limit <n>", "Convert at most N documents (re-run to continue).")
    .option("--document-id <uuid>", "Convert a single document.")
    .option("--author <name>", "Recorded in the audit log for each conversion.")
    .action(action);
}
