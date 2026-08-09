/**
 * `cerefox_insert` and `cerefox_edit` — partial document edits (iteration 34).
 *
 * Spec: docs/specs/partial-document-edits-design.md (frozen).
 * Technical design: docs/specs/partial-edits-technical-design.md §3.
 *
 * Both tools share one flow, so the additive tool cannot drift from the batch's
 * insert semantics:
 *
 *   read → apply (pure, _shared/partial-edits) → chunk → embed → ingest RPC
 *
 * The agent sends what changed; the server assembles the result. The document
 * body never enters the agent's context on the way in *or* out — that is the
 * whole point, and it is why the response carries the new hash and size rather
 * than the document (spec §3.8).
 *
 * Two tools rather than one because MCP annotations are per-tool: `cerefox_edit`
 * must declare itself destructive, and folding insert into it would make every
 * additive write prompt like a delete (spec §3.2). `cerefox_insert` is
 * structurally incapable of removing content, which is exactly the guarantee
 * that prevents the scope-confusion data loss in spec §1.
 */

import {
  applyOperations,
  validateOperations,
  type AppliedOperation,
  type EditOperation,
} from "../partial-edits/index.ts";
import {
  chunkMarkdown,
  embeddingInputFor,
  CONTENT_FORMAT_BLIND_STITCH,
  normalizeContent,
  sha256hex,
} from "./_chunker.ts";
import { activeEmbedderName, embedBatch, resolveEmbedderKind } from "../embeddings/index.ts";
import { logUsage } from "./_utils.ts";
import { McpInvalidParams, type MCPSupabaseClient, type ToolContext, type ToolDefinition } from "./types.ts";

/** Audit `operation` values, matching the CHECK constraint widened by migration 0019. */
const AUDIT_OP: Record<AppliedOperation["op"], string> = {
  insert: "insert",
  replace_section: "replace-section",
  delete_section: "delete-section",
};

/**
 * Conflict text mirrors `ingest.ts`'s, but points at the partial-edit retry:
 * re-read, re-decide, retry — deliberately NOT "overwrite anyway", because
 * these tools have no last_write_wins (spec §5: a conflict is information the
 * agent needs, and suppressing it is what destroys another writer's work).
 */
function conflictError(documentId: string, expectedHash: string, currentHash: string): Error {
  return new Error(
    `Conflict: document ${documentId} changed since you read it ` +
      `(your base hash: ${expectedHash}, current hash: ${currentHash}). No write was performed. ` +
      `To resolve: (1) cerefox_get_document("${documentId}", outline=true) to see the current ` +
      `structure and hash cheaply, or a full read if you need the text, (2) decide whether your ` +
      `edit still applies — another writer may have already made it, or made something it ` +
      `contradicts, (3) retry with expected_content_hash set to the current hash. ` +
      `These tools have no last-write-wins: the other writer's work is not yours to discard.`,
  );
}

interface DocRow {
  doc_title?: string;
  full_content?: string;
  content_hash?: string;
}

async function readDocument(
  supabase: MCPSupabaseClient,
  documentId: string,
): Promise<{ title: string; content: string; hash: string }> {
  const { data, error } = await supabase.rpc("cerefox_get_document", {
    p_document_id: documentId,
    p_version_id: null,
  });
  if (error) throw new Error(`Could not read document: ${error.message}`);
  const row = (data?.[0] as DocRow | undefined) ?? undefined;
  if (!row || row.full_content === undefined) {
    throw new McpInvalidParams(
      `Document not found: ${documentId}. Partial edits apply to an existing document; ` +
        `use cerefox_ingest to create one.`,
    );
  }
  return {
    title: row.doc_title ?? "Untitled",
    content: row.full_content,
    hash: row.content_hash ?? "",
  };
}

/**
 * The shared write path. Everything above it is argument shape; everything
 * below is the same code the whole-document ingest path uses.
 */
