/**
 * `cerefox delete-project <name-or-id>` — hard-delete an empty project.
 *
 * Symmetric to `cerefox list-projects`. Looks up by UUID or name. Refuses
 * if the project still has documents unless `--force` is passed; in that
 * case the document↔project links break but the documents themselves are
 * untouched (only the row in `cerefox_projects` is removed). Use the
 * soft-delete workflow for documents.
 *
 * Primary use cases:
 *   - User-facing cleanup of stray projects (the Projects page in the web
 *     UI exposes the same operation).
 *   - Test-harness cleanup: write-commands.test.ts removes the
 *     `_e2e-v0.5` project in its afterAll hook.
 */

import type { Command } from "commander";

import {
  c,
  confirm,
  notFound,
  println,
  resolveAuthor,
  resolveAuthorType,
  systemError,
  userError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface DeleteProjectOptions {
  yes?: boolean;
  force?: boolean;
  author?: string;
  authorType?: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
}

async function action(target: string, options: DeleteProjectOptions): Promise<void> {
  const client = getClient();
  // Resolve identity BEFORE any write: an invalid --author-type must abort
  // while nothing has happened, not after the destructive delete committed
  // (review round 2).
  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  const isUuid = UUID_RE.test(target);

  const lookup = isUuid
    ? client.raw.from("cerefox_projects").select("id, name, description").eq("id", target).maybeSingle()
    : client.raw.from("cerefox_projects").select("id, name, description").eq("name", target).maybeSingle();

  const { data: project, error } = (await lookup) as {
    data: ProjectRow | null;
    error: { message: string } | null;
  };

  if (error) {
    throw systemError(`Project lookup failed: ${error.message}`);
  }
  if (!project) {
    throw notFound(`Project "${target}" not found.`);
  }

  const { count, error: countErr } = await client.raw
    .from("cerefox_document_projects")
    .select("*", { count: "exact", head: true })
    .eq("project_id", project.id);

  if (countErr) {
    throw systemError(`Could not count documents in project: ${countErr.message}`);
  }

  const docCount = count ?? 0;
  if (docCount > 0 && !options.force) {
    throw userError(
      `Project "${project.name}" still has ${docCount} document link(s).`,
      "Pass --force to delete the project anyway (documents remain; only the project row is removed).",
    );
  }

  println(c.yellow("About to delete project:"));
  println(`  ${project.name}`);
  println(c.dim(`  ${project.id} · ${docCount} doc link(s)`));

  if (!options.yes) {
    const ok = await confirm("Continue?", true);
    if (!ok) {
      println(c.dim("Aborted."));
      return;
    }
  }

  // The RPC deletes and audits in one transaction, and audits ONLY when a
  // row was actually removed (#219) — a concurrent deletion cannot fabricate
  // an audit entry.
  const { data: delData, error: delErr } = await client.raw.rpc("cerefox_delete_project", {
    p_project_id: project.id,
    p_author: author,
    p_author_type: authorType,
  });

  if (delErr) {
    throw systemError(`Delete failed: ${delErr.message}`);
  }
  const delRow = (delData as Array<{ deleted: boolean }> | null)?.[0];
  if (!delRow?.deleted) {
    throw notFound(`Project "${project.name}" was already deleted (concurrently).`);
  }

  println(c.green(`✓ Deleted project "${project.name}" (id: ${project.id}).`));
}

export function registerDeleteProject(program: Command): void {
  program
    .command("delete-project")
    .description("Delete an empty project (use --force to remove a non-empty one).")
    .argument("<name-or-id>", "Project name (exact match) or UUID.")
    .option("--yes", "Skip the confirmation prompt.")
    .option("--force", "Allow deletion when documents are still linked to the project.")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "user | agent (default: user).")
    .action(action);
}
