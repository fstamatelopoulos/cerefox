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

  const docCols = "id, title, source, metadata, created_at, updated_at, review_status, deleted_at";
  // Widened to `string`: the postgrest-js select-string parser's type-level
  // grammar doesn't recognize the `!inner` embed-hint syntax below, so a
  // literal-typed ternary here fails to typecheck on the projectId branch
  // even though it's valid at runtime.
  const selectCols: string = projectId
    ? `${docCols}, cerefox_document_projects!inner(project_id)`
    : docCols;

  let query = client.raw.from("cerefox_documents").select(selectCols).limit(limit);
  query = deleted
    ? query.not("deleted_at", "is", null).order("deleted_at", { ascending: false, nullsFirst: false })
    : query.is("deleted_at", null).order("updated_at", { ascending: false, nullsFirst: false });

  if (projectId) {
    // PostgREST embedding: filter docs through the M2M junction in a single
    // query, bounded by `limit` regardless of project size. (Previously:
    // fetched every document_id for the project unbounded, then re-queried
    // with `.in("id", docIds)` — that in-list grows with project size and
    // eventually exceeds the client's ~16KB request-header budget, throwing
    // `UND_ERR_HEADERS_OVERFLOW` before the request reaches the server. Any
    // project past ~390-400 active documents hit this 100% of the time.)
    query = query.eq("cerefox_document_projects.project_id", projectId);
  }

  const { data, error } = await query;
  if (error) {
    throw systemError(`Could not list documents: ${error.message}`);
  }

  // The embedded `cerefox_document_projects` relation is only present to let
  // PostgREST filter on it server-side (`.eq()` above); it's not part of the
  // documented row shape, so drop it before returning/printing.
  const rows = ((data ?? []) as unknown[]).map((row) => {
    const { cerefox_document_projects: _junction, ...doc } = row as DocRow & {
      cerefox_document_projects?: unknown;
    };
    return doc as DocRow;
  });

  if (options.json) {
    printJson(rows);
    return;
  }

  if (rows.length === 0) {
    if (projectId) {
      process.stdout.write(`(no documents in project "${options.project}")\n`);
    } else {
      process.stdout.write(deleted ? "(trash is empty)\n" : "(no documents)\n");
    }
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
