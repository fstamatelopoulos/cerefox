import { useQuery } from "@tanstack/react-query";

import { fetchMetadataKeys, fetchProjects } from "../api/projects";

export function useProjects() {
  return useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
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
