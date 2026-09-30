#!/usr/bin/env bun
/**
 * search_benchmark.ts — the search-calibration benchmark (iteration 48).
 * Design: docs/specs/search-calibration.md.
 *
 * Ingests the synthetic corpus into a dedicated project on a LABELLED target,
 * fetches the raw per-chunk ranking signals for every query through a temporary
 * probe function, applies each candidate formula client-side, and reports
 * per-category metrics. It first proves that its reproduction of the CURRENT
 * formula matches the live cerefox_search_docs ranking; if not, it stops.
 *
 * Usage:
 *   bun scripts/search_benchmark.ts --api http://127.0.0.1:8030 \
 *       --db "$CEREFOX_DATABASE_URL" --embed openai --out /tmp/bench.json
 *   bun scripts/search_benchmark.ts --api http://127.0.0.1:8099 \
 *       --db postgresql://cerefox:cerefox@127.0.0.1:55432/cerefox \
 *       --embed container:cfx-bench-local --label local-throwaway
 *
 * --embed openai              query vectors via OpenAI (needs OPENAI_API_KEY)
 * --embed container:<name>    query vectors computed inside a Cerefox Local
 *                             container, with its own model and runtime
 * --label <text>              required unless CEREFOX_ENV_LABEL is set: this
 *                             script writes documents and must never run
 *                             against production
 * --cleanup                   delete and purge the benchmark documents after
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { getEmbedding } from "../_shared/embeddings/index.ts";
import { bounded, linear, raw, rrf, run, type Candidate, type ChunkSignals, type RankedDocs } from "../_shared/search-benchmark/fusion.ts";
import { groupConsistency, hitAt1, mean, ndcgAtK, recallAtK, reciprocalRank } from "../_shared/search-benchmark/metrics.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const FIXTURE = join(REPO, "_shared", "search-benchmark", "vocabulary");
export const BENCH_PROJECT = "Search calibration benchmark";

interface Doc { key: string; title: string; content: string }
interface Query { id: string; category: string; text: string; relevant: Record<string, number>; group?: string }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const api = arg("api");
  const dbUrl = arg("db");
  const embed = arg("embed") ?? "openai";
  const out = arg("out") ?? "/tmp/search-benchmark.json";
  const label = arg("label") ?? process.env.CEREFOX_ENV_LABEL;
  if (!api || !dbUrl) throw new Error("--api and --db are required");
  if (!label) throw new Error("Refusing to run without --label or CEREFOX_ENV_LABEL: this writes documents and must never target production.");

  const dir = arg("corpus") ?? FIXTURE;
  const corpus = JSON.parse(readFileSync(join(dir, "corpus.json"), "utf8")) as Doc[];
  const queries = JSON.parse(readFileSync(join(dir, "queries.json"), "utf8")) as Query[];
  const sql = postgres(dbUrl, { max: 4, onnotice: () => {} });

  try {
    // 1. Corpus in, idempotently (same title → update; unchanged content is a no-op).
    console.error(`[bench] ${label}: ingesting ${corpus.length} documents into "${BENCH_PROJECT}"…`);
    for (const d of corpus) {
      const r = await fetch(`${api}/api/v1/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Cerefox-Author": "search-benchmark" },
        body: JSON.stringify({ title: d.title, content: d.content, project_name: BENCH_PROJECT, update_if_exists: true, last_write_wins: true, source: "benchmark" }),
      });
      if (!r.ok) throw new Error(`ingest "${d.title}": ${r.status} ${await r.text()}`);
    }
    const [proj] = await sql`SELECT id FROM cerefox_projects WHERE name = ${BENCH_PROJECT}`;
    if (!proj) throw new Error("benchmark project not found after ingest");
    const rows = await sql`SELECT d.id, d.title FROM cerefox_documents d
      JOIN cerefox_document_projects dp ON dp.document_id = d.id AND dp.project_id = ${proj.id}
      WHERE d.deleted_at IS NULL`;
    const keyById = new Map<string, string>();
    const byTitle = new Map(corpus.map((d) => [d.title, d.key]));
    for (const r of rows) {
      const k = byTitle.get(r.title as string);
      if (k) keyById.set(r.id as string, k);
    }
    if (keyById.size !== corpus.length) throw new Error(`expected ${corpus.length} benchmark documents, found ${keyById.size}`);

    // 2. Probe in (locked down: service_role only, as for every cerefox_ function).
    await sql.unsafe(readFileSync(join(REPO, "_shared", "search-benchmark", "probe.sql"), "utf8"));
    await sql.unsafe(`DO $$ DECLARE r text; BEGIN
      REVOKE EXECUTE ON FUNCTION cerefox_bench_signals(TEXT, VECTOR(768), UUID) FROM PUBLIC;
      FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
          EXECUTE format('REVOKE EXECUTE ON FUNCTION cerefox_bench_signals(TEXT, VECTOR(768), UUID) FROM %I', r);
        END IF; END LOOP; END $$`);

    // 3. Query vectors, with the target's own embedder.
    console.error(`[bench] embedding ${queries.length} queries (${embed})…`);
    const vectors = await embedQueries(queries.map((q) => q.text), embed);

    // 4. Live gates (the formula's current parameters on this target).
    const cfg = async (k: string, d: number) => {
      const [r] = await sql`SELECT cerefox_config_float(${k}, ${d}) AS v`;
      return Number(r!.v);
    };
    const live = { alpha: await cfg("search_alpha", 0.7), minScore: await cfg("min_search_score", 0.5), minCoverage: await cfg("min_term_coverage", 0.5) };
    const gates = { minScore: live.minScore, minCoverage: live.minCoverage };

    // 5. Signals + the live ranking, per query.
    const signals: ChunkSignals[][] = [];
    const liveRanked: RankedDocs[] = [];
    for (let i = 0; i < queries.length; i++) {
      const vec = `[${vectors[i]!.join(",")}]`;
      const sig = await sql`SELECT * FROM cerefox_bench_signals(${queries[i]!.text}, ${vec}::vector, ${proj.id})`;
      // The live RPC ranks within a 500-chunk pool per side (match_count 10 × 10 × 5);
      // the probe sees every chunk, so the two agree only while the corpus fits in it.
      if (sig.length > 500) throw new Error(`corpus has ${sig.length} chunks; the reproduction assumes <= 500`);
      signals.push(sig.map((s) => ({ ...s, vec_score: Number(s.vec_score), rank_and: Number(s.rank_and), rank_or: Number(s.rank_or) }) as unknown as ChunkSignals));
      const lv = await sql`SELECT document_id, best_score, below_confidence FROM cerefox_search_docs(
        p_query_text => ${queries[i]!.text}, p_query_embedding => ${vec}::vector, p_match_count => 10, p_project_id => ${proj.id})`;
      liveRanked.push({ docs: lv.map((r) => ({ document_id: r.document_id as string, score: Number(r.best_score) })), below_confidence: Boolean(lv[0]?.below_confidence) });
    }

    // 6. The reproduction check. Nothing below is trusted unless this passes.
    const current = linear("current", live.alpha, gates, raw);
    const mismatches: string[] = [];
    queries.forEach((q, i) => {
      const mine = run(current, signals[i]!, 10);
      const theirs = liveRanked[i]!.docs;
      // Same length, same score at every position, and each document scored the
      // same on both sides. Position alone would fail on exact ties, whose order
      // Postgres does not define.
      const liveScore = new Map(theirs.map((d) => [d.document_id, d.score]));
      const ok =
        mine.docs.length === theirs.length &&
        mine.docs.every((d, j) => Math.abs(d.score - theirs[j]!.score) < 1e-6) &&
        mine.docs.every((d) => !liveScore.has(d.document_id) || Math.abs(liveScore.get(d.document_id)! - d.score) < 1e-6) &&
        mine.below_confidence === liveRanked[i]!.below_confidence;
      if (!ok) mismatches.push(q.id);
    });
    if (mismatches.length > 0) {
      throw new Error(`reproduction check FAILED for ${mismatches.length}/${queries.length} queries (${mismatches.slice(0, 10).join(", ")}): the harness does not model the live RPC; fix it before trusting any number`);
    }
    console.error(`[bench] reproduction check: ${queries.length}/${queries.length} queries match the live ranking exactly`);

    // 7. Candidates, all over the identical signals.
    // The gate is embedder-specific (cosine distributions differ), so every
    // formula is scored across a grid of gates, not only at the live value.
    // The gates are embedder-specific (cosine distributions differ) and interact
    // with the formula, so every formula is scored across a grid of both gates.
    const candidates: Candidate[] = [current];
    for (const mc of [0.5, 0.67]) {
      for (const ms of [0.4, 0.5, 0.6, 0.7]) {
        const g = { minScore: ms, minCoverage: mc };
        const tag = `min=${ms} cov=${mc}`;
        candidates.push(linear(`current ${tag}`, live.alpha, g, raw));
        for (const a of [0.6, 0.7, 0.8]) candidates.push(linear(`bounded a=${a} ${tag}`, a, g, bounded));
        candidates.push(rrf(`rrf k=60 ${tag}`, 60, g));
      }
    }

    const report = { label, embed, live, queries: queries.length, documents: corpus.length, candidates: candidates.map((c) => evaluate(c, queries, signals, keyById)) };
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(markdown(report));
    console.error(`[bench] report: ${out}`);
  } finally {
    await sql.unsafe("DROP FUNCTION IF EXISTS cerefox_bench_signals(TEXT, VECTOR(768), UUID)").catch(() => {});
    if (flag("cleanup")) {
      const ids = await sql`SELECT d.id FROM cerefox_documents d JOIN cerefox_document_projects dp ON dp.document_id = d.id
        JOIN cerefox_projects p ON p.id = dp.project_id WHERE p.name = ${BENCH_PROJECT}`;
      for (const { id } of ids) await sql`DELETE FROM cerefox_documents WHERE id = ${id}`;
      await sql`DELETE FROM cerefox_projects WHERE name = ${BENCH_PROJECT}`;
      console.error(`[bench] cleanup: removed ${ids.length} documents and the project`);
    }
    await sql.end();
  }
}

async function embedQueries(texts: string[], embed: string): Promise<number[][]> {
  if (embed === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is required for --embed openai");
    const out: number[][] = [];
    for (const t of texts) out.push(await getEmbedding(t, key));
    return out;
  }
  if (embed.startsWith("container:")) {
    // The repo's own embedder, run inside a Cerefox Local container against the
    // image's pinned runtime and cached model: byte-identical to what that
    // container's search embeds a query as. Placed under /opt/cerefox so its
    // dynamic import resolves the image's node_modules.
    const name = embed.slice("container:".length);
    execFileSync("docker", ["exec", name, "mkdir", "-p", "/opt/cerefox/bench"]);
    execFileSync("docker", ["cp", join(REPO, "_shared", "embeddings", "onnx-embedder.ts"), `${name}:/opt/cerefox/bench/onnx-embedder.ts`]);
    const script = `import { onnxEmbed } from "/opt/cerefox/bench/onnx-embedder.ts";
      const texts = JSON.parse(await Bun.stdin.text());
      console.log(JSON.stringify(await onnxEmbed(texts, "query")));`;
    try {
      const res = execFileSync("docker", ["exec", "-i", "-w", "/opt/cerefox/bench", name, "bun", "-e", script], {
        input: JSON.stringify(texts),
        maxBuffer: 256 * 1024 * 1024,
        encoding: "utf8",
      });
      return JSON.parse(res.trim().split("\n").pop()!) as number[][];
    } finally {
      execFileSync("docker", ["exec", name, "rm", "-rf", "/opt/cerefox/bench"]);
    }
  }
  throw new Error(`unknown --embed ${embed}`);
}

interface CandidateReport {
  name: string;
  overall: Metrics;
  byCategory: Record<string, Metrics & { n: number }>;
  groups: { consistency: number; scoreSpread: number; n: number };
  negatives: { confidentFalsePositives: number; n: number };
  topScore: { p10: number; p50: number; p90: number };
  perQuery: { id: string; rr: number; below: boolean; top: string[] }[];
}
interface Metrics { mrr: number; hit1: number; recall5: number; ndcg10: number }

function evaluate(c: Candidate, queries: Query[], signals: ChunkSignals[][], keyById: Map<string, string>): CandidateReport {
  const ranked = queries.map((_, i) => run(c, signals[i]!, 10));
  const keys = ranked.map((r) => r.docs.map((d) => keyById.get(d.document_id) ?? d.document_id));
  const per = queries.map((q, i) => ({
    q,
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
  const byCategory: CandidateReport["byCategory"] = {};
  for (const cat of [...new Set(positive.map((p) => p.q.category))].sort()) {
    const xs = positive.filter((p) => p.q.category === cat);
    byCategory[cat] = { ...agg(xs), n: xs.length };
  }
  const groupIds = [...new Set(queries.map((q) => q.group).filter(Boolean))] as string[];
  const consistency = mean(
    groupIds.map((g) => groupConsistency(queries.map((q, i) => (q.group === g ? keys[i]! : null)).filter((x): x is string[] => x !== null), 5)),
  );
  // How far the shared target's score moves across a group's variants, relative to
  // its best: 0 = every phrasing scores it the same; 1 = some phrasing loses it.
  // This is the "full name vs short name" symptom, measured on every group shape.
  const scoreSpread = mean(
    groupIds.map((g) => {
      const members = queries.map((q, i) => ({ q, i })).filter((m) => m.q.group === g);
      const target = Object.keys(members[0]!.q.relevant).find((k) => members.every((m) => m.q.relevant[k] === 2))!;
      const scores = members.map((m) => {
        const j = keys[m.i]!.indexOf(target);
        return j === -1 ? 0 : ranked[m.i]!.docs[j]!.score;
      });
      const hi = Math.max(...scores);
      return hi <= 0 ? 1 : (hi - Math.min(...scores)) / hi;
    }),
  );
  const negIdx = queries.map((q, i) => (q.category === "negative" ? i : -1)).filter((i) => i >= 0);
  const confidentFP = negIdx.filter((i) => ranked[i]!.docs.length > 0 && !ranked[i]!.below_confidence).length;
  const tops = positive.map((_, i) => ranked[queries.indexOf(positive[i]!.q)]!.docs[0]?.score ?? 0).sort((a, b) => a - b);
  const pct = (p: number) => tops[Math.min(tops.length - 1, Math.floor(p * tops.length))] ?? 0;
  return {
    name: c.name,
    overall: agg(positive),
    byCategory,
    groups: { consistency, scoreSpread, n: groupIds.length },
    negatives: { confidentFalsePositives: confidentFP, n: negIdx.length },
    topScore: { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9) },
    perQuery: queries.map((q, i) => ({
      id: q.id,
      rr: per[i]!.mrr,
      below: ranked[i]!.below_confidence,
      top: ranked[i]!.docs.slice(0, 3).map((d, j) => `${keys[i]![j]}@${d.score.toFixed(3)}`),
    })),
  };
}

function markdown(r: { label: string; embed: string; live: Record<string, number>; queries: number; documents: number; candidates: CandidateReport[] }): string {
  const f = (x: number) => x.toFixed(3);
  const lines = [
    `## Search benchmark: ${r.label} (${r.embed})`,
    ``,
    `${r.documents} documents, ${r.queries} queries. Live parameters: alpha ${r.live.alpha}, min_search_score ${r.live.minScore}, min_term_coverage ${r.live.minCoverage}.`,
    ``,
    `| Candidate | MRR@10 | Hit@1 | Recall@5 | nDCG@10 | Variant top-5 overlap | Variant score spread | Confident FP (negatives) | Top score p10/p50/p90 |`,
    `|---|---|---|---|---|---|---|---|---|`,
    ...r.candidates.map((c) => `| ${c.name} | ${f(c.overall.mrr)} | ${f(c.overall.hit1)} | ${f(c.overall.recall5)} | ${f(c.overall.ndcg10)} | ${f(c.groups.consistency)} | ${f(c.groups.scoreSpread)} | ${c.negatives.confidentFalsePositives}/${c.negatives.n} | ${f(c.topScore.p10)} / ${f(c.topScore.p50)} / ${f(c.topScore.p90)} |`),
    ``,
    `### MRR@10 by category`,
    ``,
  ];
  const cats = Object.keys(r.candidates[0]!.byCategory);
  lines.push(`| Candidate | ${cats.map((c) => `${c} (${r.candidates[0]!.byCategory[c]!.n})`).join(" | ")} |`);
  lines.push(`|---|${cats.map(() => "---").join("|")}|`);
  for (const c of r.candidates) lines.push(`| ${c.name} | ${cats.map((cat) => f(c.byCategory[cat]!.mrr)).join(" | ")} |`);
  return lines.join("\n");
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`[bench] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
