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
  // Resolve identity BEFORE the write: an invalid --author-type must abort
  // while nothing has happened (review round 2).
  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  // The RPC inserts AND audits in one transaction (#219).
  const { data, error } = await client.raw.rpc("cerefox_create_project", {
    p_name: trimmed,
    p_description: (options.description ?? "").trim(),
    p_author: author,
    p_author_type: authorType,
  });

  if (error) {
    if (/duplicate key|unique/i.test(error.message ?? "")) {
      throw userError(`Project "${trimmed}" already exists.`);
    }
    throw systemError(`Create failed: ${error.message}`);
  }
  const row = (data as Array<{ project_id: string; project_name: string }> | null)?.[0];
  if (!row) throw systemError("Create failed: no row returned");

  println(c.green(`✓ Created project "${row.project_name}" (id: ${row.project_id}).`));
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
