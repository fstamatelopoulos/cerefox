import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { isVersionRequest, versionResponse } from "../../../_shared/ef-meta/index.ts";
import { efAuthGate } from "../../../_shared/ef-auth/index.ts";
import { capEmbeddingInput } from "../../../_shared/embeddings/index.ts";
import {
  chunkMarkdown,
  embeddingInputFor,
  CONTENT_FORMAT_BLIND_STITCH,
} from "../../../_shared/ingest/chunker.ts";

/**
 * cerefox-ingest — Supabase Edge Function
 *
 * Quick-capture endpoint: accepts a markdown note, chunks it by headings,
 * embeds each chunk with OpenAI, and stores everything in the knowledge base.
 *
 * This is the agent write path — use it for short notes captured during a
 * conversation. For large batch ingestion (directories, PDFs, etc.) use the
 * Python CLI: `cerefox ingest file.md`.
 *
 * Request body (JSON):
 *   title        string   required  Document title
 *   content      string   required  Markdown content
 *   project_name string   optional  Project to assign to (looked up by name, created if absent)
 *   source       string   optional  Origin label (default: "agent")
 *   metadata     object   optional  Arbitrary JSONB metadata. Omitted on an
 *                                   update → existing metadata is KEPT
 *                                   (v0.11.1); pass {} explicitly to clear.
 *
 * Response: { document_id, title, chunk_count, project_id? }
 */

const OPENAI_EMBEDDING_URL = "https://api.openai.com/v1/embeddings";
const OPENAI_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 768;

const MAX_CHUNK_CHARS = 4000;
const MIN_CHUNK_CHARS = 100;

interface IngestRequest {
  title: string;
  content: string;
  document_id?: string;
  project_name?: string;
  project_names?: string[]; // Full-set semantics; wins over project_name when both provided
  source?: string;
  metadata?: Record<string, unknown>;
  update_if_exists?: boolean;
  author?: string;
  author_type?: string; // 'user' | 'agent'
  // Optimistic concurrency (iter-32): REQUIRED on content updates — the
  // content_hash of the version this edit was based on. Conflict → HTTP 409.
  expected_content_hash?: string;
  // Explicitly skip the concurrency check (external source of truth).
  last_write_wins?: boolean;
}

// Map the RPC's expected/validation errors to proper HTTP responses:
//   CEREFOX_CONFLICT                → 409 (stale optimistic-concurrency token)
//   CEREFOX_TOKEN_REQUIRED          → 400 (missing expected_content_hash)
//   cerefox_documents_hash_unique   → 409 (content de-dup: another doc already
//                                          holds identical content)
// Returns null for genuinely unexpected errors (→ 500 at the call site).
function concurrencyErrorResponse(
  message: string,
  headers: Record<string, string>,
): Response | null {
  if (message.includes("cerefox_documents_hash_unique")) {
    return new Response(
      JSON.stringify({
        error: "duplicate_content",
        message:
          "Another document already has identical content. Cerefox de-duplicates by content hash — update that document instead of creating or editing a second copy to match it.",
        detail: message,
      }),
      { status: 409, headers },
    );
  }
  if (message.includes("CEREFOX_CONFLICT")) {
    return new Response(
      JSON.stringify({
        error: "conflict",
        message:
          "Document changed since it was read. Re-read it (getDocument), merge your changes, and retry with the new expected_content_hash.",
        detail: message,
      }),
      { status: 409, headers },
    );
  }
  if (message.includes("CEREFOX_TOKEN_REQUIRED")) {
    return new Response(
      JSON.stringify({
        error: "expected_content_hash required",
        message:
          "Content updates require expected_content_hash (the content_hash returned by getDocument / searchKnowledgeBase / metadataSearch) or last_write_wins=true.",
        detail: message,
      }),
      { status: 400, headers },
    );
  }
  return null;
}


// ── Embedding ──────────────────────────────────────────────────────────────

