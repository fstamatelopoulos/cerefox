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
  reason?: string;
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

  // p_reason lands in the audit description (schema 0.12.0, #210). Only pass
  // it when given, so the bare 3-arg call still matches the old function
  // signature against pre-0.12.0 servers.
  let result: { restored?: boolean } | null;
  try {
    result = await client.rpc("cerefox_restore_document", {
      p_document_id: documentId,
      p_author: author,
      p_author_type: authorType,
      ...(options.reason ? { p_reason: options.reason } : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.includes("Could not find the function")) {
      throw systemError(
        `This server is behind: \`--reason\` needs schema 0.12.0 or newer. ` +
          `Run \`cerefox server deploy\` and retry, or retry without --reason.`,
      );
    }
    throw e;
  }

  // The 0.12.0 RPC reports what happened; pre-0.12.0 returns void (null) and
  // gets the old unconditional message. If another writer restored it first
  // (restored: false), say so instead of claiming this call did it.
  if (result && result.restored === false) {
    println(
      c.dim(
        `Document ${documentId} ("${doc.title}") was already restored by the time this ran. No change was made.`,
      ),
    );
    return;
  }

  println(c.green(`✓ Restored "${doc.title}" (id: ${documentId}) from the trash.`));
  if (options.reason) {
    println(c.dim(`  Reason (recorded in the audit log): ${options.reason}`));
  }
}

export function registerDocumentRestore(parent: Command): void {
  parent
    .command("restore")
    .description("Restore a soft-deleted document from the trash (inverse of `document delete`).")
    .argument("<document-id>", "UUID of the soft-deleted document.")
    .option("--reason <text>", "Optional reason recorded in the audit log.")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .action(action);
}
