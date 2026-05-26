/**
 * Heading-aware markdown chunker.
 *
 * Mirrors:
 * - `src/cerefox/chunking/markdown.py` (Python pipeline)
 * - `supabase/functions/cerefox-ingest/index.ts` (standalone ingest EF)
 *
 * Greedy section accumulation: H1/H2/H3 sections are joined into a buffer
 * until adding the next would exceed `MAX_CHUNK_CHARS`. Oversized sections
 * are paragraph-split. Short documents collapse to a single chunk.
 *
 * The hash of the chunked output (via `_hash.ts:sha256hex(normalizeContent(...))`)
 * must match the Python pipeline byte-for-byte so dedup works across access
 * paths. Don't change chunk boundaries without updating both.
 */

export const MAX_CHUNK_CHARS = 4000;

interface Section {
  level: number;
  headings: string[];
  heading: string;
  content: string;
  body: string;
}

export interface Chunk {
  heading_path: string[];
  heading_level: number;
  title: string;
  content: string;
  char_count: number;
}

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

export function chunkMarkdown(text: string): Chunk[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

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

/** Content-hash normalization. Must match `pipeline.py::_normalize`
 *  byte-for-byte so cross-runtime dedup works. */
export function normalizeContent(text: string): string {
  return text.trim().replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{3,}/g, "\n\n");
}

export async function sha256hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
