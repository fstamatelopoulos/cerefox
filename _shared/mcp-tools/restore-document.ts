/**
 * `cerefox_restore_document` — bring a soft-deleted document back (#210).
 *
 * The counterpart to `cerefox_delete_document`, added by maintainer decision
 * (2026-08-13) reversing the earlier "restore is human-only" posture: every
 * restore is audited with author attribution, restoring cannot destroy
 * content, and CLI/MCP parity (`cerefox document restore` existed all along)
 * beats a boundary the audit surface had already outgrown.
 *
 * What still cannot happen from here: **permanent purge**, which remains
 * web-UI-only — the one action that actually destroys data keeps its
 * human-in-the-loop confirmation.
 *
 * No `expected_content_hash`, matching the CLI contract: a trashed document
 * cannot be rewritten while in the trash (cerefox_ingest_document refuses
 * updates to soft-deleted documents as of 0.12.0), so what was reviewed in
 * the trash is what comes back — there is no read-freshness to prove.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { isDocumentNotFoundError, isMissingFunctionError, logUsage } from "./_utils.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const document_id = args.document_id as string | undefined;
  const reason = args.reason as string | undefined;

  if (!document_id) throw new McpInvalidParams("document_id is required");

  const author = (args.author as string | undefined) ?? (args.requestor as string | undefined);
  // Derived from the transport, never taken from the caller: an agent must not
  // be able to record itself as a user. Matches the delete handler.
  const authorType = ctx.accessPath === "cli" ? "user" : "agent";

  const { data, error } = await supabase.rpc("cerefox_restore_document", {
    p_document_id: document_id,
    p_author: author ?? "unknown",
    p_author_type: authorType,
    p_reason: reason ?? null,
  });

  if (error) {
    const message = error.message ?? String(error);
    if (isMissingFunctionError(message, "cerefox_restore_document")) {
      throw new Error(
        `This server is behind: cerefox_restore_document needs schema 0.12.0 or newer. ` +
          `Run \`cerefox server deploy\`, then retry. (${message})`,
      );
    }
    if (isDocumentNotFoundError(error)) {
      throw new McpInvalidParams(`Document ${document_id} not found.`);
    }
    throw new Error(`RPC error: ${message}`);
  }

  const row = data as
    | {
        document_id?: string;
        title?: string;
        total_chars?: number;
        restored?: boolean;
        was_deleted?: boolean;
      }
    | undefined;
  if (!row) throw new Error("cerefox_restore_document returned no data");

  if (!row.restored) {
    // Report what happened, not what was asked for: the document was never in
    // the trash, nothing changed, no audit entry was written.
    return (
      `Document ${document_id} ("${row.title ?? "untitled"}") is NOT deleted — ` +
      `there is nothing to restore. No change was made.`
    );
  }

  logUsage(supabase, {
    operation: "restore",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    document_id,
    result_count: 1,
  });

  return (
    `Restored "${row.title ?? "untitled"}" (id: ${document_id}, ` +
    `${row.total_chars ?? "?"} chars) from the trash. It is searchable again ` +
    `and the restore is recorded in the audit log.\n` +
    `Tell your user what you restored and why.`
  );
}

export const restoreDocumentTool: ToolDefinition = {
  name: "cerefox_restore_document",
  description:
    "Restore a soft-deleted document from the trash — the inverse of cerefox_delete_document. The document becomes searchable again; the restore is recorded in the audit log with your identity. Restoring a document that is not deleted is a reported no-op. Pass a short reason — like a delete's reason, it is what the human reviewing the audit trail goes on. Permanent purge has no agent surface: once a human purges a document from the web UI, it is gone and cannot be restored.",
  annotations: {
    title: "Restore document from trash",
    readOnlyHint: false,
    // Recovery only: it can bring content back, never remove it.
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["document_id"],
    properties: {
      document_id: { type: "string", description: "UUID of the soft-deleted document to restore." },
      reason: {
        type: "string",
        description:
          "Why this document is being restored. Recorded in the audit-log entry. Short and specific beats long.",
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
