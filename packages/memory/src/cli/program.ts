/**
 * `cerefox` CLI program builder.
 *
 * Owns the commander.Command tree. v0.9.0 reorganized the surface into a
 * resource-verb shape (`cerefox <resource> <verb>`): document, project,
 * version, metadata, audit, config, backup, server. The primary verb
 * (`search`) and lifecycle/server commands stay flat.
 *
 * Rename-only: every old flat verb (`get-doc`, `list-docs`, …) still exists
 * as a hidden **husk** that prints the new form and exits non-zero, so
 * muscle-memory invocations fail loudly with a pointer. Husks are removed in
 * v1.0. The actual handlers did NOT move — `moveInto()` registers a command
 * via its existing `register*()` function and then renames it under a group,
 * so there's a single implementation per command.
 *
 * Lazy-loading: commands are registered eagerly (so `--help` lists them all),
 * but their *handler bodies* are import()-loaded only when invoked.
 */

import { Command, Option } from "commander";

import { PKG_VERSION } from "../meta.ts";
import { c, eprintln } from "../../../../_shared/cli-core/index.ts";

import { registerBackup } from "./commands/backup.ts";
import { registerCompletion } from "./commands/completion.ts";
import { registerConfigGet } from "./commands/config-get.ts";
import { registerConfigList } from "./commands/config-list.ts";
import { registerConfigSet } from "./commands/config-set.ts";
import { registerConfigureAgent } from "./commands/configure-agent.ts";
import { registerDeleteDoc } from "./commands/delete-doc.ts";
import { registerDeleteProject } from "./commands/delete-project.ts";
import { registerDeployServer } from "./commands/deploy-server.ts";
import { registerDocumentEdit } from "./commands/document-edit.ts";
import { registerDocumentRestore } from "./commands/document-restore.ts";
import { registerProjectCreate } from "./commands/project-create.ts";
import { registerProjectEdit } from "./commands/project-edit.ts";
import { registerVersionArchive } from "./commands/version-archive.ts";
import { registerDocs } from "./commands/docs.ts";
import { registerDoctor } from "./commands/doctor.ts";
import { registerGetAuditLog } from "./commands/get-audit-log.ts";
import { registerGetDoc } from "./commands/get-doc.ts";
import { registerIngest } from "./commands/ingest.ts";
import { registerIngestDir } from "./commands/ingest-dir.ts";
import { registerInit } from "./commands/init.ts";
import { registerListDocs } from "./commands/list-docs.ts";
import { registerListMetadataKeys } from "./commands/list-metadata-keys.ts";
import { registerListProjects } from "./commands/list-projects.ts";
import { registerListVersions } from "./commands/list-versions.ts";
import { registerMcp } from "./commands/mcp.ts";
import { registerMetadataSearch } from "./commands/metadata-search.ts";
import { registerReindex } from "./commands/reindex.ts";
import { registerRestore } from "./commands/restore.ts";
import { registerSearch } from "./commands/search.ts";
import { registerSelfUpdate } from "./commands/self-update.ts";
import { registerStatus } from "./commands/status.ts";
import { registerSyncDocs } from "./commands/sync-docs.ts";
import { registerSyncSelfDocs } from "./commands/sync-self-docs.ts";
import { registerWeb } from "./commands/web.ts";

/**
 * Register a command via its existing `register*(parent)` function, then
 * rename the freshly-added command under `parent`. The handler is unchanged;
 * only the command's name moves (e.g. `get-doc` → `get` under `document`).
 */
function moveInto(parent: Command, register: (p: Command) => void, newName: string): Command {
  register(parent);
  const cmd = parent.commands[parent.commands.length - 1];
  cmd.name(newName);
  return cmd;
}

/**
 * Old flat verb → new resource-verb form. v0.9.0 husks: the old name stays
 * registered (hidden) and exits non-zero with a pointer to the new form.
 * `backup` is intentionally absent — it's a resource group whose own
 * no-subcommand action prints the notice. Remove these in v1.0.
 */
const RENAMED_VERBS: ReadonlyArray<readonly [string, string]> = [
  ["get-doc", "document get"],
  ["list-docs", "document list"],
  ["delete-doc", "document delete"],
  ["ingest", "document ingest"],
  ["ingest-dir", "document ingest-dir"],
  ["list-projects", "project list"],
  ["delete-project", "project delete"],
  ["list-versions", "document version list"],
  ["get-audit-log", "audit list"],
  ["list-metadata-keys", "metadata keys"],
  ["metadata-search", "metadata search"],
  ["config-get", "config get"],
  ["config-set", "config set"],
  ["restore", "backup restore"],
  ["deploy-server", "server deploy"],
  ["reindex", "server reindex"],
];

function registerRenameHusks(program: Command): void {
  for (const [oldName, newForm] of RENAMED_VERBS) {
    program
      .command(oldName, { hidden: true })
      .allowUnknownOption(true)
      .allowExcessArguments(true)
      .argument("[args...]", "(renamed)")
      .action(() => {
        eprintln(c.yellow(`✗ \`cerefox ${oldName}\` was renamed.`));
        eprintln(`  Use \`cerefox ${newForm}\` instead (run \`cerefox ${newForm.split(" ")[0]} --help\`).`);
        process.exit(1);
      });
  }
}

