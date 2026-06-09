/**
 * `cerefox document set-projects <document-id> [project-names...]` — replace a
 * document's project memberships with EXACTLY the given set (full-set replace,
 * matching the `cerefox_set_document_projects` MCP tool). `--clear` removes all
 * memberships. Writes an `update-metadata` audit entry; document content is
 * untouched.
 *
 * Closes the CLI↔MCP parity gap: the MCP tool had no CLI equivalent. The
 * membership-replace logic is shared with the MCP tool via
 * `_shared/mcp-tools/_projects.ts → replaceDocumentProjects`.
 */

import type { Command } from "commander";

import {
  c,
  println,
  resolveAuthor,
  resolveAuthorType,
  userError,
  warn,
} from "../../../../../_shared/cli-core/index.ts";
import { replaceDocumentProjects } from "../../../../../_shared/mcp-tools/_projects.ts";
import type { MCPSupabaseClient } from "../../../../../_shared/mcp-tools/types.ts";
import { getClient } from "../util/client.ts";

interface SetProjectsOptions {
  clear?: boolean;
  author?: string;
  authorType?: string;
}

async function action(
  documentId: string,
  projectNames: string[],
  options: SetProjectsOptions,
): Promise<void> {
  const names = projectNames ?? [];

  if (options.clear && names.length > 0) {
    throw userError(
      "Pass either project names or --clear, not both.",
      "Use --clear on its own to remove the document from all projects.",
    );
  }
  if (!options.clear && names.length === 0) {
    throw userError(
      "No project names given.",
      "Pass one or more project names, or --clear to remove all memberships.",
    );
  }

  const author = resolveAuthor(options.author);
  const authorType = resolveAuthorType(options.authorType);
  if (author === "unknown") {
    warn("No --author / CEREFOX_AUTHOR_NAME set — audit log will record this as 'unknown'.");
  }

  const client = getClient();
  const { documentTitle, cleanNames } = await replaceDocumentProjects(
    client.raw as unknown as MCPSupabaseClient,
    {
      documentId,
      projectNames: names,
      author,
      authorType,
      accessPath: "cli",
    },
  );

  if (cleanNames.length === 0) {
    println(c.green(`✓ Cleared all project memberships for "${documentTitle}" (id: ${documentId}).`));
    return;
  }
  println(
    c.green(`✓ Set ${cleanNames.length} project membership(s) for "${documentTitle}" (id: ${documentId}).`),
  );
  println(c.dim(`  Projects: ${cleanNames.join(", ")}`));
  println(c.dim("  This REPLACED the previous set — any project not listed is no longer associated."));
}

export function registerDocumentSetProjects(parent: Command): void {
  parent
    .command("set-projects")
    .description(
      "Replace a document's project memberships with exactly the given set (or --clear to remove all).",
    )
    .argument("<document-id>", "UUID of the document.")
    .argument(
      "[project-names...]",
      "Project names to set (created if missing). Omit and pass --clear to remove all.",
    )
    .option("--clear", "Remove the document from all projects.")
    .option("-a, --author <name>", "Caller identity (audit log).")
    .option("--author-type <type>", "'user' or 'agent' (default: user).", "user")
    .action(action);
}
