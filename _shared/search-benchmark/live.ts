/**
 * The vocabulary against a live store (iteration 48): shared by the benchmark
 * runner (`scripts/search_benchmark.ts`) and the floor test
 * (`packages/memory/test/search-calibration-floor.test.ts`).
 *
 * Callers must have checked the target is labelled (non-production) first:
 * `ensureCorpus` writes.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { contentHash } from "../ingest/pipeline-helpers.ts";
import type { RankedDocs } from "./fusion.ts";
import { groupConsistency, hitAt1, mean, ndcgAtK, recallAtK, reciprocalRank } from "./metrics.ts";

export const BENCH_PROJECT = "Search calibration benchmark";

export interface VocabularyDoc { key: string; title: string; content: string }
export interface VocabularyQuery { id: string; category: string; text: string; relevant: Record<string, number>; group?: string | null }

/** What the vocabulary needs from a store; the runner backs it with SQL, the floor test with the Data API. */
export interface BenchStore {
  /** The benchmark project's documents, by title. */
  listDocs(): Promise<Map<string, { id: string; content_hash: string }>>;
  projectId(): Promise<string | null>;
  /** cerefox_search_docs at count 10, scoped to the project, store-resolved tuning. */
  searchDocs(query: string, embedding: number[], projectId: string): Promise<RankedDocs>;
}

/**
 * Make the store's benchmark project hold exactly the corpus' current content,
 * and map document ids to corpus keys. Only missing or changed documents are
 * written, so a repeated run adds nothing to the audit log.
 */
export async function ensureCorpus(
  store: BenchStore,
  corpus: VocabularyDoc[],
  ingest: (doc: VocabularyDoc) => Promise<void>,
): Promise<{ projectId: string; keyById: Map<string, string>; written: number }> {
  const existing = await store.listDocs();
  let written = 0;
  for (const d of corpus) {
    const have = existing.get(d.title);
    if (have && have.content_hash === contentHash(d.content.trim())) continue;
    await ingest(d);
    written++;
  }
  const after = written > 0 ? await store.listDocs() : existing;
  const keyById = new Map<string, string>();
  for (const d of corpus) {
    const row = after.get(d.title);
    if (!row || row.content_hash !== contentHash(d.content.trim())) {
      throw new Error(`benchmark document "${d.title}" is missing or stale after ingest`);
    }
    keyById.set(row.id, d.key);
  }
  const projectId = await store.projectId();
  if (!projectId) throw new Error(`project "${BENCH_PROJECT}" not found`);
  return { projectId, keyById, written };
}

/** The Data API (supabase-js) backing, for the floor test. */
export function supabaseStore(supabase: SupabaseClient): BenchStore {
  const projectId = async (): Promise<string | null> => {
    const { data, error } = await supabase.from("cerefox_projects").select("id").eq("name", BENCH_PROJECT).maybeSingle();
    if (error) throw error;
    return (data?.id as string | undefined) ?? null;
  };
  return {
    projectId,
    async listDocs() {
      const pid = await projectId();
      if (!pid) return new Map();
      const { data, error } = await supabase
        .from("cerefox_documents")
        .select("id, title, content_hash, cerefox_document_projects!inner(project_id)")
        .eq("cerefox_document_projects.project_id", pid)
        .is("deleted_at", null)
        // The vocabulary is ~150 documents, and ensureCorpus fails loudly if a
        // document is missing, so a cut-off list cannot pass silently.
        .limit(1000);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.title as string, { id: r.id as string, content_hash: r.content_hash as string }]));
    },
    async searchDocs(query, embedding, pid) {
      const { data, error } = await supabase.rpc("cerefox_search_docs", {
        p_query_text: query,
        p_query_embedding: embedding,
        p_match_count: 10,
        p_project_id: pid,
      });
      if (error) throw error;
      return toRanked((data ?? []) as SearchRow[]);
    },
  };
}

export interface SearchRow { document_id: string; best_score: number | string; below_confidence: boolean }
export function toRanked(rows: SearchRow[]): RankedDocs {
  return {
    docs: rows.map((r) => ({ document_id: r.document_id, score: Number(r.best_score) })),
    below_confidence: Boolean(rows[0]?.below_confidence),
  };
}

/** Per-embedder floors the live floor test asserts (`vocabulary/floors.json`). */
export interface Floors {
  /** Measured on this schema; a target on another schema runs another formula, and skips. */
  schema: string;
  overallMrr: number;
  categoryMrr: Record<string, number>;
  maxConfidentFalsePositives: number;
}

