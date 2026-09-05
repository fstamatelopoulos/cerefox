/**
 * `cerefox list-metadata-keys` — discover available metadata keys + counts.
 *
 * Calls the existing `cerefox_list_metadata_keys` RPC — same path the MCP
 * tool uses.
 */

import type { Command } from "commander";

import {
  printJson,
  printTable,
  resolveRequestor,
  systemError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";
import { authorOption, requestorAliasOption } from "../util/identity-flags.js";

interface MetadataKeyRow {
  key: string;
  doc_count: number;
  example_values: string[];
}

async function action(options: { author?: string; requestor?: string; json?: boolean }): Promise<void> {
  const client = getClient();
  const data = await client.rpc<MetadataKeyRow[]>("cerefox_list_metadata_keys");
  if (data === null) {
    throw systemError(
      "Could not list metadata keys: RPC returned no data.",
      "Verify cerefox_list_metadata_keys is deployed (run `db_deploy.py`).",
    );
  }

  const requestor = resolveRequestor(options.author ?? options.requestor);
  client.raw
    .rpc("cerefox_log_usage", {
      p_operation: "list_metadata_keys",
      p_access_path: "cli",
      p_requestor: requestor,
    })
    .then(() => {}, () => {});

  if (options.json) {
    printJson(data);
    return;
  }

  if (data.length === 0) {
    process.stdout.write("No metadata keys found across documents.\n");
    return;
  }

  printTable(
    data.map((row) => ({
      key: row.key,
      doc_count: row.doc_count,
      example_values: (row.example_values ?? []).slice(0, 3).join(", "),
    })),
  );
}

export function registerListMetadataKeys(program: Command): void {
  program
    .command("list-metadata-keys")
    .description("List all metadata keys with document counts and example values.")
    .addOption(authorOption("read"))
    .addOption(requestorAliasOption())
    .option("--json", "Emit machine-readable JSON.")
    .action(action);
}
