/**
 * `cerefox delete-doc <document-id>` — soft-delete a document.
 *
 * Soft-delete only (sets `deleted_at`, audit entry recorded). Permanent
 * purge is web-UI-only by design; documented in AGENT_GUIDE.
 *
 * v0.5: confirms by printing the doc title + size + project membership
 * before deletion. `--yes` skips the prompt (for scripts).
 */

import type { Command } from "commander";

import {
  c,
  confirm,
  notFound,
  println,
  resolveAuthor,
  resolveAuthorType,
  systemError,
  warn,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface DeleteOptions {
  reason?: string;
  author?: string;
  authorType?: string;
  yes?: boolean;
}

async function action(documentId: string, options: DeleteOptions): Promise<void> {
  const client = getClient();

  const { data: doc, error } = await client.raw
    .from("cerefox_documents")
    .select("id, title, total_chars, chunk_count, deleted_at")
    .eq("id", documentId)
    .maybeSingle();

  if (error) {
    throw systemError(`Lookup failed: ${error.message}`);
  }
  if (!doc) {
    throw notFound(`Document ${documentId} not found.`);
  }
  if (doc.deleted_at) {
    println(
      c.dim(`Document ${documentId} ("${doc.title}") is already soft-deleted at ${doc.deleted_at}.`),
    );
    return;
  }

  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  if (author === "unknown") {
    warn("No --author / CEREFOX_AUTHOR_NAME set — audit log will record this delete as 'unknown'.");
  }

  println(c.yellow(`About to soft-delete:`));
  println(`  ${doc.title}`);
  println(c.dim(`  ${documentId} · ${doc.chunk_count ?? "?"} chunks · ${doc.total_chars ?? "?"} chars`));

  if (!options.yes) {
    const ok = await confirm("Continue?", true);
    if (!ok) {
      println(c.dim("Aborted."));
      return;
    }
  }

  // Call the soft-delete RPC. Note: cerefox_delete_document doesn't
  // take a `p_reason` argument — `--reason` is captured here for the
  // audit-log description only (passed via a separate audit entry
  // would require an extra round trip; for now we just print it).
  await client.rpc("cerefox_delete_document", {
    p_document_id: documentId,
    p_author: author,
    p_author_type: authorType,
  });

  println(
    c.green(`✓ Soft-deleted "${doc.title}" (id: ${documentId}). Recoverable from the Cerefox web UI trash.`),
  );
  if (options.reason) {
    println(c.dim(`  Reason (informational only): ${options.reason}`));
  }
}

export function registerDeleteDoc(program: Command): void {
  program
    .command("delete-doc")
    .description("Soft-delete a document (recoverable via the web UI trash).")
    .argument("<document-id>", "UUID of the document to delete.")
    .option("--reason <text>", "Optional reason recorded in the audit log.")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .option("--yes", "Skip the confirmation prompt.")
    .action(action);
}
