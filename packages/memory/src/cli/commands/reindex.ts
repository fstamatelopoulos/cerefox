/**
 * `cerefox reindex` — re-embed existing document chunks.
 *
 * v0.5 shipped a deferred stub. v0.7 (iter-25 Part 25G) wires the
 * in-process re-embedding path.
 *
 * Use cases:
 *   - After an embedding-model upgrade: re-embed all chunks with the
 *     new model so semantic search uses the upgraded vectors.
 *   - To rebuild title-boosted embeddings after a title change that
 *     somehow didn't trigger the pipeline's automatic re-embed.
 *   - To recover after a partial ingestion where embeddings ended up
 *     null (rare; usually surfaces as a constraint violation, but the
 *     reindex command is the recovery path either way).
 *
 * Default: only re-embeds chunks whose `embedder_primary` differs from
 * the current model. `--all` reindexes every chunk regardless.
 */

import type { Command } from "commander";
import { createClient } from "@supabase/supabase-js";

import {
  c,
  println,
  systemError,
  userError,
  warn,
} from "../../../../../_shared/cli-core/index.ts";
import { fetchAllPages } from "../../../../../_shared/db-client/paginate.ts";
import { activeEmbedderName, embedBatch, resolveEmbedderKind } from "../../../../../_shared/embeddings/index.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { warnLargeBulkWrite } from "../util/bulk-write-warning.ts";

interface ReindexOptions {
  all?: boolean;
  batch?: string;
  dryRun?: boolean;
  documentId?: string;
}

interface ChunkRow {
  id: string;
  document_id: string;
  content: string;
  embedder_primary: string | null;
  cerefox_documents: { title: string | null } | null;
}

// The reindex TARGET is whatever embedder is active (iter-31): reindex exists
// precisely to migrate chunks TO the configured embedder, so both the staleness
// filter and the recorded embedder_primary must follow it — a hardcoded OpenAI
// name made `server reindex` a no-op after switching to the local embedder
// (chunks looked "already correct") and mis-stamped provenance under --all.

async function action(options: ReindexOptions): Promise<void> {
  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    throw userError("Supabase credentials not configured — run `cerefox init` first.");
  }
  if (!settings.openaiApiKey && resolveEmbedderKind() !== "local") {
    // The local ONNX embedder (CEREFOX_EMBEDDER=local, iter-31) needs no API key.
    throw userError("OPENAI_API_KEY not set — required for embeddings.");
  }
  const supabase = createClient(settings.supabaseUrl, settings.supabaseKey, {
    auth: { persistSession: false },
  });

  const batchSize = Number.parseInt(options.batch ?? "32", 10);
  if (!Number.isFinite(batchSize) || batchSize < 1) {
    throw userError(`Invalid --batch: ${options.batch}`);
  }
  const reindexAll = Boolean(options.all);
  const dryRun = Boolean(options.dryRun);

  const targetModel = activeEmbedderName();

  // Paginated: an unbounded select caps at the PostgREST row limit (1000),
  // so past that size reindex would process a prefix of the chunks and
  // report the capped count as the whole job (#131). The full list is
  // fetched up front (snapshot), then written batch-wise below — so the
  // stale-only filter can't interact with page boundaries mid-walk.
  let chunks: ChunkRow[];
  try {
    chunks = await fetchAllPages<ChunkRow>((from, to) => {
      let query = supabase
        .from("cerefox_chunks")
        .select("id, document_id, content, embedder_primary, cerefox_documents(title)")
        .is("version_id", null);
      if (options.documentId) {
        query = query.eq("document_id", options.documentId);
      }
      if (!reindexAll) {
        query = query.neq("embedder_primary", targetModel);
      }
      return query.order("id", { ascending: true }).range(from, to);
      // Page size 1000 = the PostgREST cap itself: listing rows are light
      // (no embedding vectors), so larger pages just mean fewer round-trips.
    }, 1000);
  } catch (err) {
    throw systemError(
      `Failed to list chunks: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (chunks.length === 0) {
    println(c.dim("(nothing to reindex)"));
    return;
  }

  println(
    c.bold(
      `Reindexing ${chunks.length} chunk(s) ${reindexAll ? "(--all)" : "(stale only)"}${
        dryRun ? " — DRY RUN" : ""
      }`,
    ),
  );

  warnLargeBulkWrite({
    count: chunks.length,
    threshold: 1000,
    unit: "chunk",
    batchHint: "reindex in stages with --document-id",
  });

  if (dryRun) {
    const byDoc = new Map<string, number>();
    for (const ch of chunks) byDoc.set(ch.document_id, (byDoc.get(ch.document_id) ?? 0) + 1);
    println(c.dim(`  across ${byDoc.size} document(s)`));
    return;
  }

  let done = 0;
  let errors = 0;
  for (let start = 0; start < chunks.length; start += batchSize) {
    const slice = chunks.slice(start, start + batchSize);
    // Title-boosted embedding input — must match the pipeline's
    // contextual-enrichment format.
    const texts = slice.map((c) => {
      const title = c.cerefox_documents?.title ?? "";
      return `# ${title}\n${c.content}`;
    });
    let embeddings: number[][];
    try {
      embeddings = await embedBatch(texts, settings.openaiApiKey ?? "");
    } catch (err) {
      errors += slice.length;
      const msg = err instanceof Error ? err.message : String(err);
      warn(`Batch ${start / batchSize + 1} failed: ${msg}`);
      continue;
    }
    for (let i = 0; i < slice.length; i++) {
      const { error: updErr } = await supabase
        .from("cerefox_chunks")
        .update({
          embedding_primary: embeddings[i],
          embedder_primary: targetModel,
        })
        .eq("id", slice[i].id);
      if (updErr) {
        errors += 1;
        warn(`Chunk ${slice[i].id}: ${updErr.message}`);
      } else {
        done += 1;
      }
    }
    println(c.dim(`  ${done}/${chunks.length}…`));
  }

  println("");
  println(
    c.bold(`Reindexed ${done} chunk(s)${errors > 0 ? c.yellow(` · ${errors} errors`) : ""}.`),
  );
  if (errors > 0 && done === 0) {
    throw systemError("Every reindex attempt failed.");
  }
}

export function registerReindex(program: Command): void {
  program
    .command("reindex")
    .description("Re-embed existing document chunks (v0.7+).")
    .option("--all", "Reindex every chunk regardless of embedder.")
    .option(
      "--batch <n>",
      "Chunks per OpenAI batch call. Capped at 96 internally.",
      "32",
    )
    .option("--dry-run", "Show counts without re-embedding.")
    .option(
      "-i, --document-id <uuid>",
      "Limit reindex to a single document.",
    )
    .action(action);
}
