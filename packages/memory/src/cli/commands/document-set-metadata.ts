/**
 * `cerefox document set-metadata` — change a document's tags without resending
 * its content (#204).
 *
 * CLI counterpart to `cerefox_set_document_metadata`, shipped in the same
 * change as the MCP tool. #201 is the standing lesson: the section read went out
 * on the MCP path alone and was unreachable from a terminal for a whole release,
 * because nothing compares the two surfaces.
 *
 * Both call the same RPC, so the merge semantics cannot drift between them:
 * merge by default, a `null` value removes a key (RFC 7386), `--replace` sets
 * the metadata to exactly what was given.
 */

import type { Command } from "commander";

import {
  c,
  notFound,
  printJson,
  println,
  systemError,
  userError,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface SetMetadataResult {
  document_id: string;
  metadata: Record<string, unknown>;
  keys_set: number;
  keys_removed: number;
}

async function action(
  documentId: string,
  options: {
    set?: string[];
    remove?: string[];
    json?: string;
    replace?: boolean;
    author?: string;
    authorType?: string;
    jsonOut?: boolean;
  },
): Promise<void> {
  // Three ways to say the same thing, because the shapes suit different callers:
  // `--set k=v` for a human at a terminal, `--remove k` because typing
  // `--set k=null` to delete is unintuitive on a command line even though that
  // is what goes over the wire, and `--json` for scripts that already hold an
  // object.
  const patch: Record<string, unknown> = {};

  if (options.json) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(options.json);
    } catch (err) {
      throw userError(`--json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw userError("--json must be a JSON object, e.g. '{\"type\":\"note\",\"stale\":null}'");
    }
    Object.assign(patch, parsed);
  }

  for (const pair of options.set ?? []) {
    const eq = pair.indexOf("=");
    if (eq <= 0) {
      throw userError(`--set expects key=value, got ${JSON.stringify(pair)}`);
    }
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    // Values are JSON strings by convention — a metadata_filter matches JSONB as
    // strings, so a bare `true` would never match a stored "true". Accept JSON
    // when it parses to a string, otherwise treat the value as literal text.
    let value: unknown = raw;
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
      try {
        value = JSON.parse(raw);
      } catch {
        /* keep the literal text */
      }
    }
    patch[key] = value;
  }

  for (const key of options.remove ?? []) {
    patch[key] = null;
  }

  if (Object.keys(patch).length === 0 && !options.replace) {
    throw userError(
      "Nothing to change. Pass --set key=value, --remove key, or --json '{...}'. " +
        "To clear all metadata use --replace --json '{}'.",
    );
  }

  const client = getClient();
  let rows: SetMetadataResult[] | null;
  try {
    rows = await client.rpc<SetMetadataResult[]>("cerefox_set_document_metadata", {
      p_document_id: documentId,
      p_metadata: patch,
      p_replace: Boolean(options.replace),
      p_author: options.author ?? "cli-user",
      p_author_type: options.authorType === "agent" ? "agent" : "user",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found/i.test(msg)) throw notFound(`Document ${documentId} not found (or is deleted).`);
    throw systemError(`Could not set metadata: ${msg}`);
  }

  if (!rows || rows.length === 0) {
    throw systemError(
      "cerefox_set_document_metadata returned no data.",
      "Verify the RPC is deployed: `cerefox server deploy`.",
    );
  }
  const row = rows[0];

  if (options.jsonOut) {
    printJson(row);
    return;
  }

  const verb = options.replace ? "Replaced" : "Merged";
  if (row.keys_set === 0 && row.keys_removed === 0) {
    // Say so rather than implying work happened — setting a key to the value it
    // already held is a no-op, and a caller re-running a script should see that.
    println(c.green(`✓ ${verb} metadata on ${documentId} — no change (every key already held that value).`));
  } else {
    println(
      c.green(
        `✓ ${verb} metadata on ${documentId}: ${row.keys_set} key(s) set, ${row.keys_removed} removed.`,
      ),
    );
  }
  println(c.dim(`  Now: ${JSON.stringify(row.metadata ?? {})}`));
  println(c.dim("  Content untouched — no new version, no re-embedding."));
}

export function registerDocumentSetMetadata(parent: Command): void {
  parent
    .command("set-metadata")
    .description("Change a document's metadata without resending its content (merges by default).")
    .argument("<document-id>", "UUID of the document.")
    .option(
      "-s, --set <key=value...>",
      "Set a key. Repeatable. Values are stored as JSON strings; quote to force JSON parsing.",
    )
    .option("-r, --remove <key...>", "Remove a key. Repeatable. (Sends a JSON null.)")
    .option("--json <object>", "A JSON object of keys to set; a null value removes that key.")
    .option(
      "--replace",
      "Set the metadata to EXACTLY what was given, discarding every key not listed. Default is merge.",
    )
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .option("--json-out", "Emit the result as JSON.")
    .action(action);
}
