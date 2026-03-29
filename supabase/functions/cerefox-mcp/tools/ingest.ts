// ── cerefox_ingest tool handler ───────────────────────────────────────────
//
// Chunks content, embeds it with OpenAI, and writes it to the knowledge base
// via the cerefox_ingest_document RPC directly -- no delegation to the
// cerefox-ingest Edge Function.

import { makeSupabaseClient, logUsage } from "../shared.ts";
import { embedBatch, OPENAI_MODEL } from "../embeddings.ts";

// ── Chunker constants ──────────────────────────────────────────────────────

const MAX_CHUNK_CHARS = 4000;

// ── Types ──────────────────────────────────────────────────────────────────

interface Section {
  level: number;
  headings: string[];
  heading: string;
  content: string;
  body: string;
}

interface Chunk {
  heading_path: string[];
  heading_level: number;
  title: string;
  content: string;
  char_count: number;
}

// ── Heading-aware chunker (mirrors Python pipeline and cerefox-ingest) ─────
//
// Short-circuit for small documents: the entire doc becomes one chunk.
// Greedy accumulation: sections are collected until adding the next would
// exceed MAX_CHUNK_CHARS. Oversized sections are paragraph-split.

function parseSections(text: string): Section[] {
  const lines = text.split("\n");
  const sections: Section[] = [];
  let currentHeadings: string[] = [];
  let currentLevel = 0;
  let bodyLines: string[] = [];

  function collectSection() {
    const body = bodyLines.join("\n").trim();
    bodyLines = [];
    let content: string;
    if (currentLevel > 0) {
      const headerLine = "#".repeat(currentLevel) + " " +
        (currentHeadings[currentHeadings.length - 1] ?? "");
      content = body ? headerLine + "\n\n" + body : headerLine;
    } else {
      content = body;
    }
    if (!content.trim()) return;
    sections.push({
      level: currentLevel,
      headings: [...currentHeadings],
      heading: currentHeadings[currentHeadings.length - 1] ?? "",
      content,
      body,
    });
  }

  for (const line of lines) {
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);

    if (h1) {
      collectSection();
      currentHeadings = [h1[1].trim()];
      currentLevel = 1;
    } else if (h2) {
      collectSection();
      currentHeadings = [currentHeadings[0] ?? "", h2[1].trim()].filter(Boolean);
      currentLevel = 2;
    } else if (h3) {
      collectSection();
      currentHeadings = [
        currentHeadings[0] ?? "",
        currentHeadings[1] ?? "",
        h3[1].trim(),
      ].filter(Boolean);
      currentLevel = 3;
    } else {
      bodyLines.push(line);
    }
  }
  collectSection();
  return sections;
}

function makeChunk(headings: string[], level: number, content: string): Chunk {
  const title = headings[headings.length - 1] ?? "";
  return {
    heading_path: [...headings],
    heading_level: level,
    title,
    content,
    char_count: content.length,
  };
}

function chunkMarkdown(text: string): Chunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // Short-circuit: entire document fits in one chunk
  if (trimmed.length <= MAX_CHUNK_CHARS) {
    return [makeChunk([], 0, trimmed)];
  }

  const sections = parseSections(trimmed);
  const chunks: Chunk[] = [];

  let bufParts: string[] = [];
  let bufHeadings: string[] = [];
  let bufLevel = 0;
  let bufChars = 0;

  function flushBuf() {
    if (bufParts.length === 0) return;
    chunks.push(makeChunk(bufHeadings, bufLevel, bufParts.join("\n\n")));
    bufParts = [];
    bufHeadings = [];
    bufLevel = 0;
    bufChars = 0;
  }

  for (const section of sections) {
    const { level, headings, heading, content, body } = section;

    // Oversized section: flush buffer, then paragraph-split
    if (content.length > MAX_CHUNK_CHARS) {
      flushBuf();
      const headerPrefix = level > 0 ? "#".repeat(level) + " " + heading + "\n\n" : "";
      const bodyToSplit = body || content;
      const paragraphs = bodyToSplit.split(/\n\n+/);
      let sub = "";
      let isFirst = true;
      for (const para of paragraphs) {
        const prefix = isFirst ? headerPrefix : "";
        if (sub.length + prefix.length + para.length + 2 > MAX_CHUNK_CHARS && sub.length > 0) {
          chunks.push(makeChunk(headings, level, sub.trim()));
          sub = para;
          isFirst = false;
        } else {
          sub = sub ? sub + "\n\n" + para : prefix + para;
          isFirst = false;
        }
      }
      if (sub.trim()) chunks.push(makeChunk(headings, level, sub.trim()));
      continue;
    }

    // Section fits -- try to accumulate into the buffer
    const addition = content.length + (bufParts.length > 0 ? 2 : 0);

    if (bufChars + addition <= MAX_CHUNK_CHARS) {
      if (bufParts.length === 0) {
        bufHeadings = headings;
        bufLevel = level;
      }
      bufParts.push(content);
      bufChars += addition;
    } else {
      flushBuf();
      bufParts = [content];
      bufHeadings = headings;
      bufLevel = level;
      bufChars = content.length;
    }
  }

  flushBuf();
  return chunks;
}

