/**
 * `cerefox_get_document` — retrieve full document content by ID. Pass
 * `version_id` (from `cerefox_list_versions`) to retrieve an archived
 * version; omit for the current version.
 */

import type { MCPSupabaseClient } from "./types.ts";

import { extractSection, parseOutline } from "../partial-edits/index.ts";
import { logUsage } from "./_utils.ts";
import { McpInvalidParams, type ToolContext, type ToolDefinition } from "./types.ts";

async function handler(
  supabase: MCPSupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const document_id = args.document_id as string | undefined;
  const version_id = (args.version_id as string | null | undefined) ?? null;
  const outline = (args.outline as boolean | undefined) ?? false;
  const section = ((args.section as string | undefined) ?? "").trim() || null;
  const section_part = (args.section_part as "own_body" | "subtree" | undefined) ?? undefined;

  if (!document_id) throw new McpInvalidParams("document_id is required");
  if (section && outline) {
    // Both answer "what is in this document" at different zoom levels, and
    // silently preferring one would make the other's absence look like an empty
    // result. Refuse instead of choosing.
    throw new McpInvalidParams(
      "Pass either outline (the whole structure) or section (one section's text), not both.",
    );
  }
  if (section_part && !section) {
    throw new McpInvalidParams("section_part only applies together with section.");
  }

  const { data, error } = await supabase.rpc("cerefox_get_document", {
    p_document_id: document_id,
    p_version_id: version_id,
  });

  if (error) throw new Error(`RPC error: ${error.message}`);

  const row = data?.[0] as
    | {
        doc_title?: string;
        full_content?: string;
        chunk_count?: number;
        total_chars?: number;
        content_hash?: string;
      }
    | undefined;

  if (!row) return "Document not found.";

  logUsage(supabase, {
    operation: "get_document",
    accessPath: ctx.accessPath,
    requestor: args.requestor as string | undefined,
    document_id,
    result_count: 1,
  });

  // Outline mode (iteration 34): structure without the body. Anchored edits
  // presuppose known headings, and without this an agent that has not read the
  // document must pay a full read just to learn them — the cost partial edits
  // exist to remove. Paths come back in exactly the form anchor_heading accepts,
  // so an entry can be pasted into an edit verbatim.
  if (outline) {
    const nodes = parseOutline(row.full_content ?? "").map((n) => ({
      path: n.path,
      level: n.level,
      chars: n.chars,
    }));
    // The RPC always returns the CURRENT hash, even when reconstructing an
    // archived version. Handing that back alongside an archived structure would
    // invite the one silent failure this design otherwise refuses: an anchor
    // read from an old version, a token valid for the current one, and an edit
    // that lands wherever that heading happens to sit today. Withhold the token
    // instead — the archived outline is for reading.
    const archived = version_id !== null;
    return JSON.stringify(
      {
        title: row.doc_title ?? "Untitled",
        content_hash: archived ? null : (row.content_hash ?? null),
        total_chars: row.total_chars ?? (row.full_content ?? "").length,
        outline: nodes,
        note: archived
          ? "This is an ARCHIVED version's structure, so no content_hash is returned: these anchors describe the old version and must not be used to edit the current one. Re-read without version_id to edit."
          : nodes.length === 0
            ? "This document has no headings, so it has no anchors: only end_of_document inserts apply."
            : "Use a path as anchor_heading in cerefox_insert / cerefox_edit; content_hash is your expected_content_hash.",
      },
      null,
      2,
    );
  }

  // Section mode (#198): one section's text, so a replace_section is not a
  // blind overwrite. The extent comes from the same resolver the write uses —
  // what this returns is exactly what replace_section would destroy.
  if (section) {
    const extracted = extractSection(row.full_content ?? "", section, section_part);
    // Same reasoning as outline mode: the RPC returns the CURRENT hash even when
    // reconstructing an archived version, and pairing it with archived text
    // would invite an edit based on content that is no longer there.
    const archived = version_id !== null;
    return JSON.stringify(
      {
        title: row.doc_title ?? "Untitled",
        heading: extracted.heading,
        path: extracted.path,
        level: extracted.level,
        section_part: extracted.section_part,
        chars: extracted.chars,
        content_hash: archived ? null : (row.content_hash ?? null),
        text: extracted.text,
        note: archived
          ? "This is an ARCHIVED version's section, so no content_hash is returned: it must not be used to edit the current document."
          : "This is exactly the text a replace_section on this anchor would overwrite (the heading itself is kept). content_hash is your expected_content_hash.",
      },
      null,
      2,
    );
  }

  const label = version_id !== null ? " (archived version)" : " (current)";
  // content_hash is the optimistic-concurrency token: pass it back as
  // expected_content_hash when updating this document via cerefox_ingest.
  const hashLine = row.content_hash ? `content_hash: ${row.content_hash}\n\n` : "";
  return `# ${row.doc_title ?? "Untitled"}${label}\n${hashLine}${row.full_content ?? ""}`;
}

export const getDocumentTool: ToolDefinition = {
  name: "cerefox_get_document",
  description:
    "Retrieve a document at one of three zoom levels: the whole reconstructed content (default), its heading structure with outline=true (much cheaper, and the headings are the anchors the edit tools take), or one section's text with section=\"## Heading\" (what a replace_section on that anchor would overwrite — read it before replacing a section you did not write). Pass version_id to retrieve an archived version; omit it (or pass null) for the current version. Version UUIDs are returned by cerefox_list_versions. Every non-archived response carries the document's current content_hash — pass it back as expected_content_hash when updating (optimistic concurrency).",
  // Read-only: touches nothing. Safe for a client to run without prompting.
  annotations: {
    title: "Read document",
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  inputSchema: {
    type: "object",
    required: ["document_id"],
    properties: {
      document_id: { type: "string", description: "UUID of the document to retrieve" },
      version_id: {
        type: "string",
        description: "UUID of a specific archived version to retrieve (optional)",
      },
      outline: {
        type: "boolean",
        description:
          "Return the document's STRUCTURE instead of its content: heading paths, levels and per-section sizes, plus content_hash and total size. Far cheaper than a full read. Every heading listed is addressable by cerefox_insert / cerefox_edit: pass the bare heading line (e.g. '## Daily Logs') when it occurs once in the document, and only the full ' > ' path shown here when the same heading text repeats. Use this before editing a document you have not read.",
      },
      section: {
        type: "string",
        description:
          "Return ONE section's text instead of the whole document: the anchor heading, exactly as cerefox_insert / cerefox_edit take it (bare heading line when unique, ' > ' path when it repeats). What comes back is precisely the text a replace_section on this anchor would overwrite, so read it before replacing a section you did not write. The heading itself is returned separately, because replace_section keeps it. Cannot be combined with outline.",
      },
      section_part: {
        type: "string",
        enum: ["own_body", "subtree"],
        description:
          "Only when the target section HAS CHILD SECTIONS, and it means the same here as on the edit tools: own_body = up to the first child, subtree = everything nested underneath. The read refuses without it for exactly the cases the write refuses, so that what you read is what you would replace. Omit it otherwise; you will be told (with both options) whenever it is needed.",
      },
      requestor: {
        type: "string",
        description:
          'Name of the agent or user making this request. Recorded in the usage log. Defaults to "mcp-agent" if not provided. May be enforced via server config.',
      },
    },
  },
  handler,
};
