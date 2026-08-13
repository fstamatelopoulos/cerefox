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
import { isMissingFunctionError } from "../../../../../_shared/mcp-tools/_utils.ts";
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

  // p_reason lands in the audit description (schema 0.12.0, #208). Only pass
  // it when given: the bare 3-arg call still matches the old function
  // signature, so plain `document delete` keeps working against pre-0.12.0
  // servers — `--reason` is the only part that needs the newer schema.
  let result: { already_deleted?: boolean; deleted_at?: string } | null;
  try {
    result = await client.rpc("cerefox_delete_document", {
      p_document_id: documentId,
      p_author: author,
      p_author_type: authorType,
      ...(options.reason ? { p_reason: options.reason } : {}),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingFunctionError(message, "cerefox_delete_document")) {
      // Only blame --reason when it was actually passed — a bare delete can
      // hit the same window during a deploy's DROP/CREATE.
      throw systemError(
        options.reason
          ? `This server is behind: \`--reason\` needs schema 0.12.0 or newer. ` +
              `Run \`cerefox server deploy\` and retry, or retry without --reason.`
          : `The delete did not run: the server has no matching cerefox_delete_document ` +
              `(mid-deploy window, or an old schema). Run \`cerefox server deploy\` and retry.`,
      );
    }
    throw e;
  }

  if (result === null) {
    // The shared rpc() wrapper maps Postgres 42883 ("function does not
    // exist") to a null return — and a pre-0.12.0 server's VOID delete ALSO
    // comes back null, so success and swallowed-failure are indistinguishable
    // here. One cheap read settles which one happened before claiming either.
    const { data: check } = await client.raw
      .from("cerefox_documents")
      .select("deleted_at")
      .eq("id", documentId)
      .maybeSingle();
    if (!check?.deleted_at) {
      throw systemError(
        `The delete did not take effect — the server has no matching ` +
          `cerefox_delete_document (mid-deploy window, or an old schema). ` +
          `Run \`cerefox server deploy\` and retry.`,
      );
    }
  }

  // The 0.12.0 RPC reports what actually happened; report the same. The y/N
  // prompt can sit open long enough for another writer to delete this document
  // first — claiming success (and a recorded reason) then would be false.
  // Pre-0.12.0 servers return void; treat that as the old unconditional path.
  if (result?.already_deleted) {
    println(
      c.dim(
        `Document ${documentId} ("${doc.title}") was already soft-deleted at ${result.deleted_at} ` +
          `by the time the delete ran. No change was made and no reason was recorded.`,
      ),
    );
    return;
  }

  println(
    c.green(`✓ Soft-deleted "${doc.title}" (id: ${documentId}). Recoverable from the Cerefox web UI trash.`),
  );
  if (options.reason) {
    println(c.dim(`  Reason (recorded in the audit log): ${options.reason}`));
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
