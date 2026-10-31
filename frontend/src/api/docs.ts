/**
 * Client for the bundled-docs API surface — `/api/v1/docs` and
 * `/api/v1/schema-version`. Consumed by the Help page and the
 * schema-mismatch banner.
 */

import { apiRequest } from "./client";

export interface DocEntry {
  path: string;
  title: string;
  category: string;
}

export async function fetchDocsIndex(): Promise<DocEntry[]> {
  const response = await apiRequest("/docs");
  if (!response.ok) {
    throw new Error(`Failed to load docs index: ${response.status}`);
  }
  return response.json();
}

export async function fetchDocContent(path: string): Promise<string> {
  const response = await apiRequest(
    `/docs/${path.split("/").map(encodeURIComponent).join("/")}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to load doc '${path}': ${response.status}`);
  }
  return response.text();
}

export type SchemaCompatLevel =
  | "ok"
  | "above-min-but-old"
  | "below-min"
  | "unknown";

export interface SchemaVersionInfo {
  bundled: string | null;
  deployed: string | null;
  mismatch: boolean;
  /** iter-26 Part 26C two-tier compat level (may be absent on older servers). */
  level?: SchemaCompatLevel;
  /** Minimum schema version this client requires (may be absent on older servers). */
  min?: string;
}

export async function fetchSchemaVersion(): Promise<SchemaVersionInfo> {
  const response = await apiRequest("/schema-version");
  if (!response.ok) {
    throw new Error(`Failed to load schema version: ${response.status}`);
  }
  return response.json();
}
