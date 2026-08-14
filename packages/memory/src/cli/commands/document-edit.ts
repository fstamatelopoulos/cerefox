/**
 * `cerefox document edit <id> [--title] [--set-meta k=v]... [--unset-meta k]...`
 *
 * Non-destructive title + metadata edit (mirrors Clio's `docs edit`). Unlike
 * `document ingest --update` — which REPLACES the whole metadata object, so
 * omitting `--metadata` wipes existing tags — this fetches the current
 * metadata and PATCHES it: `--set-meta` adds/overwrites individual keys,
 * `--unset-meta` removes them, everything else is preserved.
 *
 * Content edits stay on `cerefox document ingest --document-id <id> --update`
 * (re-chunk + re-embed). A `--title` change here refreshes the FTS index
 * (title boosting); the semantic embeddings pick up the new title on the next
 * `cerefox server reindex`. Added in v0.9.1.
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
  userError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface EditOptions {
  title?: string;
  setMeta?: string[];
  unsetMeta?: string[];
  author?: string;
  authorType?: string;
}

/** Parse a `key=value` pair; value is JSON-parsed when possible (numbers,
 *  booleans, arrays/objects), else kept as a raw string. */
function parseMetaPair(pair: string): [string, unknown] {
  const eq = pair.indexOf("=");
  if (eq <= 0) throw userError(`--set-meta expects key=value, got "${pair}".`);
  const key = pair.slice(0, eq).trim();
  const raw = pair.slice(eq + 1);
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  return [key, value];
}

async function action(documentId: string, options: EditOptions): Promise<void> {
  const hasTitle = options.title !== undefined;
  const sets = options.setMeta ?? [];
  const unsets = options.unsetMeta ?? [];
  if (!hasTitle && sets.length === 0 && unsets.length === 0) {
    throw userError("Nothing to edit — pass --title and/or --set-meta / --unset-meta.");
  }
  if (hasTitle && !options.title!.trim()) throw userError("--title cannot be empty.");

  const client = getClient();
  const { data: doc, error } = await client.raw
    .from("cerefox_documents")
    .select("id, title, metadata, deleted_at")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw systemError(`Lookup failed: ${error.message}`);
  if (!doc) throw notFound(`Document ${documentId} not found.`);
  if (doc.deleted_at) {
    throw userError(`Document ${documentId} is soft-deleted — restore it first (cerefox document restore).`);
  }

  const metaTouched = sets.length > 0 || unsets.length > 0;
  const newTitle = hasTitle ? options.title!.trim() : (doc.title as string);
  const titleChanged = newTitle !== doc.title;

  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  if (author === "unknown") {
    warn(
      "No --author / CEREFOX_AUTHOR_NAME set — audit log will record this write as 'unknown'.",
    );
  }

  // Metadata goes through cerefox_set_document_metadata (#212 round-5 review):
  // the RPC merges atomically under a row lock, refuses to merge onto a
  // corrupt (non-object) stored value with the repair named, and writes its
  // own audit entry — one implementation instead of a client-side re-derive
  // that bypassed the guards and the audit trail. `--unset-meta k` is the
  // RPC's JSON-null removal; a literal `--set-meta k=null` therefore also
  // removes (storing JSON null was never distinguishable downstream anyway).
  if (metaTouched) {
    const patch: Record<string, unknown> = {};
    for (const pair of sets) {
      const [k, v] = parseMetaPair(pair);
      patch[k] = v;
    }
    for (const k of unsets) patch[k.trim()] = null;
    const { error: metaErr } = await client.raw.rpc("cerefox_set_document_metadata", {
      p_document_id: documentId,
      p_metadata: patch,
      p_replace: false,
      p_author: author,
      p_author_type: authorType,
    });
    if (metaErr) {
      if (metaErr.message?.includes("CEREFOX_BAD_METADATA")) {
        throw userError(
          `Document ${documentId} has non-object metadata; a patch cannot repair it. ` +
            `Repair it first with: cerefox document set-metadata ${documentId} --replace --json '<the intended object>'`,
        );
      }
      throw systemError(`Metadata update failed: ${metaErr.message}`);
    }
  }

  // Title-only table write: metadata is never included, so a title edit
  // cannot touch (let alone destroy) the stored value (#212).
  if (hasTitle) {
    const { error: updErr } = await client.raw
      .from("cerefox_documents")
      .update({ title: newTitle, updated_at: new Date().toISOString() })
      .eq("id", documentId);
    if (updErr) throw systemError(`Update failed: ${updErr.message}`);
  }

  // Title boosting: refresh the FTS vector so search reflects the new title.
  if (titleChanged) {
    const { error: ftsErr } = await client.raw.rpc("cerefox_update_chunk_fts", {
      p_document_id: documentId,
      p_new_title: newTitle,
    });
    if (ftsErr) throw systemError(`Title updated but FTS refresh failed: ${ftsErr.message}`);
  }

  // Metadata edits are audit-logged by the RPC above; a title change gets
  // its own entry here (there is no title-editing RPC).
  if (titleChanged) {
    await client.raw.rpc("cerefox_create_audit_entry", {
      p_document_id: documentId,
      p_operation: "update-metadata",
      p_author: author,
      p_author_type: authorType,
      p_description: "Edited title",
    });
  }

  println(c.green(`✓ Edited "${newTitle}" (id: ${documentId}).`));
  if (titleChanged) {
    println(c.dim("  Title changed: FTS refreshed; semantic embeddings update on next `cerefox server reindex`."));
  }
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

export function registerDocumentEdit(parent: Command): void {
  parent
    .command("edit")
    .description("Edit a document's title and/or metadata (non-destructive patch). Content edits: `document ingest --document-id <id> --update`.")
    .argument("<document-id>", "UUID of the document.")
    .option("--title <title>", "New title (refreshes FTS; re-embed on next reindex).")
    .option("--set-meta <key=value>", "Set/overwrite a metadata key (repeatable). Value is JSON-parsed when possible.", collect, [])
    .option("--unset-meta <key>", "Remove a metadata key (repeatable).", collect, [])
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .action(action);
}