const EMBEDDING_MAX_RETRIES = 3;
const EMBEDDING_INITIAL_BACKOFF_MS = 500; // 500ms, 1s, 2s exponential backoff

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  let lastError: Error | null = null;
  const inputs = texts.map(capEmbeddingInput); // iter-28D Phase 0: cap oversized inputs

  for (let attempt = 0; attempt < EMBEDDING_MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(OPENAI_EMBEDDING_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          input: inputs,
          dimensions: EMBEDDING_DIMENSIONS,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        if (response.status < 500) {
          throw new Error(`OpenAI embedding error ${response.status}: ${err}`);
        }
        lastError = new Error(`OpenAI embedding error ${response.status}: ${err}`);
        const backoff = EMBEDDING_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(
          `Embedding API returned ${response.status} (attempt ${attempt + 1}/${EMBEDDING_MAX_RETRIES}), retrying in ${backoff}ms`,
        );
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      const data = await response.json();
      if (attempt > 0) {
        console.info(`Embedding API succeeded on retry ${attempt}`);
      }
      const sorted = data.data.sort(
        (a: { index: number }, b: { index: number }) => a.index - b.index,
      );
      return sorted.map((d: { embedding: number[] }) => d.embedding);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("OpenAI embedding error")) {
        throw err;
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      const backoff = EMBEDDING_INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      console.warn(
        `Embedding API request failed: ${lastError.message} (attempt ${attempt + 1}/${EMBEDDING_MAX_RETRIES}), retrying in ${backoff}ms`,
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw lastError ?? new Error(`Embedding API failed after ${EMBEDDING_MAX_RETRIES} attempts`);
}

// ── Content normalisation + hash (SHA-256 hex) ────────────────────────────
// Must stay in sync with pipeline.py::_normalize / _hash.
// Converts CRLF (and bare CR) to LF, strips leading/trailing whitespace, and
// collapses 3+ consecutive newlines to two.  The CRLF step is required because
// browsers submit textarea content with CRLF per the HTML spec, so a document
// first ingested via CLI/MCP (LF) must hash identically after a web edit.

function normalizeContent(text: string): string {
  return text.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n");
}

async function sha256hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Non-destructive project membership helper ─────────────────────────────
//
// Per issue #38: on UPDATE flows, passing project_name must not silently
// strip existing memberships. Semantics:
//   - Look up (or create) the project by name → project_id.
//   - If (document_id, project_id) row already exists → no-op (idempotent).
//   - Otherwise INSERT a new row, preserving all other existing memberships.
//
// Used by both update branches AND the create path so resolution is consistent.

// deno-lint-ignore no-explicit-any
async function ensureDocumentInProject(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  documentId: string,
  projectName: string,
): Promise<string | null> {
  // Resolve project name → id (look up; create if absent).
  let projectId: string | null = null;
  const { data: proj } = await supabase
    .from("cerefox_projects")
    .select("id")
    .ilike("name", projectName)
    .limit(1);
  if (proj?.length) {
    projectId = proj[0].id;
  } else {
    const { data: newProj } = await supabase
      .from("cerefox_projects")
      .insert({ name: projectName })
      .select("id");
    projectId = newProj?.[0]?.id ?? null;
  }
  if (!projectId) return null;

  // Check membership; INSERT only if missing. PRIMARY KEY (document_id, project_id)
  // guarantees uniqueness, so this is safe under concurrent calls (worst case:
  // one of two concurrent inserts fails with 23505 unique_violation — we log
  // and treat as "already a member"; outcome is identical).
  const { data: existing } = await supabase
    .from("cerefox_document_projects")
    .select("document_id")
    .eq("document_id", documentId)
    .eq("project_id", projectId)
    .limit(1);
  if (existing?.length) return projectId;  // Already a member — non-destructive

  const { error: insertErr } = await supabase
    .from("cerefox_document_projects")
    .insert({ document_id: documentId, project_id: projectId });
  if (insertErr && !String(insertErr.message ?? "").includes("duplicate key")) {
    console.warn("ensureDocumentInProject: insert failed", insertErr);
  }
  return projectId;
}

// ── Destructive set-the-full-list helper (project_names list form) ─────────
//
// Resolves each name to a project_id (creating if absent), then REPLACES the
// document's project memberships with exactly that set. Used by the
// project_names: string[] form on cerefox_ingest (full-set semantics).
//
// Empty list = remove from all projects.

// deno-lint-ignore no-explicit-any
async function setDocumentProjectsByName(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  documentId: string,
  projectNames: string[],
): Promise<string[]> {
  const projectIds: string[] = [];
  for (const name of projectNames) {
    if (!name) continue;
    const { data: proj } = await supabase
      .from("cerefox_projects")
      .select("id")
      .ilike("name", name)
      .limit(1);
    if (proj?.length) {
      projectIds.push(proj[0].id);
    } else {
      const { data: newProj } = await supabase
        .from("cerefox_projects")
        .insert({ name })
        .select("id");
      if (newProj?.[0]?.id) projectIds.push(newProj[0].id);
    }
  }

  // DELETE-then-INSERT replace (matches Python assign_document_projects).
  await supabase
    .from("cerefox_document_projects")
    .delete()
    .eq("document_id", documentId);
  if (projectIds.length > 0) {
    const rows = projectIds.map((pid) => ({ document_id: documentId, project_id: pid }));
    await supabase.from("cerefox_document_projects").insert(rows);
  }
  return projectIds;
}

// ── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  const authFail = efAuthGate(
    req.headers.get("Authorization"),
    Deno.env.get("CEREFOX_ACCESS_TOKENS"),
    { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  );
  if (authFail) return authFail;

  if (isVersionRequest(req)) {
    return versionResponse("cerefox-ingest", {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: IngestRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // metadata: null = "not provided" — the RPC keeps existing metadata on
  // update and uses {} on create (v0.11.1; a `= {}` default here used to wipe
  // a document's tags on every content update that didn't re-pass them).
  const { title, content, document_id = null, project_name, source = "agent", metadata = null, update_if_exists = false, author = "agent", author_type = "agent", expected_content_hash = null, last_write_wins = false } = body;

  // metadata must be a plain JSON object (or absent). A scalar/array stored in
  // the JSONB column poisons cerefox_list_metadata_keys for the whole dataset
  // (issue #89) — reject at the boundary too, not just in the RPC.
  if (metadata !== null && (typeof metadata !== "object" || Array.isArray(metadata))) {
    return new Response(
      JSON.stringify({ error: 'metadata must be a JSON object of key/value pairs, e.g. {"type":"note"} — not a string, number, or array' }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // Validate + normalize project_names if provided (full-set destructive form)
  let project_names: string[] | null = null;
  if (body.project_names !== undefined && body.project_names !== null) {
    if (!Array.isArray(body.project_names)) {
      return new Response(
        JSON.stringify({ error: "project_names must be an array of strings; use project_name (string) for a single project" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    project_names = body.project_names.filter((s): s is string => typeof s === "string" && s.length > 0);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Configurable requestor enforcement
  {
    const identityField = "author";
    const identityValue = body[identityField as keyof IngestRequest] as string | undefined;
    const { data: reqConfig } = await supabase.rpc("cerefox_get_config", { p_key: "require_requestor_identity" });
    if (reqConfig === "true") {
      if (!identityValue || (typeof identityValue === "string" && identityValue.trim() === "")) {
        return new Response(
          JSON.stringify({ error: `Missing required parameter "${identityField}". Server requires caller identity.` }),
          { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
        );
      }
      const { data: fmtConfig } = await supabase.rpc("cerefox_get_config", { p_key: "requestor_identity_format" });
      if (fmtConfig && typeof fmtConfig === "string" && fmtConfig.trim() !== "") {
        if (!new RegExp(fmtConfig).test(identityValue)) {
          return new Response(
            JSON.stringify({ error: `Invalid "${identityField}" format. Does not match pattern: ${fmtConfig}` }),
            { status: 400, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } },
          );
        }
      }
    }
  }

  if (!title?.trim() || !content?.trim()) {
    return new Response(JSON.stringify({ error: "title and content are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY secret not set on this project" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const contentHash = await sha256hex(normalizeContent(content));
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const reviewStatus = author_type === "agent" ? "pending_review" : "approved";

  // ── ID-based update path ────────────────────────────────────────────────────
  // When document_id is provided, update that exact document regardless of
  // update_if_exists. Skip hash dedup -- explicit ID = explicit intent to update.
  if (document_id) {
    const { data: existing } = await supabase
      .from("cerefox_documents")
      .select("id, title, content_hash")
      .eq("id", document_id)
      .is("deleted_at", null)
      .limit(1);

    if (!existing?.length) {
      return new Response(
        JSON.stringify({ error: `Document not found: ${document_id}` }),
        { status: 404, headers },
      );
    }

    const existingDoc = existing[0];

    // Content unchanged -- skip re-indexing
    if (existingDoc.content_hash === contentHash) {
      const note = update_if_exists ? undefined : "update_if_exists flag was overridden by document_id";
      return new Response(
        JSON.stringify({
          document_id: existingDoc.id,
          title: existingDoc.title,
          skipped: true,
          updated: false,
          message: "Document already up-to-date (content hash match)",
          ...(note && { note }),
        }),
        { headers },
      );
    }

    // Optimistic-concurrency fast-fail (iter-32): stale token fails BEFORE
    // the embedding spend. Advisory only — the authoritative race-free check
    // is inside the RPC (SELECT … FOR UPDATE).
    if (!last_write_wins && expected_content_hash && expected_content_hash !== existingDoc.content_hash) {
      return concurrencyErrorResponse(
        `CEREFOX_CONFLICT: document ${existingDoc.id} changed since it was read (expected hash ${expected_content_hash}, current hash ${existingDoc.content_hash}).`,
        headers,
      )!;
    }

    // Content changed -- re-chunk, re-embed, ingest via RPC
    const chunks = chunkMarkdown(content);
    if (chunks.length === 0) {
      return new Response(JSON.stringify({ error: "Content produced no chunks" }), { status: 422, headers });
    }

    const texts = chunks.map((c) => embeddingInputFor(title.trim(), c));
    let embeddings: number[][];
    try {
      embeddings = await embedBatch(texts, openaiKey);
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 502, headers });
    }

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
      p_title: title.trim(),
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

    if (ingestErr) {
      const mapped = concurrencyErrorResponse(ingestErr.message ?? "", headers);
      if (mapped) return mapped;
      return new Response(JSON.stringify({ error: `Ingest RPC failed: ${ingestErr.message}` }), { status: 500, headers });
    }

    Promise.resolve(supabase.rpc("cerefox_log_usage", {
      p_operation: "ingest",
      p_access_path: "edge-function",
      p_requestor: author,
      p_document_id: existingDoc.id,
      p_result_count: chunks.length,
    })).catch(() => {});

    // Project membership semantics on update (issue #38):
    // - project_names (list) → destructive replace (full-set semantics)
    // - project_name (singular) → non-destructive add (only if project_names absent)
    if (project_names !== null) {
      await setDocumentProjectsByName(supabase, existingDoc.id, project_names);
    } else if (project_name) {
      await ensureDocumentInProject(supabase, existingDoc.id, project_name);
    }

    const note = update_if_exists ? undefined : "update_if_exists flag was overridden by document_id";
    return new Response(
      JSON.stringify({
        document_id: existingDoc.id,
        title: title.trim(),
        chunk_count: chunks.length,
        total_chars: totalChars,
        updated: true,
        content_hash: contentHash,
        ...(note && { note }),
      }),
      { headers },
    );
  }

  // ── Update-existing path ────────────────────────────────────────────────────
  if (update_if_exists) {
    const { data: existing } = await supabase
      .from("cerefox_documents")
      .select("id, title, content_hash")
      .eq("title", title.trim())
      .order("updated_at", { ascending: false })
      .limit(1);

    if (existing?.length) {
      const existingDoc = existing[0];

      // Content unchanged — skip re-indexing
      if (existingDoc.content_hash === contentHash) {
        return new Response(
          JSON.stringify({
            document_id: existingDoc.id,
            title: existingDoc.title,
            skipped: true,
            updated: false,
            message: "Document already up-to-date (content hash match)",
          }),
          { headers },
        );
      }

      // Optimistic-concurrency fast-fail (iter-32) — see ID-based path.
      if (!last_write_wins && expected_content_hash && expected_content_hash !== existingDoc.content_hash) {
        return concurrencyErrorResponse(
          `CEREFOX_CONFLICT: document ${existingDoc.id} changed since it was read (expected hash ${expected_content_hash}, current hash ${existingDoc.content_hash}).`,
          headers,
        )!;
      }

      // Content changed — re-chunk, re-embed, ingest via RPC
      const chunks = chunkMarkdown(content);
      if (chunks.length === 0) {
        return new Response(JSON.stringify({ error: "Content produced no chunks" }), {
          status: 422, headers,
        });
      }

      // Prepend document title for contextual enrichment (stored content unchanged)
      const texts = chunks.map((c) => embeddingInputFor(title.trim(), c));
      let embeddings: number[][];
      try {
        embeddings = await embedBatch(texts, openaiKey);
      } catch (err) {
        return new Response(JSON.stringify({ error: String(err) }), { status: 502, headers });
      }

      const totalChars = chunks.reduce((s, c) => s + c.char_count, 0);

      // Single RPC handles: snapshot version, update doc, insert chunks, set review_status, audit entry
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

      if (ingestErr) {
        const mapped = concurrencyErrorResponse(ingestErr.message ?? "", headers);
        if (mapped) return mapped;
        return new Response(
          JSON.stringify({ error: `Ingest RPC failed: ${ingestErr.message}` }),
          { status: 500, headers },
        );
      }

      // Fire-and-forget usage logging for update
      Promise.resolve(supabase.rpc("cerefox_log_usage", {
        p_operation: "ingest",
        p_access_path: "edge-function",
        p_requestor: author,
        p_document_id: existingDoc.id,
        p_result_count: chunks.length,
      })).catch(() => {});

      // Project membership semantics on update (issue #38):
      // - project_names (list) → destructive replace (full-set semantics)
      // - project_name (singular) → non-destructive add (only if project_names absent)
      if (project_names !== null) {
        await setDocumentProjectsByName(supabase, existingDoc.id, project_names);
      } else if (project_name) {
        await ensureDocumentInProject(supabase, existingDoc.id, project_name);
      }

      return new Response(
        JSON.stringify({
          document_id: existingDoc.id,
          title: existingDoc.title,
          chunk_count: chunks.length,
          total_chars: totalChars,
          updated: true,
          content_hash: contentHash,
        }),
        { headers },
      );
    }
    // No match found -- fall through to normal create below
  }

  // ── Hash deduplication (normal create path) ────────────────────────────────
  const { data: hashMatch } = await supabase
    .from("cerefox_documents")
    .select("id, title")
    .eq("content_hash", contentHash)
    .limit(1);

  if (hashMatch?.length) {
    return new Response(
      JSON.stringify({
        document_id: hashMatch[0].id,
        title: hashMatch[0].title,
        skipped: true,
        message: "Document already exists (content hash match)",
      }),
      { headers },
    );
  }

  // Chunk the content
  const chunks = chunkMarkdown(content);
  if (chunks.length === 0) {
    return new Response(JSON.stringify({ error: "Content produced no chunks" }), {
      status: 422,
      headers,
    });
  }

  // Embed all chunks with title prefix for contextual enrichment (stored content unchanged)
  const texts = chunks.map((c) => embeddingInputFor(title.trim(), c));
  let embeddings: number[][];
  try {
    embeddings = await embedBatch(texts, openaiKey);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 502,
      headers,
    });
  }

  const totalChars = chunks.reduce((s, c) => s + c.char_count, 0);

  // Single RPC handles: insert doc, insert chunks, set review_status, audit entry
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
    p_title: title.trim(),
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
    return new Response(
      JSON.stringify({ error: `Ingest RPC failed: ${ingestErr?.message ?? "no data returned"}` }),
      { status: 500, headers },
    );
  }

  const documentId = ingestResult[0].document_id;

  // Project assignment on CREATE:
  // - project_names (list) → assign all
  // - project_name (singular) → assign one via the non-destructive helper
  let projectId: string | null = null;
  if (project_names !== null && project_names.length > 0) {
    await setDocumentProjectsByName(supabase, documentId, project_names);
  } else if (project_name) {
    projectId = await ensureDocumentInProject(supabase, documentId, project_name);
  }

  // Fire-and-forget usage logging for ingest
  Promise.resolve(supabase.rpc("cerefox_log_usage", {
    p_operation: "ingest",
    p_access_path: "edge-function",
    p_requestor: author,
    p_document_id: documentId,
    p_result_count: chunks.length,
  })).catch(() => {});

  return new Response(
    JSON.stringify({
      document_id: documentId,
      title: title.trim(),
      chunk_count: chunks.length,
      total_chars: totalChars,
      // #189: the concurrency token, on CREATE as well as update. Without it the
      // author of a new document had to re-read it, or pass last_write_wins, to
      // make its first edit — and callers took the second.
      content_hash: ingestResult[0].content_hash ?? contentHash,
      project_id: projectId,
      project_name: project_name ?? null,
    }),
    {
      status: 201,
      headers,
    },
  );
});
