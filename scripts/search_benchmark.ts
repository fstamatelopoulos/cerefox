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
 * --check-floors              fail if the built-in defaults fall below this
 *                             embedder's floors (the release check, RELEASING.md)
 * --write-floors              record the live formula's per-category floors for
 *                             this store's embedder in vocabulary/floors.json
 *                             (what the live floor test asserts)
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { embedBatch } from "../_shared/embeddings/index.ts";
import { bounded, linear, raw, rrf, run, type Candidate, type ChunkSignals, type RankedDocs } from "../_shared/search-benchmark/fusion.ts";
import {
  BENCH_PROJECT,
  ensureCorpus,
  floorBreaches,
  floorsFrom,
  type Floors,
  evaluate as evaluateRanking,
  toRanked,
  type BenchStore,
  type Evaluation,
  type SearchRow,
  type VocabularyDoc as Doc,
  type VocabularyQuery as Query,
} from "../_shared/search-benchmark/live.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const FIXTURE = join(REPO, "_shared", "search-benchmark", "vocabulary");


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
    // 1. Corpus in. Only missing or changed documents are written.
    const store = sqlStore(sql);
    const { projectId, keyById, written } = await ensureCorpus(store, corpus, async (d) => {
      const r = await fetch(`${api}/api/v1/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Cerefox-Author": "search-benchmark" },
        body: JSON.stringify({ title: d.title, content: d.content, project_name: BENCH_PROJECT, update_if_exists: true, last_write_wins: true, source: "benchmark" }),
      });
      if (!r.ok) throw new Error(`ingest "${d.title}": ${r.status} ${await r.text()}`);
    });
    console.error(`[bench] ${label}: corpus of ${corpus.length} in "${BENCH_PROJECT}" (${written} written)`);
    const proj = { id: projectId };

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

    // 4. The live formula and its parameters, as this target resolves them.
    // Schema 0.18.0 bounded the keyword score and moved two built-in defaults.
    const [{ v: schema }] = await sql`SELECT cerefox_schema_version() AS v`;
    const [maj = 0, min = 0] = String(schema).split(".").map(Number);
    const calibrated = maj > 0 || min >= 18;
    const cfg = async (k: string, d: number) => {
      const [r] = await sql`SELECT cerefox_config_float(${k}, ${d}) AS v`;
      return Number(r!.v);
    };
    const defaultFloor = calibrated ? Number((await sql`SELECT cerefox_default_min_search_score() AS v`)[0]!.v) : 0.5;
    const live = {
      alpha: await cfg("search_alpha", 0.7),
      minScore: await cfg("min_search_score", defaultFloor),
      minCoverage: await cfg("min_term_coverage", calibrated ? 0.67 : 0.5),
    };
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
      liveRanked.push(await store.searchDocs(queries[i]!.text, vectors[i]!, proj.id));
    }

    // 6. The reproduction check. Nothing below is trusted unless this passes.
    const current = linear(`live (schema ${schema})`, live.alpha, gates, calibrated ? bounded : raw);
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
        candidates.push(linear(`unbounded a=0.7 ${tag}`, 0.7, g, raw));
        for (const a of [0.6, 0.7, 0.8]) candidates.push(linear(`bounded a=${a} ${tag}`, a, g, bounded));
        candidates.push(rrf(`rrf k=60 ${tag}`, 60, g));
      }
    }

    const report = { label, embed, schema: String(schema), live, queries: queries.length, documents: corpus.length, candidates: candidates.map((c) => evaluate(c, queries, signals, keyById)) };
    writeFileSync(out, JSON.stringify(report, null, 2));
    if (flag("check-floors")) {
      // The same evaluation the live floor test makes, but with the query
      // embeddings the runner can produce for either embedder (a Local store's
      // model cannot run on the host, so the floor test covers OpenAI only).
      if (!calibrated) throw new Error("--check-floors needs schema >= 0.18.0");
      const [{ e: embedder }] = await sql`SELECT embedder_primary AS e FROM cerefox_chunks WHERE version_id IS NULL LIMIT 1`;
      const floors = (JSON.parse(readFileSync(join(FIXTURE, "floors.json"), "utf8")) as Record<string, Floors>)[embedder as string];
      if (!floors) throw new Error(`no floors recorded for ${embedder}`);
      const got = evaluate(linear("defaults", 0.7, { minScore: defaultFloor, minCoverage: 0.67 }, bounded), queries, signals, keyById);
      const breaches = floorBreaches(got, floors);
      if (breaches.length > 0) throw new Error(`floors breached (${embedder}):\n  ${breaches.join("\n  ")}`);
      console.error(`[bench] floors hold for ${embedder}: overall MRR ${got.overall.mrr.toFixed(3)} (floor ${floors.overallMrr})`);
    }
    if (flag("write-floors")) {
      const [{ e: embedder }] = await sql`SELECT embedder_primary AS e FROM cerefox_chunks WHERE version_id IS NULL LIMIT 1`;
      const path = join(FIXTURE, "floors.json");
      let all: Record<string, unknown> = {};
      try {
        all = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
      } catch {
        // first write
      }
      // Floors describe the built-in defaults, not this store's own tuning (a
      // labelled store is often tuned): the same formula at the default gates.
      if (!calibrated) throw new Error("--write-floors needs schema >= 0.18.0");
      const defaults = linear("defaults", 0.7, { minScore: defaultFloor, minCoverage: 0.67 }, bounded);
      all[embedder as string] = floorsFrom(String(schema), evaluate(defaults, queries, signals, keyById));
      writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
      console.error(`[bench] floors for ${embedder} written to ${path}`);
    }
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
    // A query embeds as the raw text on OpenAI, so a batch is identical.
    return embedBatch(texts, key);
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

interface CandidateReport extends Evaluation { name: string }

function evaluate(c: Candidate, queries: Query[], signals: ChunkSignals[][], keyById: Map<string, string>): CandidateReport {
  return { name: c.name, ...evaluateRanking(queries, signals.map((sig) => run(c, sig, 10)), keyById) };
}

function sqlStore(sql: postgres.Sql): BenchStore {
  const projectId = async () =>
    ((await sql`SELECT id FROM cerefox_projects WHERE name = ${BENCH_PROJECT}`)[0]?.id as string | undefined) ?? null;
  return {
    projectId,
    async listDocs() {
      const pid = await projectId();
      if (!pid) return new Map();
      const rows = await sql`SELECT d.id, d.title, d.content_hash FROM cerefox_documents d
        JOIN cerefox_document_projects dp ON dp.document_id = d.id AND dp.project_id = ${pid}
        WHERE d.deleted_at IS NULL`;
      return new Map(rows.map((r) => [r.title as string, { id: r.id as string, content_hash: r.content_hash as string }]));
    },
    async searchDocs(query, embedding, pid) {
      const rows = await sql`SELECT document_id, best_score, below_confidence FROM cerefox_search_docs(
        p_query_text => ${query}, p_query_embedding => ${`[${embedding.join(",")}]`}::vector, p_match_count => 10, p_project_id => ${pid})`;
      return toRanked(rows as unknown as SearchRow[]);
    },
  };
}

function markdown(r: { label: string; embed: string; schema: string; live: Record<string, number>; queries: number; documents: number; candidates: CandidateReport[] }): string {
  const f = (x: number) => x.toFixed(3);
  const lines = [
    `## Search benchmark: ${r.label} (${r.embed}, schema ${r.schema})`,
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
