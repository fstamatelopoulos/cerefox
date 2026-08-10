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
} from "../../../../../_shared/cli-core/index.ts";
import { c } from "../../../../../_shared/cli-core/index.ts";
import { parseOutline } from "../../../../../_shared/partial-edits/index.ts";
import { getClient } from "../util/client.ts";

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
  options: { versionId?: string; requestor?: string; json?: boolean; outline?: boolean },
): Promise<void> {
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

  const requestor = resolveRequestor(options.requestor);
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
    .option("-r, --requestor <name>", "Agent / user name (usage log).")
    .option("--json", "Emit machine-readable JSON.")
    .option(
      "--outline",
      "Show the heading structure, per-section sizes and content_hash instead of the content. Cheap, and the paths are the anchors the edit commands take.",
    )
    .action(action);
}
