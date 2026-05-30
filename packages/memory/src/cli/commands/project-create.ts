/**
 * `cerefox project create <name> [--description <text>]`
 *
 * Explicit project creation — parity with the web UI / `POST /api/v1/projects`.
 * (Ingesting with `--project-name` still creates a project implicitly; this is
 * the explicit path for creating an empty project up front.) Inserts a row into
 * `cerefox_projects`. Added in v0.9.1.
 */

import type { Command } from "commander";

import { c, println, systemError, userError } from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface CreateOptions {
  description?: string;
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

  println(c.green(`✓ Created project "${data.name}" (id: ${data.id}).`));
}

export function registerProjectCreate(parent: Command): void {
  parent
    .command("create")
    .description("Create a new (empty) project.")
    .argument("<name>", "Project name (must be unique).")
    .option("--description <text>", "Optional project description.")
    .action(action);
}
