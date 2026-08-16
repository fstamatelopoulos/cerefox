/**
 * `cerefox project create <name> [--description <text>]`
 *
 * Explicit project creation — parity with the web UI / `POST /api/v1/projects`.
 * (Ingesting with `--project-name` still creates a project implicitly; this is
 * the explicit path for creating an empty project up front.) Inserts a row into
 * `cerefox_projects`. Added in v0.9.1.
 */

import type { Command } from "commander";

import {
  c,
  println,
  resolveAuthor,
  resolveAuthorType,
  systemError,
  userError,
} from "../../../../../_shared/cli-core/index.ts";
import { auditProjectOp } from "../../../../../_shared/mcp-tools/_projects.ts";
import type { MCPSupabaseClient } from "../../../../../_shared/mcp-tools/types.ts";
import { getClient } from "../util/client.ts";

interface CreateOptions {
  description?: string;
  author?: string;
  authorType?: string;
}

async function action(name: string, options: CreateOptions): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw userError("Project name is required.");

  const client = getClient();
  const { data, error } = await client.raw
    .from("cerefox_projects")
    .insert({ name: trimmed, description: (options.description ?? "").trim() })
    .select("id, name, description")
    .maybeSingle();

  if (error || !data) {
    throw systemError(`Create failed: ${error?.message ?? "no row returned"}`);
  }

  await auditProjectOp(client.raw as unknown as MCPSupabaseClient, {
    operation: "project-create",
    description: `Project '${data.name}' created`,
    author: resolveAuthor(options.author),
    authorType: resolveAuthorType(options.authorType),
  });

  println(c.green(`✓ Created project "${data.name}" (id: ${data.id}).`));
}

export function registerProjectCreate(parent: Command): void {
  parent
    .command("create")
    .description("Create a new (empty) project.")
    .argument("<name>", "Project name (must be unique).")
    .option("--description <text>", "Optional project description.")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "user | agent (default: user).")
    .action(action);
}
