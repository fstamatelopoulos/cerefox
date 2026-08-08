/**
 * `cerefox_ingest` — save a note or document to the knowledge base.
 *
 * Three code paths:
 * - `document_id` set → ID-based update (preferred; deterministic).
 * - `update_if_exists: true` + title matches existing → update by title.
 * - Otherwise → create (with hash-dedup short-circuit).
 *
 * Project-membership semantics on update (issue #38 / v0.1.20):
 * - `project_names: [...]` → destructive replace.
 * - `project_name: "..."` → non-destructive add (preserves other memberships).
 * - Neither → no change.
 *
 * Mirrors `supabase/functions/cerefox-mcp/tools/ingest.ts` for v0.4.0
 * extraction (no behaviour change).
 */

import type { MCPSupabaseClient } from "./types.ts";

import {
  chunkMarkdown,
  embeddingInputFor,
  CONTENT_FORMAT_BLIND_STITCH,
  normalizeContent,
  sha256hex,
} from "./_chunker.ts";
import { activeEmbedderName, embedBatch, resolveEmbedderKind } from "../embeddings/index.ts";
import { ensureDocumentInProject, setDocumentProjectsByName } from "./_projects.ts";
import { logUsage } from "./_utils.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";

/**
 * Agent-first instructions for an optimistic-concurrency conflict (iter-32).
 * Raised either by the local fast-fail (before the embedding spend) or by the
 * authoritative check inside the cerefox_ingest_document RPC.
 */
function conflictError(documentId: string, expectedHash: string, currentHash: string): Error {
  return new Error(
    `Conflict: document ${documentId} changed since you read it ` +
      `(your base hash: ${expectedHash}, current hash: ${currentHash}). ` +
      `To resolve: (1) cerefox_get_document("${documentId}") to fetch the latest content ` +
      `and its content_hash, (2) merge your changes into it, (3) retry cerefox_ingest ` +
      `with expected_content_hash set to the new hash. Do not overwrite blindly — ` +
      `the current content may include another writer's work.`,
  );
}

