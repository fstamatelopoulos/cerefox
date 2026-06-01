/**
 * `cerefox list-docs` — list documents.
 *
 * Direct PostgREST query. Filters: optional project (resolves project name
 * → ID, then joins via `cerefox_document_projects`). Pagination via
 * `--limit`.
 */

import type { Command } from "commander";

import {
  parsePositiveInt,
  printJson,
  printTable,
  systemError,
  userError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface DocRow {
  id: string;
  title: string;
  source: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string | null;
  review_status: string | null;
  deleted_at: string | null;
}

async function action(options: {
  project?: string;
  limit?: string;
  json?: boolean;
  deleted?: boolean;
}): Promise<void> {
  const deleted = !!options.deleted;
  const limit = parsePositiveInt(options.limit, "--limit", 100);
  const client = getClient();

  // Resolve project name → ID if --project supplied.
  let projectId: string | undefined;
  if (options.project) {
    const { data: project, error: projectError } = await client.raw
      .from("cerefox_projects")
      .select("id")
      .eq("name", options.project)
      .maybeSingle();
    if (projectError) {
      throw systemError(`Project lookup failed: ${projectError.message}`);
    }
    if (!project) {
      throw userError(`Project "${options.project}" not found.`, "Run `cerefox list-projects` to see available names.");
    }
    projectId = project.id;
  }

  let query = client.raw
    .from("cerefox_documents")
    .select("id, title, source, metadata, created_at, updated_at, review_status, deleted_at")
    .limit(limit);
  query = deleted
    ? query.not("deleted_at", "is", null).order("deleted_at", { ascending: false, nullsFirst: false })
    : query.is("deleted_at", null).order("updated_at", { ascending: false, nullsFirst: false });

  if (projectId) {
    // PostgREST embedding: filter docs through the M2M junction.
    const { data: junctionRows, error: junctionError } = await client.raw
      .from("cerefox_document_projects")
      .select("document_id")
      .eq("project_id", projectId);
    if (junctionError) {
      throw systemError(`Project membership lookup failed: ${junctionError.message}`);
    }
    const docIds = (junctionRows ?? []).map((r) => (r as { document_id: string }).document_id);
    if (docIds.length === 0) {
      if (options.json) {
        printJson([]);
      } else {
        process.stdout.write(`(no documents in project "${options.project}")\n`);
      }
      return;
    }
    query = query.in("id", docIds);
  }

  const { data, error } = await query;
  if (error) {
    throw systemError(`Could not list documents: ${error.message}`);
  }

  const rows = (data ?? []) as DocRow[];

  if (options.json) {
    printJson(rows);
    return;
  }

  if (rows.length === 0) {
    process.stdout.write(deleted ? "(trash is empty)\n" : "(no documents)\n");
    return;
  }

  printTable(
    rows.map((doc) => {
      const base = {
        id: doc.id.slice(0, 8) + "…",
        title: doc.title.length > 60 ? doc.title.slice(0, 57) + "…" : doc.title,
        source: doc.source ?? "",
        status: doc.review_status ?? "",
      };
      return deleted
        ? { ...base, deleted_at: (doc.deleted_at ?? "").slice(0, 19).replace("T", " ") }
        : { ...base, updated_at: (doc.updated_at ?? doc.created_at).slice(0, 19).replace("T", " ") };
    }),
  );
}

export function registerListDocs(program: Command): void {
  program
    .command("list-docs")
    .description("List documents in the knowledge base.")
    .option("-p, --project <name>", "Filter to a specific project.")
    .option("-l, --limit <n>", "Maximum docs to return.", "100")
    .option("--deleted", "List soft-deleted (trashed) documents instead of active ones.")
    .option("--json", "Emit machine-readable JSON.")
    .action(action);
}