/** Margin below a measurement that a floor sits: room for embedding-API noise, not for a regression. */
export const FLOOR_MARGIN = 0.05;

export function floorsFrom(schema: string, e: Evaluation): Floors {
  const f = (x: number) => Math.max(0, Math.floor((x - FLOOR_MARGIN) * 100) / 100);
  return {
    schema,
    overallMrr: f(e.overall.mrr),
    categoryMrr: Object.fromEntries(Object.entries(e.byCategory).map(([k, m]) => [k, f(m.mrr)])),
    maxConfidentFalsePositives: e.negatives.confidentFalsePositives,
  };
}

export interface Metrics { mrr: number; hit1: number; recall5: number; ndcg10: number }
export interface Evaluation {
  overall: Metrics;
  byCategory: Record<string, Metrics & { n: number }>;
  groups: { consistency: number; scoreSpread: number; n: number };
  negatives: { confidentFalsePositives: number; n: number };
  perQuery: { id: string; rr: number; below: boolean; top: string[] }[];
  topScore: { p10: number; p50: number; p90: number };
}

/** Score one ranking of every query. `keyById` maps document ids to corpus keys. */
export function evaluate(queries: VocabularyQuery[], ranked: RankedDocs[], keyById: Map<string, string>): Evaluation {
  const keys = ranked.map((r) => r.docs.map((d) => keyById.get(d.document_id) ?? d.document_id));
  const per = queries.map((q, i) => ({
    q,
    i,
    mrr: reciprocalRank(keys[i]!, q.relevant),
    hit1: hitAt1(keys[i]!, q.relevant),
    recall5: recallAtK(keys[i]!, q.relevant, 5),
    ndcg10: ndcgAtK(keys[i]!, q.relevant, 10),
  }));
  const positive = per.filter((p) => p.q.category !== "negative");
  const agg = (xs: typeof per): Metrics => ({
    mrr: mean(xs.map((x) => x.mrr)),
    hit1: mean(xs.map((x) => x.hit1)),
    recall5: mean(xs.map((x) => x.recall5)),
    ndcg10: mean(xs.map((x) => x.ndcg10)),
  });
  const byCategory: Evaluation["byCategory"] = {};
  for (const cat of [...new Set(positive.map((p) => p.q.category))].sort()) {
    const xs = positive.filter((p) => p.q.category === cat);
    byCategory[cat] = { ...agg(xs), n: xs.length };
  }

  const groupIds = [...new Set(queries.map((q) => q.group).filter(Boolean))] as string[];
  const members = (g: string) => per.filter((p) => p.q.group === g);
  const consistency = mean(groupIds.map((g) => groupConsistency(members(g).map((m) => keys[m.i]!), 5)));
  // How far the shared target's score moves across a group's variants, relative
  // to its best: 0 = every phrasing scores it the same; 1 = some phrasing loses
  // it. The "full name vs short name" symptom, measured on every group shape.
  const scoreSpread = mean(
    groupIds.map((g) => {
      const ms = members(g);
      const target = Object.keys(ms[0]!.q.relevant).find((k) => ms.every((m) => m.q.relevant[k] === 2))!;
      const scores = ms.map((m) => {
        const j = keys[m.i]!.indexOf(target);
        return j === -1 ? 0 : ranked[m.i]!.docs[j]!.score;
      });
      const hi = Math.max(...scores);
      return hi <= 0 ? 1 : (hi - Math.min(...scores)) / hi;
    }),
  );

  const negatives = per.filter((p) => p.q.category === "negative");
  const confidentFalsePositives = negatives.filter((p) => ranked[p.i]!.docs.length > 0 && !ranked[p.i]!.below_confidence).length;
  const tops = positive.map((p) => ranked[p.i]!.docs[0]?.score ?? 0).sort((a, b) => a - b);
  const pct = (x: number) => tops[Math.min(tops.length - 1, Math.floor(x * tops.length))] ?? 0;

  return {
    overall: agg(positive),
    byCategory,
    groups: { consistency, scoreSpread, n: groupIds.length },
    negatives: { confidentFalsePositives, n: negatives.length },
    perQuery: per.map((p) => ({
      id: p.q.id,
      rr: p.mrr,
      below: ranked[p.i]!.below_confidence,
      top: ranked[p.i]!.docs.slice(0, 3).map((d, j) => `${keys[p.i]![j]}@${d.score.toFixed(3)}`),
    })),
    topScore: { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9) },
  };
}
