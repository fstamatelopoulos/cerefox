/**
 * `cerefox list-projects` — list all projects with names + IDs.
 *
 * Direct PostgREST query against `cerefox_projects`. No embedding; works
 * offline against any reachable Supabase instance.
 */

import type { Command } from "commander";

import {
  printJson,
  printTable,
  resolveRequestor,
  systemError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";
import { authorOption, requestorAliasOption } from "../util/identity-flags.js";

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  created_at?: string;
}

async function action(options: { author?: string; requestor?: string; json?: boolean }): Promise<void> {
  const client = getClient();
  const { data, error } = await client.raw
    .from("cerefox_projects")
    .select("id, name, description, created_at")
    .order("name", { ascending: true });

  if (error) {
    throw systemError(
      `Could not list projects: ${error.message}`,
      "Verify CEREFOX_SUPABASE_KEY has read access to cerefox_projects.",
    );
  }

  // Best-effort usage log (don't block on it).
  const requestor = resolveRequestor(options.author ?? options.requestor);
  client.raw
    .rpc("cerefox_log_usage", {
      p_operation: "list_projects",
      p_access_path: "cli",
      p_requestor: requestor,
    })
    .then(() => {}, () => {});

  const rows = (data ?? []) as ProjectRow[];

  if (options.json) {
    printJson(rows);
    return;
  }

  if (rows.length === 0) {
    process.stdout.write("(no projects)\n");
    return;
  }

  printTable(
    rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: (p.description ?? "").slice(0, 60),
    })),
    "(no projects)",
  );
}

export function registerListProjects(program: Command): void {
  program
    .command("list-projects")
    .description("List all projects in the knowledge base.")
    .addOption(authorOption("read"))
    .addOption(requestorAliasOption())
    .option("--json", "Emit machine-readable JSON.")
    .action(action);
}
