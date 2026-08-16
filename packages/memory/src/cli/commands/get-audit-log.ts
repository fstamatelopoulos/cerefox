/**
 * `cerefox get-audit-log` — query the immutable audit log.
 *
 * Calls `cerefox_list_audit_entries(p_document_id, p_author, p_operation,
 * p_since, p_until, p_limit)`. All filters are optional; the RPC defaults
 * `p_limit` server-side.
 */

import type { Command } from "commander";

import {
  parsePositiveInt,
  printJson,
  printTable,
  resolveRequestor,
  systemError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface AuditRow {
  id: string;
  document_id: string;
  doc_title: string | null;
  version_id: string | null;
  operation: string;
  author: string | null;
  author_type: string | null;
  size_before: number | null;
  size_after: number | null;
  description: string | null;
  created_at: string;
}

async function action(options: {
  documentId?: string;
  author?: string;
  operation?: string;
  since?: string;
  until?: string;
  limit?: string;
  requestor?: string;
  json?: boolean;
}): Promise<void> {
  const limit = parsePositiveInt(options.limit, "--limit", 50);
  const client = getClient();

  const data = await client.rpc<AuditRow[]>("cerefox_list_audit_entries", {
    p_document_id: options.documentId ?? null,
    p_author: options.author ?? null,
    p_operation: options.operation ?? null,
    p_since: options.since ?? null,
    p_until: options.until ?? null,
    p_limit: Math.min(limit, 200),
  });

  if (data === null) {
    throw systemError(
      "Could not list audit entries: RPC returned no data.",
      "Verify cerefox_list_audit_entries is deployed.",
    );
  }

  const requestor = resolveRequestor(options.requestor);
  client.raw
    .rpc("cerefox_log_usage", {
      p_operation: "get_audit_log",
      p_access_path: "cli",
      p_requestor: requestor,
    })
    .then(() => {}, () => {});

  if (options.json) {
    printJson(data);
    return;
  }

  if (data.length === 0) {
    process.stdout.write("(no audit entries match the filters)\n");
    return;
  }

  printTable(
    data.map((row) => ({
      // Keep the zone: a bare "2026-08-11 06:32:13" reads as local (#199).
      when: `${(row.created_at ?? "").slice(0, 19).replace("T", " ")}Z`,
      operation: row.operation,
      doc: ((row.doc_title ??
        (row.document_id
          ? row.document_id.slice(0, 8) + "…"
          : /^(config-change|project-)/.test(row.operation ?? "")
            ? "(store)"
            : "(purged)")) as string).slice(0, 40),
      author: (row.author ?? "") + (row.author_type ? `(${row.author_type})` : ""),
      size_delta:
        row.size_before !== null && row.size_after !== null
          ? `${row.size_before} → ${row.size_after}`
          : "",
    })),
  );
}

export function registerGetAuditLog(program: Command): void {
  program
    .command("get-audit-log")
    .description("Query the audit log with optional filters.")
    .option("-d, --document-id <uuid>", "Filter by document.")
    .option("-a, --author <name>", "Filter by author.")
    .option(
      "-o, --operation <type>",
      "Filter by operation: create, update-content, update-metadata, insert, replace-section, delete-section, rename-section, delete, restore, status-change, archive, unarchive, config-change, project-create, project-edit, project-delete.",
    )
    .option("--since <iso>", "Lower-bound ISO timestamp.")
    .option("--until <iso>", "Upper-bound ISO timestamp.")
    .option("-l, --limit <n>", "Maximum entries (max 200).", "50")
    .option("-r, --requestor <name>", "Agent / user name (usage log).")
    .option("--json", "Emit machine-readable JSON.")
    .action(action);
}