// ── Content normalisation + SHA-256 hash ──────────────────────────────────
// Must stay in sync with pipeline.py::_normalize / _hash and cerefox-ingest.

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

// ── Handler ────────────────────────────────────────────────────────────────

export async function handleIngest(
  args: Record<string, unknown>,
  openaiKey: string,
): Promise<string> {
  const title = (args.title as string | undefined)?.trim();
  const content = args.content as string | undefined;
  const project_name = args.project_name as string | undefined;
  const source = (args.source as string | undefined) ?? "agent";
  const metadata = (args.metadata as Record<string, unknown> | undefined) ?? {};
  const update_if_exists = (args.update_if_exists as boolean | undefined) ?? false;
  const author = (args.author as string | undefined) ?? "mcp-agent";
  const author_type = "agent"; // MCP path is always agent

  if (!title || !content?.trim()) {
    throw new Error("title and content are required");
  }

  const supabase = makeSupabaseClient();
  const contentHash = await sha256hex(normalizeContent(content));
  const reviewStatus = author_type === "agent" ? "pending_review" : "approved";

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

      // Content unchanged -- skip re-indexing
      if (existingDoc.content_hash === contentHash) {
        return `Document already up-to-date: "${existingDoc.title}" (id: ${existingDoc.id}). Content hash unchanged.`;
      }

      // Content changed -- re-chunk, re-embed, ingest via RPC
      const chunks = chunkMarkdown(content);
      if (chunks.length === 0) {
        throw new Error("Content produced no chunks");
      }

      const texts = chunks.map((c) => c.content);
      const embeddings = await embedBatch(texts, openaiKey);
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

      if (ingestErr) {
        throw new Error(`Ingest RPC failed: ${ingestErr.message}`);
      }

      logUsage(supabase, {
        operation: "ingest", requestor: author,
        document_id: existingDoc.id, result_count: chunks.length,
      });

      return `Document updated: "${existingDoc.title}" (id: ${existingDoc.id}), ${chunks.length} chunk(s), ${totalChars} chars.`;
    }
    // No existing doc found -- fall through to create path
  }

  // ── Hash deduplication (create path) ────────────────────────────────────
  const { data: hashMatch } = await supabase
    .from("cerefox_documents")
    .select("id, title")
    .eq("content_hash", contentHash)
    .limit(1);

  if (hashMatch?.length) {
    return `Document already up-to-date: "${hashMatch[0].title}" (id: ${hashMatch[0].id}). Content hash unchanged.`;
  }

  // Chunk and embed
  const chunks = chunkMarkdown(content);
  if (chunks.length === 0) {
    throw new Error("Content produced no chunks");
  }

  const texts = chunks.map((c) => c.content);
  const embeddings = await embedBatch(texts, openaiKey);
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

  // Resolve / create project if requested (pure CRUD, separate from ingestion)
  let projectId: string | null = null;
  if (project_name) {
    const { data: proj } = await supabase
      .from("cerefox_projects")
      .select("id")
      .ilike("name", project_name)
      .limit(1);

    if (proj?.length) {
      projectId = proj[0].id;
    } else {
      const { data: newProj } = await supabase
        .from("cerefox_projects")
        .insert({ name: project_name })
        .select("id");
      projectId = newProj?.[0]?.id ?? null;
    }

    if (projectId) {
      await supabase
        .from("cerefox_document_projects")
        .insert({ document_id: documentId, project_id: projectId });
    }
  }

  logUsage(supabase, {
    operation: "ingest", requestor: author,
    document_id: documentId, result_count: chunks.length,
  });

  const projectInfo = project_name ? `, project: "${project_name}"` : "";
  return `Document saved: "${title}" (id: ${documentId}), ${chunks.length} chunk(s), ${totalChars} chars${projectInfo}.`;
}