async function applyAndWrite(
  supabase: MCPSupabaseClient,
  ctx: ToolContext,
  args: {
    documentId: string;
    operations: EditOperation[];
    expectedHash: string;
    requestor: string;
    toolLabel: string;
  },
): Promise<string> {
  const { documentId, operations, expectedHash, requestor, toolLabel } = args;

  if (!ctx.openaiApiKey && resolveEmbedderKind() !== "local") {
    throw new Error(
      "OpenAI API key not configured. Set OPENAI_API_KEY (Edge Function) or CEREFOX_OPENAI_API_KEY (.env, local).",
    );
  }

  const doc = await readDocument(supabase, documentId);

  // Advisory fast-fail before the embedding spend. The authoritative, race-free
  // check is the RPC's FOR UPDATE compare-and-swap.
  if (doc.hash && expectedHash !== doc.hash) {
    throw conflictError(documentId, expectedHash, doc.hash);
  }

  // Pure. Anchor/position problems raise here, before anything is written or
  // paid for, carrying the candidates that resolve them.
  let assembled: string;
  let applied: AppliedOperation[];
  try {
    const result = applyOperations(doc.content, operations);
    assembled = result.content;
    applied = result.applied;
  } catch (err) {
    // These are agent-correctable: surface as invalid-params so the client
    // reports them as a bad call rather than a server failure.
    throw new McpInvalidParams(err instanceof Error ? err.message : String(err));
  }

  if (assembled === doc.content) {
    return (
      `No change: the ${toolLabel} produced content identical to the current document ` +
      `"${doc.title}" (id: ${documentId}). content_hash: ${doc.hash} (unchanged).`
    );
  }

  const newHash = await sha256hex(normalizeContent(assembled));
  const chunks = chunkMarkdown(assembled);
  if (chunks.length === 0) {
    throw new McpInvalidParams(
      "The result of this edit produced no chunks (the document would be empty). " +
        "To remove a document use cerefox_ingest or the delete path, not a partial edit.",
    );
  }

  const texts = chunks.map((c) => embeddingInputFor(doc.title, c));
  const embeddings = await embedBatch(texts, ctx.openaiApiKey ?? "");
  const totalChars = chunks.reduce((s, c) => s + c.char_count, 0);

  const chunkData = chunks.map((chunk, i) => ({
    chunk_index: i,
    heading_path: chunk.heading_path,
    heading_level: chunk.heading_level,
    title: chunk.title,
    content: chunk.content,
    char_count: chunk.char_count,
    embedding: embeddings[i],
    embedder: activeEmbedderName(),
  }));

  const { data, error } = await supabase.rpc("cerefox_ingest_document", {
    p_document_id: documentId,
    p_title: doc.title, // partial edits never retitle
    p_source: "agent",
    p_content_hash: newHash,
    p_metadata: null, // null = keep existing metadata
    p_review_status: "pending_review",
    p_chunks: chunkData,
    p_author: requestor,
    p_author_type: "agent",
    p_source_label: "agent",
    p_expected_content_hash: expectedHash,
    p_last_write_wins: false,
    p_content_format: CONTENT_FORMAT_BLIND_STITCH,
    p_operations: applied.map((a) => ({ op: AUDIT_OP[a.op], detail: a.detail })),
  });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("CEREFOX_CONFLICT")) {
      const current = message.match(/current hash ([0-9a-f]{64})/)?.[1] ?? "unknown";
      throw conflictError(documentId, expectedHash, current);
    }
    if (message.includes("does not exist") && message.includes("cerefox_ingest_document")) {
      throw new Error(
        `This server is behind: partial edits need schema 0.11.0 or newer. ` +
          `Run \`cerefox server deploy\`, then retry. (${message})`,
      );
    }
    throw new Error(`Edit failed: ${message}`);
  }

  const row = (data?.[0] as
    | { content_hash?: string; total_chars?: number; size_warning?: boolean }
    | undefined) ?? undefined;

  logUsage(supabase, {
    operation: toolLabel,
    accessPath: ctx.accessPath,
    requestor,
    document_id: documentId,
    result_count: applied.length,
  });

  const summary = applied.map((a, i) => `  ${i + 1}. ${a.detail} → ${a.path}`).join("\n");
  const warning = row?.size_warning
    ? `\n\n⚠ This document has passed the configured size threshold ` +
      `(document_size_warning_chars). Consider splitting it.`
    : "";

  // Deliberately no document body: returning it would spend exactly the tokens
  // this feature saves, on the response side (spec §3.8).
  return (
    `Applied ${applied.length} operation(s) to "${doc.title}" (id: ${documentId}):\n${summary}\n\n` +
    `New content_hash: ${row?.content_hash ?? newHash}\n` +
    `Size: ${row?.total_chars ?? totalChars} chars, ${chunks.length} chunk(s).\n` +
    `Pass the new content_hash as expected_content_hash on your next edit.${warning}`
  );
}

