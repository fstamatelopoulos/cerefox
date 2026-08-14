/**
 * `cerefox document dead-links` — whole-KB sweep for [Text](uuid) links whose
 * target document no longer exists (purged after linking).
 *
 * Phase 2 of link integrity (#214). The write-time guard (v1.7.0) validates
 * only links a write INTRODUCES, deliberately: a pre-existing dead link must
 * not make its document unwritable. This command finds those legacy dead
 * links on demand. A trashed target still exists and is NOT reported —
 * restore or purge decides its fate first.
 *
 * Full chunk scan server-side (one RPC call); run on demand, not in doctor.
 */

import type { Command } from "commander";

import { c, printJson, println, systemError } from "../../../../../_shared/cli-core/index.ts";
import { isMissingFunctionError } from "../../../../../_shared/mcp-tools/_utils.ts";
import { getClient } from "../util/client.ts";

interface DeadLinkRow {
  document_id: string;
  document_title: string;
  dead_link_id: string;
  occurrences: number;
}

const SERVER_BEHIND =
  "The sweep did not run: this server has no cerefox_find_dead_links (needs schema 0.12.2). " +
  "Run `cerefox server deploy`, then retry.";

async function action(options: { json?: boolean }): Promise<void> {
  const client = getClient();
  // NEVER report a clean sweep for a sweep that did not run: the shared rpc()
  // wrapper maps "function does not exist" to null, and PostgREST's PGRST202
  // throws — both mean the server predates 0.12.2, not "no dead links".
  let rows: DeadLinkRow[] | null;
  try {
    rows = await client.rpc<DeadLinkRow[]>("cerefox_find_dead_links", {});
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (isMissingFunctionError(message, "cerefox_find_dead_links")) {
      throw systemError(SERVER_BEHIND);
    }
    throw e;
  }
  if (rows === null) throw systemError(SERVER_BEHIND);

  if (options.json) {
    printJson(rows);
    return;
  }
  if (rows.length === 0) {
    println(c.green("✓ No dead document links found."));
    return;
  }
  println(c.yellow(`${rows.length} dead link(s) across ${new Set(rows.map((r) => r.document_id)).size} document(s):`));
  for (const r of rows) {
    println(`  ${r.document_title} (${r.document_id})`);
    println(c.dim(`    → [Text](${r.dead_link_id}) ×${r.occurrences} — target no longer exists`));
  }
  println(
    c.dim(
      `Fix each by editing the linking document (correct the id, remove the link, or backtick it as an example). ` +
        `The write-time guard prevents NEW dead links; these predate it or lost their target to a purge.`,
    ),
  );
}

export function registerDocumentDeadLinks(program: Command): void {
  program
    .command("dead-links")
    .description("Find [Text](uuid) links whose target document no longer exists (#214 phase 2).")
    .option("--json", "Machine-readable output.")
    .action(action);
}
