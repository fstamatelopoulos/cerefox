import { apiFetch } from "./client";
import type { MetadataKeyInfo, Project } from "./types";

export async function fetchProjects(): Promise<Project[]> {
  return apiFetch<Project[]>("/projects");
}

export async function fetchMetadataKeys(): Promise<MetadataKeyInfo[]> {
  return apiFetch<MetadataKeyInfo[]>("/metadata-keys");
}

export async function createProject(
  name: string,
  description: string,
): Promise<Project> {
  return apiFetch<Project>("/projects", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

export async function updateProject(
  projectId: string,
  name: string,
  description: string,
): Promise<Project> {
  return apiFetch<Project>(`/projects/${projectId}`, {
    method: "PUT",
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteProject(
  projectId: string,
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/projects/${projectId}`, {
    method: "DELETE",
  });
}