// ── cerefox_insert ─────────────────────────────────────────────────────────

async function insertHandler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const documentId = (args.document_id as string | undefined)?.trim();
  const text = args.text as string | undefined;
  const position = args.position as string | undefined;
  const expectedHash = (args.expected_content_hash as string | undefined)?.trim();

  if (!documentId) throw new McpInvalidParams("document_id is required");
  if (!text?.trim()) throw new McpInvalidParams("text is required and cannot be empty");
  if (!expectedHash) {
    throw new McpInvalidParams(
      "expected_content_hash is required. It is the content_hash of the version you are " +
        "basing this insert on — returned by cerefox_get_document (including outline mode), " +
        "cerefox_search, cerefox_metadata_search, and by every write. There is no " +
        "last-write-wins here: knowing the document changed under you is the point.",
    );
  }

  const operations = validateOperations([
    {
      op: "insert",
      text,
      position,
      ...(args.anchor_heading !== undefined ? { anchor_heading: args.anchor_heading } : {}),
      ...(args.section_part !== undefined ? { section_part: args.section_part } : {}),
    },
  ]);

  return applyAndWrite(supabase, ctx, {
    documentId,
    operations,
    expectedHash,
    requestor: (args.requestor as string | undefined) ?? "mcp-agent",
    toolLabel: "insert",
  });
}

export const insertTool: ToolDefinition = {
  name: "cerefox_insert",
  description:
    "Add text to a document without resending the whole thing. Purely additive: it cannot " +
    "remove or overwrite existing content, so it is the safe way to append. Positions: " +
    "end_of_document (a plain append), end_of_section (add to the end of a section's body — " +
    "the most common mid-document add), after_heading (lead-in text), before_heading (a new " +
    "block above a section). Anchors are the exact heading line ('## Intake') or a parent path " +
    "('## Intake > ### Notes') when a heading appears more than once. Requires " +
    "expected_content_hash; returns the new hash, not the document.",
  annotations: {
    title: "Insert into document",
    readOnlyHint: false,
    // Structurally incapable of destroying content — the distinction that lets a
    // client grant this freely while still prompting on cerefox_edit.
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["document_id", "text", "position", "expected_content_hash"],
    properties: {
      document_id: { type: "string", description: "UUID of the document to add to" },
      text: { type: "string", description: "Markdown to insert. Sent as-is; blank-line separation is handled for you." },
      position: {
        type: "string",
        enum: ["end_of_document", "end_of_section", "after_heading", "before_heading"],
        description:
          "Where to insert. end_of_document needs no anchor; the other three require anchor_heading.",
      },
      anchor_heading: {
        type: "string",
        description:
          "Exact heading line, or a ' > ' path for a heading that appears more than once. Required unless position is end_of_document.",
      },
      section_part: {
        type: "string",
        enum: ["own_body", "subtree"],
        description:
          "Only for end_of_section when the section has BOTH its own content and child sections: own_body = before the first child, subtree = after everything nested under it. Omit otherwise; you will be told (with both options) if it is needed.",
      },
      expected_content_hash: {
        type: "string",
        description:
          "content_hash of the version you are basing this on. Required — no last-write-wins.",
      },
      requestor: {
        type: "string",
        description: 'Agent or user making this request. Recorded in the usage log. Defaults to "mcp-agent".',
      },
    },
  },
  handler: insertHandler,
};

