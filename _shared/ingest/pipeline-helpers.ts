/**
 * Cross-consumer helpers for the v0.7 TS ingestion pipeline.
 *
 * Consumers (all TS surfaces that need to dedup by content hash, mint a
 * source_path from a title, or resolve mixed project-id/name caller
 * styles into a final UUID list):
 *
 *   - `packages/memory/src/ingestion/pipeline.ts` (IngestionPipeline)
 *   - `packages/memory/src/web/routes/documents-write.ts` (v0.6 /edit
 *     content-hash short-circuit — promoted out of the inline version)
 *   - `packages/memory/src/cli/commands/ingest.ts` (v0.7 in-process)
 *
 * NOT consumed by `supabase/functions/cerefox-ingest/` (Deno Edge
 * Runtime can't reach `_shared/`; the EF keeps its own copies).
 * Cross-runtime parity is enforced by shared fixtures + manual smoke.
 *
 * Python parity: `normalizeForHash` + `contentHash` match `_normalize`
 * + `_hash` in `src/cerefox/ingestion/pipeline.py` exactly. Drift =
 * dedup breaks across the CLI / web / Python paths.
 */

import { createHash } from "node:crypto";

// ── Content normalization + hash ────────────────────────────────────────────

/**
 * Normalize content before hashing (mirrors Python's `_normalize`):
 *   1. CRLF → LF
 *   2. Bare CR → LF
 *   3. Strip leading/trailing whitespace
 *   4. Collapse 3+ consecutive newlines to 2
 *
 * Stable across round-trips through the web edit form (browsers submit
 * textarea content with CRLF per the HTML spec).
 */
export function normalizeForHash(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * SHA-256 hex digest of the normalized UTF-8-encoded text. Same
 * algorithm Python uses in `_hash`. Output is a 64-character lowercase
 * hex string.
 */
export function contentHash(text: string): string {
  return createHash("sha256")
    .update(normalizeForHash(text), "utf8")
    .digest("hex");
}

// ── source_path derivation from title ───────────────────────────────────────

/**
 * Derive a default `source_path` from a document title when none was
 * provided (e.g. paste ingestion). Matches Python's behaviour exactly:
 *
 *     slug = re.sub(r"[^\w\s-]", "", title.lower())
 *     slug = re.sub(r"[\s_-]+", "-", slug).strip("-") or "document"
 *     source_path = f"{slug}.md"
 *
 * Used for download filenames + Obsidian-style link resolution.
 */
export function deriveSourcePath(title: string): string {
  let slug = title.toLowerCase();
  // Python's `\w` matches [A-Za-z0-9_] PLUS Unicode word characters.
  // For Cerefox titles we accept ASCII + word + whitespace + hyphen;
  // anything else is stripped. JS doesn't have a one-line equivalent
  // that matches Python's Unicode-aware `\w`, but in practice Cerefox
  // titles are ASCII-dominant. Use `[^\p{L}\p{N}\s_-]` to be Unicode-
  // aware (matches Python more closely than `[^\w\s-]`).
  slug = slug.replace(/[^\p{L}\p{N}\s_-]/gu, "");
  slug = slug.replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) slug = "document";
  return `${slug}.md`;
}

// ── Project ID resolution ───────────────────────────────────────────────────

/**
 * Caller styles for project assignment. Mirror Python's
 * `_resolve_project_ids` precedence (highest wins):
 *
 *   1. `projectIds` (explicit UUID list) — used as-is, empties stripped.
 *   2. `projectNames` (explicit name list) — each name resolved via
 *      the caller's `getOrCreateProject` (so this helper stays pure).
 *   3. `projectId` (single UUID) — wrapped in a list.
 *   4. `projectName` (single name) — resolved and wrapped in a list.
 *
 * Tiers 1 and 2 carry **full-set semantics** (destructive replace when
 * passed to `assignDocumentProjects`) and tiers 3 and 4 carry
 * **single-hint semantics** (non-destructive add via
 * `addDocumentToProjects`). The caller chooses semantics by which
 * argument they pass; this helper just resolves the values.
 */
export interface ProjectResolveInput {
  projectIds?: string[] | null;
  projectId?: string | null;
  projectName?: string | null;
  projectNames?: string[] | null;
}

/**
 * Async because tiers 2 and 4 need to call `getOrCreateProject` against
 * the DB; the caller passes a thunk to keep this helper pure (no
 * Supabase client dependency).
 */
export async function resolveProjectIds(
  input: ProjectResolveInput,
  getOrCreateProject: (name: string) => Promise<{ id: string }>,
): Promise<string[]> {
  if (input.projectIds !== undefined && input.projectIds !== null) {
    return input.projectIds.filter((p) => p);
  }
  if (input.projectNames !== undefined && input.projectNames !== null) {
    const resolved: string[] = [];
    for (const name of input.projectNames) {
      if (!name) continue;
      const project = await getOrCreateProject(name);
      resolved.push(project.id);
    }
    return resolved;
  }
  if (input.projectId) {
    return [input.projectId];
  }
  if (input.projectName) {
    const project = await getOrCreateProject(input.projectName);
    return [project.id];
  }
  return [];
}
