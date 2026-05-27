/**
 * `cerefox metadata-search` — metadata-only search (no text query).
 *
 * Calls `cerefox_metadata_search(p_metadata_filter, p_project_id,
 * p_updated_since, p_created_since, p_limit, p_include_content,
 * p_max_bytes)`. Identical to the MCP tool's wire shape.
 */

import type { Command } from "commander";

import {
  c,
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

interface MetadataSearchRow {
  document_id: string;
  title: string;
  doc_metadata: Record<string, unknown>;
  review_status: string;
  source: string | null;
  created_at: string;
  updated_at: string;
  total_chars: number;
  chunk_count: number;
  project_ids: string[];
  project_names: string[];
  version_count: number;
  content: string | null;
}

async function action(options: {
  metadataFilter: string;
  projectName?: string;
  updatedSince?: string;
  createdSince?: string;
  includeContent?: boolean;
  limit?: string;
  maxBytes?: string;
  requestor?: string;
  json?: boolean;
}): Promise<void> {
  const metadataFilter = parseJsonObjectArg(options.metadataFilter, "--metadata-filter");
  if (!metadataFilter || Object.keys(metadataFilter).length === 0) {
    throw userError(
      "--metadata-filter is required and must be a non-empty JSON object.",
      `Example: --metadata-filter '{"type":"decision-log"}'.`,
    );
  }

  const limit = parsePositiveInt(options.limit, "--limit", 10);
  const maxBytes = parseNonNegativeInt(options.maxBytes, "--max-bytes", 200_000);

  const client = getClient();

  let projectId: string | null = null;
  if (options.projectName) {
    const { data: project, error } = await client.raw
      .from("cerefox_projects")
      .select("id")
      .eq("name", options.projectName)
      .maybeSingle();
    if (error) throw systemError(`Project lookup failed: ${error.message}`);
    if (!project) throw userError(`Project "${options.projectName}" not found.`);
    projectId = project.id;
  }

  const params: Record<string, unknown> = {
    p_metadata_filter: metadataFilter,
    p_project_id: projectId,
    p_updated_since: options.updatedSince ?? null,
    p_created_since: options.createdSince ?? null,
    p_limit: limit,
    p_include_content: Boolean(options.includeContent),
  };
  if (options.includeContent) params.p_max_bytes = maxBytes;

  const rows = await client.rpc<MetadataSearchRow[]>("cerefox_metadata_search", params);
  if (rows === null) {
    throw systemError("cerefox_metadata_search: RPC returned no data.");
  }

  const requestor = resolveRequestor(options.requestor);
  client.raw
    .rpc("cerefox_log_usage", {
      p_operation: "metadata_search",
      p_access_path: "cli",
      p_requestor: requestor,
      p_query_text: JSON.stringify(metadataFilter),
      p_project_id: projectId,
      p_result_count: rows.length,
    })
    .then(() => {}, () => {});

  if (options.json) {
    printJson(rows);
    return;
  }

  if (rows.length === 0) {
    println("No documents match the metadata filter.");
    return;
  }

  for (const row of rows) {
    const projects = row.project_names?.length
      ? ` | projects: ${row.project_names.join(", ")}`
      : "";
    const meta = Object.entries(row.doc_metadata ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    println(c.bold(`## ${row.title} [id: ${row.document_id}]`));
    println(
      c.dim(
        `${meta}${projects} | ${row.total_chars} chars | ${row.review_status} | updated ${row.updated_at?.slice(0, 10) ?? "?"}`,
      ),
    );
    if (options.includeContent && row.content) {
      println("");
      println(row.content);
    }
    println("");
    println(c.dim("---"));
    println("");
  }
}

export function registerMetadataSearch(program: Command): void {
  program
    .command("metadata-search")
    .description("Find documents by metadata criteria (no text query).")
    .requiredOption(
      "-f, --metadata-filter <json>",
      "JSON object; only docs whose metadata contains ALL pairs are returned.",
    )
    .option("-p, --project-name <name>", "Filter to a specific project.")
    .option("--updated-since <iso>", "Only docs updated on/after this ISO timestamp.")
    .option("--created-since <iso>", "Only docs created on/after this ISO timestamp.")
    .option("--include-content", "Include full document text in results.")
    .option("-l, --limit <n>", "Maximum docs to return.", "10")
    .option("--max-bytes <n>", "Response size budget in bytes (with --include-content).", "200000")
    .option("-r, --requestor <name>", "Agent / user name (usage log).")
    .option("--json", "Emit machine-readable JSON.")
    .action(action);
}
