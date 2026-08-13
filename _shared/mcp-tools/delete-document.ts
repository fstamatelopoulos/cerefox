/**
 * `cerefox_delete_document` — soft-delete a document over MCP (#208).
 *
 * Closes a parity gap, not a policy: the trust model (access-paths.md →
 * "Destructive operations and the trust model") always sanctioned agent
 * soft-delete — audited, recoverable from the web-UI trash — but the tool was
 * never built, so agents had no path where the CLI had `document delete`.
 *
 * The MCP surface REQUIRES `expected_content_hash` where the CLI requires an
 * interactive y/N: both are proof-of-intent, and an agent's proof is that it
 * READ the thing it is deleting. The CAS itself lives in the RPC under the
 * same FOR UPDATE lock as the ingest CAS — only the "required" is enforced
 * here, because it is an MCP-surface contract, not a data-integrity one
 * (the CLI legitimately deletes without a hash).
 *
 * Its inverse is `cerefox_restore_document` (#210, same release). What has no
 * agent surface is **permanent purge** — the one action that destroys data
 * keeps its web-UI human-in-the-loop confirmation.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { extractConflictHashes, isMissingFunctionError, logUsage } from "./_utils.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";

/** Agent-first instructions for a stale-hash conflict on delete. */
function conflictError(documentId: string, expectedHash: string, currentHash: string): Error {
  return new Error(
    `Conflict: document ${documentId} changed since you read it ` +
      `(your base hash: ${expectedHash}, current hash: ${currentHash}). ` +
      `Someone wrote to this document after you decided to delete it. ` +
      `To resolve: (1) cerefox_get_document("${documentId}") to see the current ` +
      `content, (2) check the deletion is still warranted — the new content may ` +
      `change your mind, (3) if it is, retry with expected_content_hash set to ` +
      `the new hash. Do not delete blindly — the change may be another writer's work.`,
  );
}

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const document_id = args.document_id as string | undefined;
  // Trimmed: a correct hash with a stray newline is not a stale one. The RPC
  // trims too; doing it here keeps the fast-fail message honest as well.
  const expected_content_hash = (args.expected_content_hash as string | undefined)?.trim();
  const reason = args.reason as string | undefined;

  if (!document_id) throw new McpInvalidParams("document_id is required");
  if (!expected_content_hash) {
    // The MCP analogue of the CLI's confirmation prompt: prove you read what
    // you are deleting. There is no last_write_wins here on purpose — a
    // delete with no evidence of a read has no legitimate agent use case.
    throw new McpInvalidParams(
      "expected_content_hash is required: the content_hash of the document as you read it " +
        "(returned by cerefox_get_document, cerefox_search, and cerefox_metadata_search). " +
        "If you have not read the document, read it first — deletion requires knowing what " +
        "you are deleting.",
    );
  }

  const author = (args.author as string | undefined) ?? (args.requestor as string | undefined);
  // Derived from the transport, never taken from the caller: an agent must not
  // be able to record itself as a user. Matches the partial-edit handlers.
  const authorType = ctx.accessPath === "cli" ? "user" : "agent";

  const { data, error } = await supabase.rpc("cerefox_delete_document", {
    p_document_id: document_id,
    p_author: author ?? "unknown",
    p_author_type: authorType,
    p_expected_content_hash: expected_content_hash,
    p_reason: reason ?? null,
  });

  if (error) {
    const message = error.message ?? String(error);
    if (message.includes("CEREFOX_CONFLICT")) {
      const { expected, current } = extractConflictHashes(message);
      throw conflictError(document_id, expected === "unknown" ? expected_content_hash : expected, current);
    }
    if (isMissingFunctionError(message, "cerefox_delete_document")) {
      throw new Error(
        `This server is behind: cerefox_delete_document needs schema 0.12.0 or newer. ` +
          `Run \`cerefox server deploy\`, then retry. (${message})`,
      );
    }
    if (message.includes("not found")) {
      throw new McpInvalidParams(`Document ${document_id} not found.`);
    }
    throw new Error(`RPC error: ${message}`);
  }

  const row = data as
    | {
        document_id?: string;
        title?: string;
        total_chars?: number;
        deleted_at?: string;
        already_deleted?: boolean;
      }
    | undefined;
  if (!row) throw new Error("cerefox_delete_document returned no data");

  if (row.already_deleted) {
    // Report what happened, not what was asked for: nothing was changed, the
    // original deletion time stands, and no new audit entry was written. No
    // usage-log entry either — the RPC's no-op design exists so counters and
    // the audit log cannot disagree, and logging "delete" here would recreate
    // exactly that disagreement in the analytics.
    return (
      `Document ${document_id} ("${row.title ?? "untitled"}") was ALREADY soft-deleted ` +
      `at ${row.deleted_at}. No change was made and no audit entry was written.`
    );
  }

  logUsage(supabase, {
    operation: "delete",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    document_id,
    result_count: 1,
  });

  return (
    `Soft-deleted "${row.title ?? "untitled"}" (id: ${document_id}, ` +
    `${row.total_chars ?? "?"} chars) at ${row.deleted_at}.\n` +
    `The document is excluded from search but fully recoverable: it sits in the ` +
    `trash until restored or purged. cerefox_restore_document undoes this if it ` +
    `was a mistake; permanent purge is human-only (web UI).\n` +
    `Tell your user what you deleted and why, so they can review it.`
  );
}

export const deleteDocumentTool: ToolDefinition = {
  name: "cerefox_delete_document",
  description:
    "SOFT-delete a document: it leaves search results and lands in the trash, recoverable until a human purges it. Requires expected_content_hash — the content_hash of the document AS YOU READ IT — so a delete always follows a read; if the document changed in between, the call fails with a conflict and you should re-read before deciding again. A mistaken delete can be undone with cerefox_restore_document; permanent purge is human-only (web UI). ALWAYS tell your user what you deleted and why. Pass a short reason — it is recorded in the audit log for the human reviewing the trash. Prefer this over ingesting empty/placeholder content when a document should go away.",
  annotations: {
    title: "Delete document (soft, recoverable)",
    readOnlyHint: false,
    // Static per tool (spec): a tool that can remove content from search is
    // destructive even though cerefox_restore_document can bring it back —
    // and once a human purges the trash, the removal is final.
    destructiveHint: true,
    // Re-deleting an already-deleted document changes nothing and says so.
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["document_id", "expected_content_hash"],
    properties: {
      document_id: { type: "string", description: "UUID of the document to soft-delete." },
      expected_content_hash: {
        type: "string",
        description:
          "The content_hash of the document as you read it (returned by cerefox_get_document, cerefox_search, and cerefox_metadata_search). Required: a delete must follow a read. A stale hash fails with a conflict — re-read, reconsider, retry with the new hash.",
      },
      reason: {
        type: "string",
        description:
          "Why this document is being deleted. Recorded in the audit log entry, where it is the main thing the human reviewing the trash has to go on. Short and specific beats long.",
      },
      author: {
        type: "string",
        description: "Who is making this change. Recorded in the audit log.",
      },
      requestor: {
        type: "string",
        description: "Name of the agent or user making this request. Recorded in the usage log.",
      },
    },
  },
  handler,
};
