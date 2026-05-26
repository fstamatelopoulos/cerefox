/**
 * `cerefox_list_projects` — list all projects so agents can discover names
 * before filtering by `project_name` in other tools.
 *
 * Calls `cerefox_list_projects` RPC. Trivial; usage logged.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { logUsage } from "./_utils.js";
import type { ToolContext, ToolDefinition } from "./types.js";

async function handler(
  supabase: SupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const { data, error } = await supabase.rpc("cerefox_list_projects");

  if (error) throw new Error(`RPC error: ${error.message}`);

  const projects = (data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
  }>;

  logUsage(supabase, {
    operation: "list_projects",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    result_count: projects.length,
  });

  if (projects.length === 0) return "No projects found.";

  const lines = projects.map((p) => {
    const desc = p.description ? ` -- ${p.description}` : "";
    return `- ${p.name} (id: ${p.id})${desc}`;
  });
  return `Projects (${projects.length}):\n\n${lines.join("\n")}`;
}

export const listProjectsTool: ToolDefinition = {
  name: "cerefox_list_projects",
  description:
    "List all projects with their names and IDs. Use this to discover available projects before filtering by project_name in other tools.",
  inputSchema: {
    type: "object",
    properties: {
      requestor: {
        type: "string",
        description:
          'Name of the agent or user making this request. Recorded in the usage log. Defaults to "mcp-agent" if not provided. May be enforced via server config.',
      },
    },
  },
  handler,
};
