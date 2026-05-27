/**
 * `cerefox search <query>` — hybrid (FTS + semantic) document-level search.
 *
 * Embeds the query client-side via `_shared/embeddings/getEmbedding()`,
 * then calls `cerefox_search_docs` (default) / `cerefox_hybrid_search` /
 * `cerefox_fts_search` based on `--mode`. Same RPC choices the MCP
 * `cerefox_search` tool makes, so an agent that learned the MCP shape
 * sees the same behaviour from the CLI.
 *
 * Default mode is `docs`: returns full reconstructed documents (the
 * recommended path for agents). `hybrid` returns ranked chunks. `fts`
 * skips the embedding entirely (no OpenAI key required).
 */

import type { Command } from "commander";

import {
  c,
  parseFloat01,
  parseNonNegativeInt,
  parsePositiveInt,
  parseJsonObjectArg,
  println,
  printJson,
  resolveRequestor,
  systemError,
  userError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";
import { embedQuery } from "../util/embed.ts";

interface DocResult {
  document_id: string;
  doc_title: string;
  doc_source: string | null;
  best_score: number | null;
  full_content: string;
  chunk_count: number;
  total_chars: number;
  is_partial: boolean;
  doc_updated_at: string | null;
  version_count: number;
  doc_project_ids: string[] | null;
}

interface ChunkResult {
  chunk_id: string;
  document_id: string;
  chunk_index: number;
  title: string | null;
  content: string;
  score: number;
  doc_title: string;
}

async function action(
  query: string,
  options: {
    matchCount?: string;
    projectName?: string;
    metadataFilter?: string;
    mode?: string;
    alpha?: string;
    minScore?: string;
    maxBytes?: string;
    requestor?: string;
    json?: boolean;
  },
): Promise<void> {
  if (!query || query.trim() === "") {
    throw userError("Empty query.");
  }

  const matchCount = parsePositiveInt(options.matchCount, "--match-count", 5);
  const alpha = parseFloat01(options.alpha, "--alpha", 0.7);
  const minScore = parseFloat01(options.minScore, "--min-score", 0.5);
  const maxBytes = parseNonNegativeInt(options.maxBytes, "--max-bytes", 200_000);
  const mode = options.mode ?? "docs";
  if (!["docs", "hybrid", "fts"].includes(mode)) {
    throw userError(`--mode "${mode}": expected "docs", "hybrid", or "fts".`);
  }
  const metadataFilter = parseJsonObjectArg(options.metadataFilter, "--metadata-filter");

  const client = getClient();

  // Resolve --project-name → project_id if provided.
  let projectId: string | null = null;
  if (options.projectName) {
    const { data: project, error } = await client.raw
      .from("cerefox_projects")
      .select("id")
      .eq("name", options.projectName)
      .maybeSingle();
    if (error) throw systemError(`Project lookup failed: ${error.message}`);
    if (!project) {
      throw userError(`Project "${options.projectName}" not found.`);
    }
    projectId = project.id;
  }

  // Embed the query unless --mode=fts.
  let embedding: number[] | null = null;
  if (mode !== "fts") {
    embedding = await embedQuery(query);
  }

  const metaFilterParam =
    metadataFilter && Object.keys(metadataFilter).length > 0
      ? { p_metadata_filter: metadataFilter }
      : {};

  let rpcName: string;
  let rpcParams: Record<string, unknown>;

  if (mode === "fts") {
    rpcName = "cerefox_fts_search";
    rpcParams = {
      p_query_text: query,
      p_match_count: matchCount,
      p_project_id: projectId,
      ...metaFilterParam,
    };
  } else if (mode === "hybrid") {
    rpcName = "cerefox_hybrid_search";
    rpcParams = {
      p_query_text: query,
      p_query_embedding: embedding,
      p_match_count: matchCount,
      p_alpha: alpha,
      p_use_upgrade: false,
      p_project_id: projectId,
      p_min_score: minScore,
      ...metaFilterParam,
    };
  } else {
    rpcName = "cerefox_search_docs";
    rpcParams = {
      p_query_text: query,
      p_query_embedding: embedding,
      p_match_count: matchCount,
      p_alpha: alpha,
      p_project_id: projectId,
      p_min_score: minScore,
      ...metaFilterParam,
    };
  }

  const results = await client.rpc<DocResult[] | ChunkResult[]>(rpcName, rpcParams);
  if (results === null) {
    throw systemError(`${rpcName}: RPC returned no data.`);
  }

  // Byte budget — drop results whole until under maxBytes.
  let usedBytes = 0;
  const accepted: Array<DocResult | ChunkResult> = [];
  let truncated = false;
  for (const row of results) {
    const rowBytes = Buffer.byteLength(JSON.stringify(row), "utf8");
    if (usedBytes + rowBytes > maxBytes && accepted.length > 0) {
      truncated = true;
      break;
    }
    accepted.push(row);
    usedBytes += rowBytes;
  }

  // Best-effort usage log.
  const requestor = resolveRequestor(options.requestor);
  client.raw
    .rpc("cerefox_log_usage", {
      p_operation: "search",
      p_access_path: "cli",
      p_requestor: requestor,
      p_query_text: query,
      p_project_id: projectId,
      p_result_count: accepted.length,
    })
    .then(() => {}, () => {});

  if (options.json) {
    printJson({
      results: accepted,
      query,
      mode,
      match_count: matchCount,
      project_name: options.projectName ?? null,
      metadata_filter: metadataFilter ?? null,
      truncated,
      response_bytes: usedBytes,
    });
    return;
  }

  if (accepted.length === 0) {
    println("No results found.");
    return;
  }

  for (const row of accepted) {
    if (mode === "docs") {
      const doc = row as DocResult;
      const title = doc.doc_title ?? "Untitled";
      const docId = doc.document_id ? ` [id: ${doc.document_id}]` : "";
      const score = doc.best_score != null ? ` (score: ${doc.best_score.toFixed(3)})` : "";
      const partial = doc.is_partial
        ? ` -- partial (${doc.chunk_count} of ${doc.total_chars.toLocaleString()} chars)`
        : "";
      println(c.bold(`## ${title}${docId}${score}${partial}`));
      println("");
      println(doc.full_content ?? "");
      println("");
      println(c.dim("---"));
      println("");
    } else {
      const chunk = row as ChunkResult;
      println(
        c.bold(
          `## ${chunk.doc_title}` +
            (chunk.title ? ` › ${chunk.title}` : "") +
            ` (score: ${chunk.score.toFixed(3)})`,
        ),
      );
      println(c.dim(`[chunk ${chunk.chunk_id}]`));
      println("");
      println(chunk.content ?? "");
      println("");
      println(c.dim("---"));
      println("");
    }
  }

  if (truncated) {
    println(c.dim(`(results truncated at ${usedBytes} bytes; use --max-bytes to raise)`));
  }
}

export function registerSearch(program: Command): void {
  program
    .command("search")
    .description("Search the knowledge base (hybrid FTS + semantic).")
    .argument("<query>", "Natural-language search query.")
    .option("-c, --match-count <n>", "Maximum number of documents to return.", "5")
    .option("-p, --project-name <name>", "Filter results to a specific project.")
    .option(
      "-f, --metadata-filter <json>",
      "JSON containment filter; only docs whose metadata contains ALL pairs are returned.",
    )
    .option("--mode <mode>", "Search mode: docs (default), hybrid, fts.", "docs")
    .option("--alpha <float>", "Semantic weight 0..1 (default: 0.7).", "0.7")
    .option("--min-score <float>", "Minimum cosine similarity threshold.", "0.5")
    .option("--max-bytes <n>", "Response size budget in bytes.", "200000")
    .option("-r, --requestor <name>", "Agent / user name (recorded in usage log).")
    .option("--json", "Emit machine-readable JSON instead of the default text.")
    .action(action);
}
