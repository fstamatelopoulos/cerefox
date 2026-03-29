// ── cerefox_list_projects tool handler ────────────────────────────────────
//
// Calls the cerefox_list_projects RPC directly. Returns all projects with
// their names, IDs, and descriptions for agent discovery.

import { makeSupabaseClient, logUsage } from "../shared.ts";

export async function handleListProjects(args: Record<string, unknown> = {}): Promise<string> {
  const supabase = makeSupabaseClient();

  const { data, error } = await supabase.rpc("cerefox_list_projects");

  if (error) {
    throw new Error(`RPC error: ${error.message}`);
  }

  const projects = (data ?? []) as Array<{
    id: string;
    name: string;
    description: string | null;
  }>;

  logUsage(supabase, { operation: "list_projects", requestor: args.requestor as string | undefined, result_count: projects.length });

  if (projects.length === 0) {
    return "No projects found.";
  }

  const lines = projects.map((p) => {
    const desc = p.description ? ` -- ${p.description}` : "";
    return `- ${p.name} (id: ${p.id})${desc}`;
  });

  return `Projects (${projects.length}):\n\n${lines.join("\n")}`;
}
