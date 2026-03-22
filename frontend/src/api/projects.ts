import { apiFetch } from "./client";
import type { MetadataKeyInfo, Project } from "./types";

export async function fetchProjects(): Promise<Project[]> {
  return apiFetch<Project[]>("/projects");
}

export async function fetchMetadataKeys(): Promise<MetadataKeyInfo[]> {
  return apiFetch<MetadataKeyInfo[]>("/metadata-keys");
}
