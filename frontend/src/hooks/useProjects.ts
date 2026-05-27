import { useQuery } from "@tanstack/react-query";

import { fetchMetadataKeys, fetchProjects } from "../api/projects";

/** A project name is "system" if it starts with an underscore, by convention. */
export function isSystemProject(name: string): boolean {
  return name.startsWith("_");
}

interface UseProjectsOptions {
  /**
   * When `false` (default), system projects (`_cerefox-self-docs`,
   * `_e2e-*`, etc.) are filtered out. Pass `true` from
   * power-user / debugging surfaces that want the full list.
   *
   * v0.5 introduced this filter alongside the bundled self-doc ingest
   * (Layer 2 of MCP discoverability) so the agent guidance can live
   * in its own project without polluting the user's default listings.
   */
  includeSystem?: boolean;
}

export function useProjects(opts: UseProjectsOptions = {}) {
  const { includeSystem = false } = opts;
  return useQuery({
    queryKey: ["projects", includeSystem],
    queryFn: async () => {
      const projects = await fetchProjects();
      if (includeSystem) return projects;
      return projects.filter((p) => !isSystemProject(p.name));
    },
    staleTime: 60_000,
  });
}

export function useMetadataKeys() {
  return useQuery({
    queryKey: ["metadata-keys"],
    queryFn: fetchMetadataKeys,
    staleTime: 60_000,
  });
}
