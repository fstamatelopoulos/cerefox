/**
 * `cerefox version archive <version-id>` / `version unarchive <version-id>`
 *
 * Archive (or unarchive) a specific document version. Archived versions are
 * protected from the version-cleanup retention sweep. Mirrors the web UI's
 * version-archive action: flips `cerefox_document_versions.archived` and
 * writes an `archive` / `unarchive` audit entry. Added in v0.9.0 (folded
 * forward from the v0.9.1 plan). Version IDs come from `cerefox version list`.
 */

import type { Command } from "commander";

import {
  warn,
  c,
  notFound,
  println,
  resolveAuthor,
  resolveAuthorType,
  systemError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface ArchiveOptions {
  author?: string;
  authorType?: string;
}

async function setArchived(
  versionId: string,
  archived: boolean,
  options: ArchiveOptions,
): Promise<void> {
  const client = getClient();

  const { data, error } = await client.raw
    .from("cerefox_document_versions")
    .update({ archived })
    .eq("id", versionId)
    .select("document_id, version_number")
    .maybeSingle();

  if (error) throw systemError(`Update failed: ${error.message}`);
  if (!data) throw notFound(`Version ${versionId} not found.`);

  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  if (author === "unknown") {
    warn(
      "No --author / CEREFOX_AUTHOR_NAME set — audit log will record this write as 'unknown'.",
    );
  }
  const op = archived ? "archive" : "unarchive";

  await client.raw.rpc("cerefox_create_audit_entry", {
    p_document_id: data.document_id,
    p_version_id: versionId,
    p_operation: op,
    p_author: author,
    p_author_type: authorType,
    p_description: `Version ${data.version_number} ${op}d`,
  });

  println(c.green(`✓ Version ${data.version_number} (${versionId}) ${op}d.`));
}

export function registerVersionArchive(parent: Command): void {
  parent
    .command("archive")
    .description("Archive a document version (protect it from version cleanup).")
    .argument("<version-id>", "UUID of the version (from `cerefox version list`).")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .action((versionId: string, options: ArchiveOptions) => setArchived(versionId, true, options));

  parent
    .command("unarchive")
    .description("Unarchive a document version (allow version cleanup again).")
    .argument("<version-id>", "UUID of the version (from `cerefox version list`).")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .action((versionId: string, options: ArchiveOptions) => setArchived(versionId, false, options));
}