/** Map RPC-side CEREFOX_CONFLICT / CEREFOX_TOKEN_REQUIRED errors to agent-first text. */
function mapIngestRpcError(message: string, documentId: string): Error {
  if (message.includes("CEREFOX_CONFLICT")) {
    const current = message.match(/current hash ([0-9a-f]{64})/)?.[1] ?? "unknown";
    const expected = message.match(/expected hash ([0-9a-f]{64})/)?.[1] ?? "unknown";
    return conflictError(documentId, expected, current);
  }
  if (message.includes("CEREFOX_TOKEN_REQUIRED")) {
    const current = message.match(/Current hash: ([0-9a-f]{64})/)?.[1];
    return new Error(
      `Concurrency token required: content updates need expected_content_hash — ` +
        `the content_hash of the version you based your edit on (returned by ` +
        `cerefox_get_document, cerefox_search, and cerefox_metadata_search).` +
        (current ? ` The document's current hash is ${current}; pass it ONLY if your edit was based on the current content.` : "") +
        ` If you have not read the document, read it first. To deliberately overwrite ` +
        `regardless of concurrent changes, pass last_write_wins=true.`,
    );
  }
  return new Error(`Ingest RPC failed: ${message}`);
}

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const title = (args.title as string | undefined)?.trim();
  const content = args.content as string | undefined;
  const document_id = (args.document_id as string | undefined) ?? null;
  const project_name = args.project_name as string | undefined;
  const project_names_raw = args.project_names;
  const source = (args.source as string | undefined) ?? "agent";
  // null = "not provided": the RPC keeps existing metadata on update and uses
  // {} on create (v0.11.1 — defaulting to {} here used to wipe a document's
  // tags on every content update that didn't re-pass them).
  const metadata = (args.metadata as Record<string, unknown> | undefined) ?? null;
  // Must be a plain JSON object (or absent). A scalar/array stored in the JSONB
  // column poisons cerefox_list_metadata_keys for the whole dataset (issue #89),
  // so reject it at the boundary too, not just in the RPC.
  if (metadata !== null && (typeof metadata !== "object" || Array.isArray(metadata))) {
    throw new McpInvalidParams(
      'metadata must be a JSON object of key/value pairs, e.g. {"type":"note"} — not a string, number, or array',
    );
  }
  const update_if_exists = (args.update_if_exists as boolean | undefined) ?? false;
  const author = (args.author as string | undefined) ?? "mcp-agent";
  const author_type = "agent"; // MCP path is always agent
  const expected_content_hash = (args.expected_content_hash as string | undefined)?.trim() || null;
  const last_write_wins = (args.last_write_wins as boolean | undefined) ?? false;

  if (!title || !content?.trim()) {
    throw new McpInvalidParams("title and content are required");
  }
  if (
    project_names_raw !== undefined &&
    project_names_raw !== null &&
    !Array.isArray(project_names_raw)
  ) {
    throw new McpInvalidParams(
      "project_names must be a JSON array of strings; for a single project use project_name (string)",
    );
  }
  const project_names: string[] | null = Array.isArray(project_names_raw)
    ? project_names_raw.filter((s): s is string => typeof s === "string" && s.length > 0)
    : null;

  if (!ctx.openaiApiKey && resolveEmbedderKind() !== "local") {
    throw new Error(
      "OpenAI API key not configured. Set OPENAI_API_KEY (Edge Function) or CEREFOX_OPENAI_API_KEY (.env, local).",
    );
  }

  const contentHash = await sha256hex(normalizeContent(content));
  const reviewStatus = author_type === "agent" ? "pending_review" : "approved";

  // ── ID-based update path ─────────────────────────────────────────────────
  if (document_id) {
    const { data: existing } = await supabase
      .from("cerefox_documents")
      .select("id, title, content_hash")
      .eq("id", document_id)
      .is("deleted_at", null)
      .limit(1);

    if (!existing?.length) {
      throw new Error(`Document not found: ${document_id}`);
    }

    const existingDoc = existing[0];

    if (existingDoc.content_hash === contentHash) {
      const note = update_if_exists
        ? ""
        : " Note: update_if_exists flag was overridden by document_id.";
      return `Document already up-to-date: "${existingDoc.title}" (id: ${existingDoc.id}). Content hash unchanged (${contentHash}).${note}`;
    }

    // Fast-fail on a stale token BEFORE paying the embedding cost. Advisory
    // only — the authoritative, race-free check is inside the RPC (FOR UPDATE).
    if (!last_write_wins && expected_content_hash && expected_content_hash !== existingDoc.content_hash) {
      throw conflictError(existingDoc.id, expected_content_hash, existingDoc.content_hash);
    }

    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) throw new Error("Content produced no chunks");

    const texts = chunks.map((c) => embeddingInputFor(title, c));
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

    const { error: ingestErr } = await supabase.rpc("cerefox_ingest_document", {
      p_document_id: existingDoc.id,
      p_title: title,
      p_source: source,
      p_content_hash: contentHash,
      p_metadata: metadata,
      p_review_status: reviewStatus,
      p_chunks: chunkData,
      p_author: author,
      p_author_type: author_type,
      p_source_label: source,
      p_expected_content_hash: expected_content_hash,
      p_last_write_wins: last_write_wins,
      p_content_format: CONTENT_FORMAT_BLIND_STITCH,
    });

    if (ingestErr) throw mapIngestRpcError(ingestErr.message, existingDoc.id);

    logUsage(supabase, {
      operation: "ingest",
      accessPath: ctx.accessPath,
      requestor: author,
      document_id: existingDoc.id,
      result_count: chunks.length,
    });

    if (project_names !== null) {
      await setDocumentProjectsByName(supabase, existingDoc.id, project_names);
    } else if (project_name) {
      await ensureDocumentInProject(supabase, existingDoc.id, project_name);
    }

    const note = update_if_exists
      ? ""
      : " Note: update_if_exists flag was overridden by document_id.";
    return `Document updated: "${title}" (id: ${existingDoc.id}), ${chunks.length} chunk(s), ${totalChars} chars. New content_hash: ${contentHash}.${note}`;
  }

  // ── Update-existing path ─────────────────────────────────────────────────
  if (update_if_exists) {
    const { data: existing } = await supabase
      .from("cerefox_documents")
      .select("id, title, content_hash")
      .eq("title", title)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (existing?.length) {
      const existingDoc = existing[0];

      if (existingDoc.content_hash === contentHash) {
        return `Document already up-to-date: "${existingDoc.title}" (id: ${existingDoc.id}). Content hash unchanged (${contentHash}).`;
      }

      // Fast-fail on a stale token BEFORE the embedding cost (advisory; the
      // authoritative check is in the RPC).
      if (!last_write_wins && expected_content_hash && expected_content_hash !== existingDoc.content_hash) {
        throw conflictError(existingDoc.id, expected_content_hash, existingDoc.content_hash);
      }

      const chunks = chunkMarkdown(content);
      if (chunks.length === 0) throw new Error("Content produced no chunks");

      const texts = chunks.map((c) => embeddingInputFor(title, c));
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

      const { error: ingestErr } = await supabase.rpc("cerefox_ingest_document", {
        p_document_id: existingDoc.id,
        p_title: existingDoc.title,
        p_source: source,
        p_content_hash: contentHash,
        p_metadata: metadata,
        p_review_status: reviewStatus,
        p_chunks: chunkData,
        p_author: author,
        p_author_type: author_type,
        p_source_label: source,
        p_expected_content_hash: expected_content_hash,
        p_last_write_wins: last_write_wins,
      p_content_format: CONTENT_FORMAT_BLIND_STITCH,
      });

      if (ingestErr) throw mapIngestRpcError(ingestErr.message, existingDoc.id);

      logUsage(supabase, {
        operation: "ingest",
        accessPath: ctx.accessPath,
        requestor: author,
        document_id: existingDoc.id,
        result_count: chunks.length,
      });

      if (project_names !== null) {
        await setDocumentProjectsByName(supabase, existingDoc.id, project_names);
      } else if (project_name) {
        await ensureDocumentInProject(supabase, existingDoc.id, project_name);
      }

      return `Document updated: "${existingDoc.title}" (id: ${existingDoc.id}), ${chunks.length} chunk(s), ${totalChars} chars. New content_hash: ${contentHash}.`;
    }
    // Fall through to create path
  }

  // ── Hash deduplication (create path) ─────────────────────────────────────
  const { data: hashMatch } = await supabase
    .from("cerefox_documents")
    .select("id, title")
    .eq("content_hash", contentHash)
    .limit(1);

  if (hashMatch?.length) {
    return `Document already up-to-date: "${hashMatch[0].title}" (id: ${hashMatch[0].id}). Content hash unchanged.`;
  }

  const chunks = chunkMarkdown(content);
  if (chunks.length === 0) throw new Error("Content produced no chunks");

  const texts = chunks.map((c) => embeddingInputFor(title, c));
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

  const { data: ingestResult, error: ingestErr } = await supabase.rpc("cerefox_ingest_document", {
    p_document_id: null,
    p_title: title,
    p_source: source,
    p_content_hash: contentHash,
    p_metadata: metadata,
    p_review_status: reviewStatus,
    p_chunks: chunkData,
    p_author: author,
    p_author_type: author_type,
    p_content_format: CONTENT_FORMAT_BLIND_STITCH,
  });

  if (ingestErr || !ingestResult?.length) {
    throw new Error(`Ingest RPC failed: ${ingestErr?.message ?? "no data returned"}`);
  }

  const documentId = ingestResult[0].document_id;

  if (project_names !== null && project_names.length > 0) {
    await setDocumentProjectsByName(supabase, documentId, project_names);
  } else if (project_name) {
    await ensureDocumentInProject(supabase, documentId, project_name);
  }

  logUsage(supabase, {
    operation: "ingest",
    accessPath: ctx.accessPath,
    requestor: author,
    document_id: documentId,
    result_count: chunks.length,
  });

  const projectInfo = project_name ? `, project: "${project_name}"` : "";
  return `Document saved: "${title}" (id: ${documentId}), ${chunks.length} chunk(s), ${totalChars} chars${projectInfo}.`;
}

