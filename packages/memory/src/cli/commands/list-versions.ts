/**
 * `cerefox list-versions <document-id>` — version history.
 *
 * Calls `cerefox_list_document_versions(p_document_id uuid)`. Output
 * matches the shape used by the MCP tool + the web UI's version-history
 * panel.
 */

import type { Command } from "commander";

import {
  notFound,
  printJson,
  printTable,
  resolveRequestor,
  systemError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface VersionRow {
  version_id: string;
  version_number: number;
  source: string;
  chunk_count: number;
  total_chars: number;
  archived: boolean;
  created_at: string;
}

async function action(
  documentId: string,
  options: { requestor?: string; json?: boolean },
): Promise<void> {
  const client = getClient();
  const data = await client.rpc<VersionRow[]>("cerefox_list_document_versions", {
    p_document_id: documentId,
  });
  if (data === null) {
    throw systemError(
      "Could not list versions: RPC returned no data.",
      "Verify cerefox_list_document_versions is deployed.",
    );
  }

  // Empty result on a real ID is "no archived versions yet" — not an error.
  // But if the document itself doesn't exist, we want to surface that.
  if (data.length === 0) {
    const { data: doc, error } = await client.raw
      .from("cerefox_documents")
      .select("id")
      .eq("id", documentId)
      .maybeSingle();
    if (error || !doc) {
      throw notFound(`Document ${documentId} not found.`);
    }
  }

  const requestor = resolveRequestor(options.requestor);
  client.raw
    .rpc("cerefox_log_usage", {
      p_operation: "list_versions",
      p_access_path: "cli",
      p_requestor: requestor,
      p_document_id: documentId,
    })
    .then(() => {}, () => {});

  if (options.json) {
    printJson(data);
    return;
  }

  if (data.length === 0) {
    process.stdout.write(`No archived versions for ${documentId}.\n`);
    return;
  }

  printTable(
    data.map((v) => ({
      version_number: v.version_number,
      version_id: v.version_id,
      source: v.source,
      chunks: v.chunk_count,
      chars: v.total_chars,
      archived: v.archived,
      created_at: v.created_at,
    })),
  );
}

export function registerListVersions(program: Command): void {
  program
    .command("list-versions")
    .description("List archived versions of a document.")
    .argument("<document-id>", "UUID of the document.")
    .option("-r, --requestor <name>", "Agent / user name (usage log).")
    .option("--json", "Emit machine-readable JSON.")
    .action(action);
}