// ── cerefox_edit ───────────────────────────────────────────────────────────

async function editHandler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const documentId = (args.document_id as string | undefined)?.trim();
  const expectedHash = (args.expected_content_hash as string | undefined)?.trim();

  if (!documentId) throw new McpInvalidParams("document_id is required");
  if (!expectedHash) {
    throw new McpInvalidParams(
      "expected_content_hash is required. It is the content_hash of the version you are " +
        "basing these edits on — returned by cerefox_get_document (including outline mode), " +
        "cerefox_search, cerefox_metadata_search, and by every write.",
    );
  }

  let operations: EditOperation[];
  try {
    operations = validateOperations(args.operations);
  } catch (err) {
    throw new McpInvalidParams(err instanceof Error ? err.message : String(err));
  }

  return applyAndWrite(supabase, ctx, {
    documentId,
    operations,
    expectedHash,
    requestor: (args.requestor as string | undefined) ?? "mcp-agent",
    toolLabel: "edit",
  });
}

export const editTool: ToolDefinition = {
  name: "cerefox_edit",
  description:
    "Change parts of a document without resending the whole thing: one or many operations " +
    "applied ATOMICALLY in one write. Operations: insert (same positions as cerefox_insert), " +
    "replace_section (swap a section's body, heading kept), delete_section (remove a section, " +
    "scope body_only or heading_and_body). Use one call for changes that belong together — a " +
    "half-applied edit is impossible, so a row and the total it feeds cannot disagree. " +
    "Operations apply in order and each sees the previous one's result. To change a single " +
    "line, replace_section on its smallest enclosing heading. Requires expected_content_hash; " +
    "returns the new hash, not the document.",
  annotations: {
    title: "Edit document sections",
    readOnlyHint: false,
    // replace_section and delete_section overwrite/remove content.
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["document_id", "operations", "expected_content_hash"],
    properties: {
      document_id: { type: "string", description: "UUID of the document to edit" },
      operations: {
        type: "array",
        minItems: 1,
        description:
          "Operations applied in order, all-or-nothing. If any fails (bad anchor, ambiguity), nothing is written.",
        items: {
          type: "object",
          required: ["op"],
          properties: {
            op: { type: "string", enum: ["insert", "replace_section", "delete_section"] },
            text: { type: "string", description: "Markdown. Required for insert and replace_section." },
            position: {
              type: "string",
              enum: ["end_of_document", "end_of_section", "after_heading", "before_heading"],
              description: "Required for insert.",
            },
            anchor_heading: {
              type: "string",
              description:
                "Exact heading line, or a ' > ' path when the heading is not unique. Required for replace_section, delete_section, and any insert other than end_of_document.",
            },
            section_part: {
              type: "string",
              enum: ["own_body", "subtree"],
              description:
                "Only when the target section has BOTH its own content and child sections. You will be told (with both options) if it is needed.",
            },
            scope: {
              type: "string",
              enum: ["body_only", "heading_and_body"],
              description: "delete_section only. Defaults to body_only, which keeps the heading.",
            },
          },
        },
      },
      expected_content_hash: {
        type: "string",
        description:
          "content_hash of the version you are basing these edits on. Required — no last-write-wins.",
      },
      requestor: {
        type: "string",
        description: 'Agent or user making this request. Recorded in the usage log. Defaults to "mcp-agent".',
      },
    },
  },
  handler: editHandler,
};
