/**
 * Search-calibration floors (iteration 48, v1.17.0).
 *
 * Runs the calibration vocabulary (`_shared/search-benchmark/vocabulary/`)
 * through the LIVE cerefox_search_docs and asserts the per-category floors in
 * `floors.json` for the store's embedder. A scoring change that quietly costs one
 * category (paraphrases, short names, identifiers…) fails here even when the
 * overall average holds. Design: docs/specs/search-calibration.md.
 *
 * The vocabulary lives in its own project on the target and is left there:
 * re-runs write only documents whose content changed, so they add nothing to the
 * audit log. Write-gated like every live suite (labeled targets only), and
 * skips when the store's embedder has no floors, when the target runs another
 * schema, or when the store overrides a retrieval setting (the floors describe
 * the built-in defaults).
 *
 * Floors are measurements, not wishes: regenerate them with
 * `bun scripts/search_benchmark.ts … --write-floors` after a deliberate change,
 * and say in the PR why they moved.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

import { loadSettings } from "../../../_shared/config/index.ts";
import { embedBatch, getEmbedding, resolveEmbedderKind } from "../../../_shared/embeddings/index.ts";
import {
  BENCH_PROJECT,
  ensureCorpus,
  evaluate,
  floorBreaches,
  type Floors,
  supabaseStore,
  type VocabularyDoc,
  type VocabularyQuery,
} from "../../../_shared/search-benchmark/live.ts";
import { IngestionPipeline } from "../src/ingestion/pipeline.ts";
import { probeSupabase } from "./_live-probe.ts";
import { liveTest } from "./_live-test.ts";
import { mayWriteToLiveTarget } from "./_live-target-guard.ts";

const VOCAB = join(import.meta.dir, "..", "..", "..", "_shared", "search-benchmark", "vocabulary");
const corpus = JSON.parse(readFileSync(join(VOCAB, "corpus.json"), "utf8")) as VocabularyDoc[];
const queries = JSON.parse(readFileSync(join(VOCAB, "queries.json"), "utf8")) as VocabularyQuery[];

const FLOORS = JSON.parse(readFileSync(join(VOCAB, "floors.json"), "utf8")) as Record<string, Floors>;

const LIVE_OK = probeSupabase() && mayWriteToLiveTarget();

/** Ingest ~150 documents on first run and embed every query: well past the 60 s default. */
const BUDGET_MS = 600_000;

const setup = await (async () => {
  if (!LIVE_OK) return { skip: "no labeled live target" } as const;
  const settings = loadSettings();
  const supabase = createClient(settings.supabaseUrl, settings.supabaseKey, { auth: { persistSession: false } });
  const { data: ver } = await supabase.rpc("cerefox_schema_version");
  const { data: chunk } = await supabase.from("cerefox_chunks").select("embedder_primary").is("version_id", null).limit(1).maybeSingle();
  const embedder = (chunk?.embedder_primary as string | undefined) ?? (resolveEmbedderKind() === "local" ? "nomic-embed-text-v1.5" : "text-embedding-3-small");
  const floors = FLOORS[embedder];
  if (!floors) return { skip: `no floors recorded for embedder ${embedder}` } as const;
  if (String(ver) !== floors.schema) return { skip: `floors are for schema ${floors.schema}; target runs ${String(ver)}` } as const;
  // Floors describe the built-in defaults. A store that tunes retrieval itself
  // would pass or fail for reasons unrelated to the formula.
  const { data: tuned } = await supabase.from("cerefox_config").select("key").in("key", ["min_search_score", "min_term_coverage", "search_alpha"]);
  if ((tuned ?? []).length > 0) {
    return { skip: `store overrides ${(tuned ?? []).map((r) => r.key).join(", ")}; floors describe the defaults` } as const;
  }
  return { settings, supabase, floors, embedder } as const;
})();

describe("search calibration floors (live)", () => {
  if ("skip" in setup) {
    test.skip(`skipped: ${setup.skip}`, () => {});
    return;
  }
  const { settings, supabase, floors, embedder } = setup;

  liveTest(
    `every category holds its floor (${embedder})`,
    async () => {
      const pipeline = new IngestionPipeline({ supabase, openAiApiKey: settings.openaiApiKey });
      const store = supabaseStore(supabase);
      const { projectId, keyById } = await ensureCorpus(store, corpus, async (d) => {
        await pipeline.ingestText({
          text: d.content.trim(),
          title: d.title,
          source: "benchmark",
          projectName: BENCH_PROJECT,
          updateExisting: true,
          lastWriteWins: true,
          author: "search-benchmark",
        });
      });

      // OpenAI embeds a query as the raw text, so a batch is identical; the local
      // embedder prefixes queries differently from documents, so go one by one.
      const texts = queries.map((q) => q.text);
      const vectors =
        resolveEmbedderKind() === "local"
          ? await Promise.all(texts.map((t) => getEmbedding(t, settings.openaiApiKey)))
          : await embedBatch(texts, settings.openaiApiKey);
      const ranked = [];
      for (let i = 0; i < queries.length; i++) ranked.push(await store.searchDocs(queries[i]!.text, vectors[i]!, projectId));
      const result = evaluate(queries, ranked, keyById);

      // One assertion listing every breach, so a failure names all of them.
      const breaches = floorBreaches(result, floors);
      expect(breaches).toEqual([]);
    },
    BUDGET_MS,
  );
});