export const ingestTool: ToolDefinition = {
  name: "cerefox_ingest",
  description: "Save a note or document to the Cerefox knowledge base.",
  /** Destructive: `project_names` REPLACES the document's project memberships, and
 *  memberships have no version history — a partial list silently drops the rest.
 *  Content itself is version-snapshotted and guarded by expected_content_hash, so
 *  the destructive part is the membership replace, not the body. */
  annotations: {
    title: "Save or update a document",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["title", "content"],
    properties: {
      title: { type: "string", description: "Document title" },
      content: { type: "string", description: "Markdown content" },
      document_id: {
        type: "string",
        description:
          "UUID of an existing document to update. When provided, updates that specific document regardless of update_if_exists. Returns an error if the document does not exist. Workflow: cerefox_search → note the [id: ...] → pass here for deterministic update.",
      },
      project_name: {
        type: "string",
        description:
          "Optional: single project name (created if absent). On update: non-destructive add — ensures this membership exists; preserves other memberships an operator may have added via the web UI. For explicit set-the-full-list semantics, use project_names (list) instead, or call cerefox_set_document_projects.",
      },
      project_names: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional: explicit list of project names (each created if absent). Full-set semantics — on update this REPLACES the document's project memberships with exactly this set. Use when you want to set multiple projects at once or deliberately change the membership list. Wins over project_name when both are passed.",
      },
      source: { type: "string", description: 'Origin label (default: "agent")' },
      update_if_exists: {
        type: "boolean",
        description:
          "When true, update an existing document with the same title instead of creating a new one (default: false). Ignored when document_id is provided.",
      },
      expected_content_hash: {
        type: "string",
        description:
          "REQUIRED on content updates (optimistic concurrency): the content_hash of the document version you based your edit on, as returned by cerefox_get_document / cerefox_search / cerefox_metadata_search. If the document changed since you read it, the update fails with a conflict — re-read, merge, retry with the new hash. Not needed when creating a new document.",
      },
      last_write_wins: {
        type: "boolean",
        description:
          "Explicitly skip the concurrency check and overwrite regardless of concurrent changes (default: false). Use ONLY when an external source of truth makes conflicts meaningless (e.g. re-syncing from files). Recorded in the audit log.",
      },
      metadata: { type: "object", description: "Arbitrary JSON metadata (optional)" },
      author: {
        type: "string",
        description:
          'Name of the agent or tool performing the ingestion (e.g., "Claude Code", "archiver"). Recorded in the audit log for attribution. Defaults to "mcp-agent" if not provided. May be enforced via server config.',
      },
    },
  },
  handler,
};
