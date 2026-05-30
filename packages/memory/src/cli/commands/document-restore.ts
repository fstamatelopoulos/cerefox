/**
 * `cerefox document restore <document-id>` — un-soft-delete a document.
 *
 * Inverse of `cerefox document delete`. Calls `cerefox_restore_document`
 * (clears `deleted_at`, writes a `restore` audit entry). No-op if the
 * document isn't soft-deleted. Added in v0.9.0 (folded forward from the
 * v0.9.1 plan) to close the web Trash→restore parity gap. Permanent purge
 * stays web-UI-only by design.
 */

import type { Command } from "commander";

import {
  c,
  notFound,
  println,
  resolveAuthor,
  resolveAuthorType,
  systemError,
  warn,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface RestoreOptions {
  author?: string;
  authorType?: string;
}

async function action(documentId: string, options: RestoreOptions): Promise<void> {
  const client = getClient();

  const { data: doc, error } = await client.raw
    .from("cerefox_documents")
    .select("id, title, deleted_at")
    .eq("id", documentId)
    .maybeSingle();

  if (error) throw systemError(`Lookup failed: ${error.message}`);
  if (!doc) throw notFound(`Document ${documentId} not found.`);
  if (!doc.deleted_at) {
    println(c.dim(`Document ${documentId} ("${doc.title}") is not soft-deleted — nothing to restore.`));
    return;
  }

  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  if (author === "unknown") {
    warn("No --author / CEREFOX_AUTHOR_NAME set — audit log will record this restore as 'unknown'.");
  }

  await client.rpc("cerefox_restore_document", {
    p_document_id: documentId,
    p_author: author,
    p_author_type: authorType,
  });

  println(c.green(`✓ Restored "${doc.title}" (id: ${documentId}) from the trash.`));
}

export function registerDocumentRestore(parent: Command): void {
  parent
    .command("restore")
    .description("Restore a soft-deleted document from the trash (inverse of `document delete`).")
    .argument("<document-id>", "UUID of the soft-deleted document.")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .action(action);
}
