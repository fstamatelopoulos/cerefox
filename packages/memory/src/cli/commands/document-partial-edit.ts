/**
 * `cerefox document insert` and `cerefox document edit-parts` — the CLI face of
 * the partial-edit tools (iteration 34).
 *
 * Both go through the same `_shared/mcp-tools` handlers the MCP server uses, so
 * CLI and agent behaviour cannot diverge: same anchors, same ambiguity refusals,
 * same concurrency contract, same audit entries. The only difference is the
 * author type recorded (`user` here, `agent` over MCP).
 *
 * The verb is `edit-parts`, not `edit`: `cerefox document edit` already exists
 * and edits metadata. Renaming it would break scripts for a feature nobody has
 * asked to rename (see CLAUDE.md on renames being breaking).
 *
 * Intended for scripts more than for typing. A human with the document open in
 * the web UI should just edit it there; this exists so an automation can make
 * the same surgical change an agent would, without reproducing the document.
 */

import { readFileSync } from "node:fs";

import type { Command } from "commander";

import { c, println, resolveAuthor, userError } from "../../../../../_shared/cli-core/index.ts";
import { TOOLS_BY_NAME } from "../../../../../_shared/mcp-tools/index.ts";
import type { MCPSupabaseClient, ToolContext } from "../../../../../_shared/mcp-tools/types.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { getClient } from "../util/client.ts";
import { authorOption, requestorAliasOption } from "../util/identity-flags.js";

/** Read a value given literally, or from a file, or from stdin when `-`. */
function resolveText(value: string | undefined, what: string): string {
  if (value === undefined) throw userError(`${what} is required.`);
  if (value === "-") return readFileSync(0, "utf8");
  if (value.startsWith("@")) return readFileSync(value.slice(1), "utf8");
  return value;
}

function context(): ToolContext {
  const settings = loadSettings();
  return {
    accessPath: "cli",
    openaiApiKey: settings.openaiApiKey ?? "",
  } as ToolContext;
}

async function runTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<void> {
  const client = getClient();
  const supabase = client.raw as unknown as MCPSupabaseClient;
  const tool = TOOLS_BY_NAME[toolName];
  try {
    const result = await tool.handler(supabase, args, context());
    println(result);
  } catch (err) {
    // Handler errors are already written for a reader: anchor candidates,
    // conflict recovery steps, section_part options. Pass them through rather
    // than wrapping them in CLI phrasing that would bury the useful part.
    throw userError(err instanceof Error ? err.message : String(err));
  }
}

interface InsertOptions {
  text?: string;
  position?: string;
  anchorHeading?: string;
  sectionPart?: string;
  expectedContentHash?: string;
  author?: string;
  requestor?: string;
  authorType?: string;
}

export function registerDocumentInsert(program: Command): void {
  program
    .command("insert <document-id>")
    .description("Add text to a document without resending it (purely additive)")
    .requiredOption(
      "-t, --text <text>",
      "Markdown to insert. Use '-' for stdin or '@path' for a file.",
    )
    .option(
      "-p, --position <position>",
      "end_of_document | end_of_section | after_heading | before_heading",
      "end_of_document",
    )
    .option("-a, --anchor-heading <heading>", "Heading line, or a ' > ' path. Required unless end_of_document.")
    .option("--section-part <part>", "own_body | subtree — required when the target section has child sections")
    .requiredOption(
      "-e, --expected-content-hash <hash>",
      "content_hash you are basing this on (cerefox document get --outline shows it)",
    )
    .addOption(authorOption("write", { short: false }))
    .addOption(requestorAliasOption())
    .option(
      "--author-type <type>",
      "user (default for the CLI) or agent, when scripting on an agent's behalf",
      "user",
    )
    .action(async (documentId: string, options: InsertOptions) => {
      await runTool("cerefox_insert", {
        document_id: documentId,
        text: resolveText(options.text, "--text"),
        position: options.position,
        ...(options.anchorHeading ? { anchor_heading: options.anchorHeading } : {}),
        ...(options.sectionPart ? { section_part: options.sectionPart } : {}),
        expected_content_hash: options.expectedContentHash,
        author: resolveAuthor(options.author ?? options.requestor),
        ...(options.authorType ? { author_type: options.authorType } : {}),
      });
    });
}

interface EditPartsOptions {
  operations?: string;
  expectedContentHash?: string;
  author?: string;
  requestor?: string;
  authorType?: string;
}

export function registerDocumentEditParts(program: Command): void {
  program
    .command("edit-parts <document-id>")
    .description("Apply one or more section edits atomically (insert/replace/delete)")
    .requiredOption(
      "-o, --operations <json>",
      "JSON array of operations. Use '-' for stdin or '@path' for a file.",
    )
    .requiredOption("-e, --expected-content-hash <hash>", "content_hash you are basing these edits on")
    .addOption(authorOption("write", { short: false }))
    .addOption(requestorAliasOption())
    .option(
      "--author-type <type>",
      "user (default for the CLI) or agent, when scripting on an agent's behalf",
      "user",
    )
    .action(async (documentId: string, options: EditPartsOptions) => {
      const raw = resolveText(options.operations, "--operations");
      let operations: unknown;
      try {
        operations = JSON.parse(raw);
      } catch (err) {
        throw userError(
          `--operations is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          `Expected an array, e.g.\n  ${c.dim(
            '[{"op":"replace_section","anchor_heading":"## Totals","text":"Calories: 1450"}]',
          )}`,
        );
      }
      await runTool("cerefox_edit", {
        document_id: documentId,
        operations,
        expected_content_hash: options.expectedContentHash,
        author: resolveAuthor(options.author ?? options.requestor),
        ...(options.authorType ? { author_type: options.authorType } : {}),
      });
    });
}
