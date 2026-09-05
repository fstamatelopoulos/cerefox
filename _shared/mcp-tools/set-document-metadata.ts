/**
 * `cerefox_set_document_metadata` — change a document's tags without touching
 * its content (#204).
 *
 * Until this existed, `cerefox_ingest` was the only way to set a tag and it
 * requires title + content, so changing one key meant resending the whole
 * document — reproducing every untouched character, including IDs and tables.
 * That is precisely the transcription risk the partial-edit tools were built to
 * remove, still fully present for metadata. Project membership had a
 * metadata-only writer (`cerefox_set_document_projects`) all along; tags never
 * got one.
 *
 * The composition lives in the RPC rather than here, because the merge has to
 * be atomic: several agent roles write to the same documents, and a read →
 * merge → write done client-side would let two agents setting different keys
 * clobber each other. `cerefox_set_document_metadata` merges inside one UPDATE
 * against a locked row.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { logUsage } from "./_utils.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";
import { AUTHOR_PARAM_WRITE, DEFAULT_IDENTITY, callerIdentity } from "./identity.ts";

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const document_id = args.document_id as string | undefined;
  const metadata = args.metadata as Record<string, unknown> | undefined;
  const replace = (args.replace as boolean | undefined) ?? false;

  if (!document_id) throw new McpInvalidParams("document_id is required");
  if (metadata === undefined || metadata === null) {
    throw new McpInvalidParams(
      "metadata is required: an object of keys to set. Use null as a value to REMOVE a key.",
    );
  }
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new McpInvalidParams("metadata must be an object, not an array or scalar");
  }
  if (Object.keys(metadata).length === 0 && !replace) {
    // An empty merge is a no-op, and a caller who wanted "clear everything"
    // meant `replace: true`. Refusing beats silently doing nothing.
    throw new McpInvalidParams(
      "metadata is empty, which would change nothing. To clear all metadata pass replace: true with {}.",
    );
  }

  const author = callerIdentity(args);
  // Derived from the transport, never taken from the caller: an agent must not
  // be able to record itself as a user. Matches the partial-edit handlers.
  const authorType = ctx.accessPath === "cli" ? "user" : "agent";

  const { data, error } = await supabase.rpc("cerefox_set_document_metadata", {
    p_document_id: document_id,
    p_metadata: metadata,
    p_replace: replace,
    p_author: author ?? "unknown",
    p_author_type: authorType,
  });

  if (error) throw new Error(`RPC error: ${error.message}`);

  const row = data?.[0] as
    | { document_id?: string; metadata?: Record<string, unknown>; keys_set?: number; keys_removed?: number }
    | undefined;
  if (!row) throw new Error("cerefox_set_document_metadata returned no data");

  logUsage(supabase, {
    operation: "update_metadata",
    accessPath: ctx.accessPath,
    requestor: author,
    document_id,
    result_count: 1,
  });

  const set = row.keys_set ?? 0;
  const removed = row.keys_removed ?? 0;
  // Report what CHANGED, not what was asked for. Setting a key to the value it
  // already held is a no-op, and saying so beats implying work happened.
  const summary =
    set === 0 && removed === 0
      ? "No change: every key already held that value."
      : `${set} key(s) set, ${removed} removed.`;

  return (
    `Metadata ${replace ? "replaced" : "merged"} on ${document_id}. ${summary}\n` +
    `Now: ${JSON.stringify(row.metadata ?? {})}\n` +
    `Content untouched — no new version, no re-embedding.`
  );
}

export const setDocumentMetadataTool: ToolDefinition = {
  name: "cerefox_set_document_metadata",
  description:
    "Change a document's metadata WITHOUT resending its content. MERGES by default: the keys you pass are set, every other key is left alone — so you do not need to read the document first, and you cannot accidentally drop tags another agent set. To REMOVE a key, pass it with a null value ({\"stale_key\": null}). Pass replace: true to set the metadata to exactly the object given, discarding everything else (rare; the same destructive contract as cerefox_set_document_projects). Content, chunks and embeddings are untouched and no new version is created. Use this instead of cerefox_ingest whenever only the tags are changing.",
  annotations: {
    title: "Set document metadata",
    readOnlyHint: false,
    // Merge cannot lose a key you did not name; `replace: true` can.
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["document_id", "metadata"],
    properties: {
      document_id: { type: "string", description: "UUID of the document to tag." },
      metadata: {
        type: "object",
        description:
          "Keys to set. Values are JSON strings by convention (a metadata_filter matches JSONB as strings, so a boolean true will not match \"true\"). A null value REMOVES that key. Keys you do not mention are left alone unless replace is true.",
      },
      replace: {
        type: "boolean",
        description:
          "Set the metadata to EXACTLY this object, discarding any key not listed. Defaults to false (merge). Use only when you mean to reset a document's tags wholesale.",
      },
      author: AUTHOR_PARAM_WRITE,
    },
  },
  handler,
};
