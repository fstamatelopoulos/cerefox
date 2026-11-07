/**
 * Audit operation vocabulary — a dependency-free leaf module so the frontend
 * can import it through the `@cerefox/audit-ops` vite alias (same pattern as
 * `@cerefox/schemas`) without dragging server-side helpers into the bundle.
 * `_shared/mcp-tools/_utils.ts` re-exports everything here for Node/Deno
 * consumers; there is exactly ONE definition of each.
 */

/**
 * Store-level audit operations (0.14.0, #147) carry document_id NULL by
 * design. A NULL-document row that is NOT store-level means the document was
 * purged.
 */
export const STORE_LEVEL_AUDIT_OPS = [
  "config-change",
  "project-create",
  "project-edit",
  "project-delete",
  // 0.22.0: one entry per `server reindex` run (a single-document run carries
  // that document's id).
  "reindex",
] as const;

export function isStoreLevelAuditOp(operation: string | null | undefined): boolean {
  return (STORE_LEVEL_AUDIT_OPS as readonly string[]).includes(operation ?? "");
}

/** All audit operation values, in CHECK order — drives the CLI help, the MCP
 * tool description, and the web filter so a new operation cannot miss a
 * surface. */
export const AUDIT_OPERATIONS = [
  "create", "update-content", "update-metadata", "insert", "replace-section",
  "delete-section", "rename-section", "delete", "restore", "status-change",
  "archive", "unarchive", "relation-set", "relation-delete",
  // 0.22.0 (iteration 51): every content write is on the trail.
  "purge", "projects-change", "backup-restore", "version-prune",
  ...STORE_LEVEL_AUDIT_OPS,
] as const;

/** The document-column label for an audit row — title, short id, or the
 * NULL-document story: what a store-level op changed ("(setting)" for a config
 * change, "(project)" for a project op, "(store)" for any other), "(deleted)" for rows whose document
 * was purged. One implementation across MCP, CLI, and web. */
export function auditDocLabel(
  docTitle: string | null | undefined,
  documentId: string | null | undefined,
  operation: string | null | undefined,
): string {
  if (docTitle) return docTitle;
  if (documentId) return documentId.slice(0, 8) + "…";
  if (operation === "config-change") return "(setting)";
  if (operation?.startsWith("project-")) return "(project)";
  // A project restored from a backup carries no document.
  if (operation === "backup-restore") return "(project)";
  return isStoreLevelAuditOp(operation) ? "(store)" : "(deleted)";
}

/**
 * What a store-level entry changed, for a surface that shows a short "change"
 * per row (the web audit log). The RPCs write the change into the
 * description ("config: trash_auto_purge_enabled: 'false' → 'true'",
 * "Project 'x' created"); a config change drops its "config: " prefix, since
 * the row already says it is a setting. Null for document operations, which
 * show a size or a metadata change instead.
 */
export function storeChangeSummary(
  operation: string | null | undefined,
  description: string | null | undefined,
): string | null {
  // A membership change also names what changed in its description
  // ("Added to projects [A]; Removed from projects [B]", 0.22.0).
  if (!isStoreLevelAuditOp(operation) && operation !== "projects-change") return null;
  const d = (description ?? "").trim();
  if (!d) return null;
  return operation === "config-change" ? d.replace(/^config:\s*/, "") : d;
}

/**
 * One line describing a metadata change (#333): the keys set (with their new
 * values) and the keys removed. Built from an `update-metadata` audit entry's
 * metadata_before / metadata_after; null when the entry carries neither (older
 * entries, other operations) or nothing actually changed.
 */
export function metadataChangeSummary(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string | null {
  if (before == null && after == null) return null;
  const b = before ?? {};
  const a = after ?? {};
  const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
  const set = Object.keys(a)
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => `${k}=${show(a[k])}`);
  // Own keys only: `in` also finds inherited ones, so removing a key named
  // like an Object.prototype member ("constructor") went unreported.
  const removed = Object.keys(b).filter((k) => !Object.hasOwn(a, k));
  if (set.length === 0 && removed.length === 0) return null;
  const parts: string[] = [];
  if (set.length) parts.push(`set ${set.join(", ")}`);
  if (removed.length) parts.push(`removed ${removed.join(", ")}`);
  return parts.join("; ");
}
