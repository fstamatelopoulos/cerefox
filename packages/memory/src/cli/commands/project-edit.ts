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
import { auditProjectOp } from "../../../../../_shared/mcp-tools/_projects.ts";
import type { MCPSupabaseClient } from "../../../../../_shared/mcp-tools/types.ts";
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
    .select("id, name, description")
    .eq(isUuid ? "id" : "name", target)
    .maybeSingle();

  if (lookupErr) throw systemError(`Lookup failed: ${lookupErr.message}`);
  if (!project) throw notFound(`Project "${target}" not found.`);

  const { data, error } = await client.raw
    .from("cerefox_projects")
    .update(update)
    .eq("id", project.id)
    .select("id, name, description")
    .maybeSingle();

  if (error || !data) {
    throw systemError(`Update failed: ${error?.message ?? "no row returned"}`);
  }

  // Compare against the fetched before-values: the trail must record what
  // actually changed, not which flags were passed (review round 1).
  const changes: string[] = [];
  if (update.name !== undefined && update.name !== project.name) {
    changes.push(`renamed '${project.name}' → '${update.name}'`);
  }
  const oldDescription = ((project as { description?: string | null }).description ?? "").trim();
  if (update.description !== undefined && update.description !== oldDescription) {
    changes.push("description changed");
  }
  await auditProjectOp(client.raw as unknown as MCPSupabaseClient, {
    operation: "project-edit",
    description: `Project '${data.name}' edited (${changes.join("; ") || "no-op"})`,
    author,
    authorType,
  });

  println(c.green(`✓ Updated project "${data.name}" (id: ${data.id}).`));
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
