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

import { chunkMarkdown, normalizeContent, sha256hex } from "./_chunker.ts";
import { embedBatch, OPENAI_MODEL } from "../embeddings/index.ts";
import { ensureDocumentInProject, setDocumentProjectsByName } from "./_projects.ts";
import { logUsage } from "./_utils.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";

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
  const metadata = (args.metadata as Record<string, unknown> | undefined) ?? {};
  const update_if_exists = (args.update_if_exists as boolean | undefined) ?? false;
  const author = (args.author as string | undefined) ?? "mcp-agent";
  const author_type = "agent"; // MCP path is always agent

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

  if (!ctx.openaiApiKey) {
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
      return `Document already up-to-date: "${existingDoc.title}" (id: ${existingDoc.id}). Content hash unchanged.${note}`;
    }

    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) throw new Error("Content produced no chunks");

    const texts = chunks.map((c) => `# ${title}\n${c.content}`);
    const embeddings = await embedBatch(texts, ctx.openaiApiKey);
    const totalChars = chunks.reduce((s, c) => s + c.char_count, 0);

    const chunkData = chunks.map((chunk, i) => ({
      chunk_index: i,
      heading_path: chunk.heading_path,
      heading_level: chunk.heading_level,
      title: chunk.title,
      content: chunk.content,
      char_count: chunk.char_count,
      embedding: embeddings[i],
      embedder: OPENAI_MODEL,
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
    });

    if (ingestErr) throw new Error(`Ingest RPC failed: ${ingestErr.message}`);

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
    return `Document updated: "${title}" (id: ${existingDoc.id}), ${chunks.length} chunk(s), ${totalChars} chars.${note}`;
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
        return `Document already up-to-date: "${existingDoc.title}" (id: ${existingDoc.id}). Content hash unchanged.`;
      }

      const chunks = chunkMarkdown(content);
      if (chunks.length === 0) throw new Error("Content produced no chunks");

      const texts = chunks.map((c) => `# ${title}\n${c.content}`);
      const embeddings = await embedBatch(texts, ctx.openaiApiKey);
      const totalChars = chunks.reduce((s, c) => s + c.char_count, 0);

      const chunkData = chunks.map((chunk, i) => ({
        chunk_index: i,
        heading_path: chunk.heading_path,
        heading_level: chunk.heading_level,
        title: chunk.title,
        content: chunk.content,
        char_count: chunk.char_count,
        embedding: embeddings[i],
        embedder: OPENAI_MODEL,
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
      });

      if (ingestErr) throw new Error(`Ingest RPC failed: ${ingestErr.message}`);

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

      return `Document updated: "${existingDoc.title}" (id: ${existingDoc.id}), ${chunks.length} chunk(s), ${totalChars} chars.`;
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

  const texts = chunks.map((c) => `# ${title}\n${c.content}`);
  const embeddings = await embedBatch(texts, ctx.openaiApiKey);
  const totalChars = chunks.reduce((s, c) => s + c.char_count, 0);

  const chunkData = chunks.map((chunk, i) => ({
    chunk_index: i,
    heading_path: chunk.heading_path,
    heading_level: chunk.heading_level,
    title: chunk.title,
    content: chunk.content,
    char_count: chunk.char_count,
    embedding: embeddings[i],
    embedder: OPENAI_MODEL,
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
