/**
 * `cerefox get-doc <document-id>` — retrieve a full document by ID.
 *
 * Calls `cerefox_get_document(p_document_id, p_version_id)`. Returns the
 * reconstructed full content (current version by default, or a specific
 * archived version when `--version-id` is supplied).
 */

import type { Command } from "commander";

import {
  notFound,
  printJson,
  println,
  resolveRequestor,
  systemError,
  userError,
} from "../../../../../_shared/cli-core/index.ts";
import { c } from "../../../../../_shared/cli-core/index.ts";
import { extractSection, parseOutline } from "../../../../../_shared/partial-edits/index.ts";
import { getClient } from "../util/client.ts";
import { authorOption, requestorAliasOption } from "../util/identity-flags.js";

interface DocPayload {
  document_id: string;
  doc_title: string;
  full_content: string;
  chunk_count: number;
  total_chars: number;
  is_archived: boolean;
  version_id: string | null;
  content_hash: string | null;
}

async function action(
  documentId: string,
  options: {
    versionId?: string;
    author?: string;
    requestor?: string;
    json?: boolean;
    outline?: boolean;
    section?: string;
    sectionPart?: "own_body" | "subtree";
  },
): Promise<void> {
  const section = (options.section ?? "").trim() || null;
  // Same refusals as the MCP tool (#201): these two answer "what is in this
  // document" at different zoom levels, and silently preferring one would make
  // the other's absence look like an empty result.
  if (section && options.outline) {
    throw userError(
      "Pass either --outline (the whole structure) or --section (one section's text), not both.",
    );
  }
  if (options.sectionPart && !section) {
    throw userError("--section-part only applies together with --section.");
  }

  const client = getClient();

  const rows = await client.rpc<DocPayload[]>("cerefox_get_document", {
    p_document_id: documentId,
    p_version_id: options.versionId ?? null,
  });

  if (rows === null) {
    throw systemError(
      "Could not retrieve document: RPC returned no data.",
      "Verify cerefox_get_document is deployed.",
    );
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    throw notFound(
      options.versionId
        ? `Version ${options.versionId} of document ${documentId} not found.`
        : `Document ${documentId} not found.`,
    );
  }

  const doc = rows[0];

  const requestor = resolveRequestor(options.author ?? options.requestor);
  client.raw
    .rpc("cerefox_log_usage", {
      p_operation: "get_document",
      p_access_path: "cli",
      p_requestor: requestor,
      p_document_id: documentId,
    })
    .then(() => {}, () => {});

  // Outline mode (iter-34): structure, sizes and the concurrency token, no body.
  // The paths printed here are exactly what `document insert --anchor` and the
  // MCP edit tools accept, so this is the cheap first step before an edit.
  if (options.outline) {
    const nodes = parseOutline(doc.full_content ?? "");
    if (options.json) {
      printJson({
        title: doc.doc_title,
        content_hash: doc.content_hash,
        total_chars: doc.total_chars,
        outline: nodes.map((n) => ({ path: n.path, level: n.level, chars: n.chars })),
      });
      return;
    }
    println(c.bold(`# ${doc.doc_title}`));
    println(c.dim(`[${doc.document_id}] · chars: ${doc.total_chars}`));
    if (doc.content_hash) println(c.dim(`content_hash: ${doc.content_hash}`));
    println("");
    if (nodes.length === 0) {
      println(c.dim("No headings: only --position end_of_document applies to this document."));
      return;
    }
    for (const n of nodes) {
      println(`${"  ".repeat(Math.max(0, n.level - 1))}${n.heading}  ${c.dim(`(${n.chars} chars)`)}`);
    }
    println("");
    println(c.dim("Anchor with the full path when a heading repeats, e.g."));
    println(c.dim(`  --anchor ${JSON.stringify(nodes[nodes.length - 1].path)}`));
    return;
  }

  // Section mode (#201): one section's text, so a replace is not a blind
  // overwrite. This shipped on the MCP path in v1.4.0 and not here, because
  // `document edit-parts` takes an opaque operations array (so a new OPERATION
  // reaches the CLI for free) while this command takes declared flags (so a new
  // READ MODE does not). Same extractSection as the MCP tool and the write
  // path, so what this prints is exactly what a replace_section would destroy.
  if (section) {
    let extracted;
    try {
      extracted = extractSection(doc.full_content ?? "", section, options.sectionPart);
    } catch (err) {
      throw userError(err instanceof Error ? err.message : String(err));
    }
    // The RPC returns the CURRENT hash even for an archived version, and
    // pairing it with archived text would invite an edit based on content that
    // is no longer there — same reasoning as outline mode.
    const archived = Boolean(options.versionId);
    if (options.json) {
      printJson({
        title: doc.doc_title,
        heading: extracted.heading,
        path: extracted.path,
        level: extracted.level,
        section_part: extracted.section_part,
        chars: extracted.chars,
        content_hash: archived ? null : (doc.content_hash ?? null),
        text: extracted.text,
      });
      return;
    }
    println(c.bold(extracted.heading));
    println(
      c.dim(
        `[${doc.document_id}] · ${extracted.path} · ${extracted.chars} chars` +
          (extracted.section_part ? ` · ${extracted.section_part}` : "") +
          (archived ? " · archived" : ""),
      ),
    );
    if (!archived && doc.content_hash) println(c.dim(`content_hash: ${doc.content_hash}`));
    println("");
    println(extracted.text);
    return;
  }

  if (options.json) {
    printJson(doc);
    return;
  }

  // Human-readable rendering matches the Python CLI: header line, metadata
  // line, blank, then full content.
  println(c.bold(`# ${doc.doc_title}`));
  println(
    c.dim(
      `[${doc.document_id}] · chunks: ${doc.chunk_count} · chars: ${doc.total_chars}` +
        (doc.is_archived ? " · archived" : "") +
        (doc.version_id ? ` · version: ${doc.version_id}` : ""),
    ),
  );
  // The concurrency token: pass back via `document ingest
  // --expected-content-hash` when updating this document (iter-32).
  if (doc.content_hash) {
    println(c.dim(`content_hash: ${doc.content_hash}`));
  }
  println("");
  println(doc.full_content);
}

export function registerGetDoc(program: Command): void {
  program
    .command("get-doc")
    .description("Retrieve the full content of a document by ID.")
    .argument("<document-id>", "UUID of the document.")
    .option("--version-id <uuid>", "Specific archived version (default: current).")
    .addOption(authorOption("read"))
    .addOption(requestorAliasOption())
    .option("--json", "Emit machine-readable JSON.")
    .option(
      "--outline",
      "Show the heading structure, per-section sizes and content_hash instead of the content. Cheap, and the paths are the anchors the edit commands take.",
    )
    .option(
      "--section <anchor>",
      "Show ONE section's text instead of the whole document: exactly what a replace_section on this anchor would overwrite. Pass the bare heading line when it is unique, or the full ' > ' path from --outline when it repeats.",
    )
    .option(
      "--section-part <part>",
      "own_body | subtree — only when the target section has child sections, where 'the end' means two different places. You are told (with both options) whenever it is needed.",
    )
    .action(action);
}
