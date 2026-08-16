/**
 * `cerefox project edit <name-or-id> [--name <new>] [--description <text>]`
 *
 * Rename a project and/or change its description — parity with the web UI /
 * `PUT /api/v1/projects/{id}`. Looks up by UUID or exact name. Only the fields
 * you pass are changed. Added in v0.9.1.
 */

import type { Command } from "commander";

import {
  c,
  notFound,
  println,
  resolveAuthor,
  resolveAuthorType,
  systemError,
  userError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EditOptions {
  name?: string;
  description?: string;
  author?: string;
  authorType?: string;
}

async function action(target: string, options: EditOptions): Promise<void> {
  const update: { name?: string; description?: string } = {};
  if (options.name !== undefined) {
    const n = options.name.trim();
    if (!n) throw userError("--name cannot be empty.");
    update.name = n;
  }
  if (options.description !== undefined) update.description = options.description.trim();
  if (Object.keys(update).length === 0) {
    throw userError("Nothing to update — pass --name and/or --description.");
  }

  const client = getClient();
  // Resolve identity BEFORE the write (review round 2).
  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  const isUuid = UUID_RE.test(target);
  const { data: project, error: lookupErr } = await client.raw
    .from("cerefox_projects")
    .select("id, name")
    .eq(isUuid ? "id" : "name", target)
    .maybeSingle();

  if (lookupErr) throw systemError(`Lookup failed: ${lookupErr.message}`);
  if (!project) throw notFound(`Project "${target}" not found.`);

  // The RPC updates only the provided fields, diffs against the stored row,
  // and audits in the same transaction (#219).
  const { data, error } = await client.raw.rpc("cerefox_update_project", {
    p_project_id: project.id,
    p_name: update.name ?? null,
    p_description: update.description ?? null,
    p_author: author,
    p_author_type: authorType,
  });

  if (error) throw systemError(`Update failed: ${error.message}`);
  const row = (data as Array<{ project_id: string; project_name: string }> | null)?.[0];
  if (!row) throw systemError("Update failed: no row returned");

  println(c.green(`✓ Updated project "${row.project_name}" (id: ${row.project_id}).`));
}

export function registerProjectEdit(parent: Command): void {
  parent
    .command("edit")
    .description("Rename a project and/or change its description.")
    .argument("<name-or-id>", "Project name (exact match) or UUID.")
    .option("--name <new-name>", "New project name.")
    .option("--description <text>", "New project description.")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "user | agent (default: user).")
    .action(action);
}