/**
 * Build the top-level commander program with every subcommand registered.
 * Returns a fresh instance each call (used by tests to spawn isolated
 * programs).
 */
export function buildProgram(): Command {
  const program = new Command("cerefox")
    .description("Cerefox — user-owned shared memory for AI agents.")
    .version(PKG_VERSION, "-v, --version", "Print the cerefox version and exit.")
    .addOption(
      new Option(
        "--json",
        "Emit machine-readable JSON on stdout instead of the default human text. " +
          "Available on read commands; ignored on commands without a JSON shape.",
      ).hideHelp(),
    )
    .showHelpAfterError("(run `cerefox --help` for usage)")
    .enablePositionalOptions()
    .addHelpText(
      "after",
      "\nResource groups (run `cerefox <group> --help`):\n" +
        "  document   get · list · edit · delete · restore · ingest · ingest-dir · version {list·archive·unarchive}\n" +
        "  project    list · create · edit · delete\n" +
        "  metadata   keys · search\n" +
        "  audit      list\n" +
        "  config     list · get · set\n" +
        "  backup     create · restore\n" +
        "  server     deploy · reindex\n" +
        "\nTop-level commands:\n" +
        "  search · init · doctor · status · configure-agent · self-update\n" +
        "  mcp · web · docs · completion · sync-docs · sync-self-docs\n" +
        "\nRenamed in v0.9.0: the old flat verbs (get-doc, list-docs, ingest, …)\n" +
        "  now live under the groups above. The old names still run but exit with\n" +
        "  a pointer to the new form. They are removed in v1.0.\n" +
        "\nExit codes:\n" +
        "  0  success            2  system error (unreachable Supabase, RPC failure, …)\n" +
        "  1  user error         3  not found (document / version / project)\n" +
        "\nLearn more:\n" +
        "  cerefox docs --list                     # bundled docs (offline)\n" +
        "  cerefox doctor                          # diagnose your install\n" +
        "  https://github.com/fstamatelopoulos/cerefox\n",
    );

  // ── Top-level: primary verb + lifecycle + servers + misc (flat) ──────────
  registerSearch(program);
  registerInit(program);
  registerDoctor(program);
  registerStatus(program);
  registerConfigureAgent(program);
  registerSelfUpdate(program);
  registerMcp(program);
  registerWeb(program);
  registerDocs(program);
  registerCompletion(program);
  registerSyncDocs(program);
  registerSyncSelfDocs(program);

  // ── Resource groups (v0.9.0 rename-only redesign) ────────────────────────
  const document = program
    .command("document")
    .description("Documents: get, list, edit, delete, restore, ingest, ingest-dir, version.");
  moveInto(document, registerGetDoc, "get");
  moveInto(document, registerListDocs, "list");
  moveInto(document, registerDeleteDoc, "delete");
  registerDocumentRestore(document); // v0.9.0: new command (no old flat verb)
  registerDocumentEdit(document); // v0.9.1: non-destructive title/metadata patch
  moveInto(document, registerIngest, "ingest");
  moveInto(document, registerIngestDir, "ingest-dir");

  // v0.9.1: versions nested under `document` (Clio's shape — a version belongs
  // to a document). The top-level `version` group shipped in v0.9.0 hours
  // earlier; no husk (nobody would have adopted it). The v0.8 flat
  // `list-versions` husk now points at `document version list`.
  const documentVersion = document
    .command("version")
    .description("Document versions: list, archive, unarchive.");
  moveInto(documentVersion, registerListVersions, "list");
  registerVersionArchive(documentVersion);

  const project = program.command("project").description("Projects: list, create, edit, delete.");
  moveInto(project, registerListProjects, "list");
  registerProjectCreate(project); // v0.9.1: explicit create (parity with web/API)
  registerProjectEdit(project); // v0.9.1: rename / edit description
  moveInto(project, registerDeleteProject, "delete");

  const metadata = program.command("metadata").description("Metadata: keys, search.");
  moveInto(metadata, registerListMetadataKeys, "keys");
  moveInto(metadata, registerMetadataSearch, "search");

  const audit = program.command("audit").description("Audit log: list.");
  moveInto(audit, registerGetAuditLog, "list");

  const config = program.command("config").description("Runtime config: list, get, set.");
  registerConfigList(config); // v0.9.1: list the allowed config keys
  moveInto(config, registerConfigGet, "get");
  moveInto(config, registerConfigSet, "set");

  const backup = program
    .command("backup")
    .description("Backup + restore the knowledge base: create, restore.")
    .action(() => {
      eprintln(c.yellow("`cerefox backup` needs a subcommand."));
      eprintln("  Use `cerefox backup create` or `cerefox backup restore`.");
      process.exit(1);
    });
  moveInto(backup, registerBackup, "create");
  moveInto(backup, registerRestore, "restore");

  const server = program.command("server").description("Server side: deploy, reindex.");
  moveInto(server, registerDeployServer, "deploy");
  moveInto(server, registerReindex, "reindex");

  // ── Husks for the renamed flat verbs (hidden; fail loudly with a pointer) ─
  registerRenameHusks(program);

  return program;
}
