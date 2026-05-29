/**
 * `cerefox` CLI program builder.
 *
 * Owns the commander.Command tree. Each subcommand registers itself via
 * `register(program)` from its own file under `./commands/`. The bin
 * entry (`src/bin/cerefox.ts`) imports `buildProgram()` and then runs
 * the standard parse/dispatch flow with a typed error handler.
 *
 * Lazy-loading: commands are registered eagerly (so `--help` lists them
 * all), but their *handler bodies* are import()-loaded only when the
 * command is actually invoked. Keeps `cerefox --version` and
 * `cerefox --help` sub-100ms.
 */

import { Command, Option } from "commander";

import { PKG_VERSION } from "../meta.ts";

// Subcommand registration functions. Each is a thin wrapper that adds a
// `.command(...)` to the program and points its action at a lazy import
// of the actual handler. Adding a command = one new file + one import.
import { registerBackup } from "./commands/backup.ts";
import { registerCompletion } from "./commands/completion.ts";
import { registerConfigGet } from "./commands/config-get.ts";
import { registerConfigSet } from "./commands/config-set.ts";
import { registerConfigureAgent } from "./commands/configure-agent.ts";
import { registerDeleteDoc } from "./commands/delete-doc.ts";
import { registerDeployServer } from "./commands/deploy-server.ts";
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
      "\nCommand groups (each row in the list above falls into one):\n" +
        "  READS      search · get-doc · list-docs · list-versions · list-projects\n" +
        "             · list-metadata-keys · metadata-search · get-audit-log\n" +
        "  WRITES     ingest · ingest-dir · delete-doc\n" +
        "  SERVERS    mcp · web\n" +
        "  LIFECYCLE  init · doctor · status · configure-agent · self-update · upgrade · sync-self-docs · deploy-server\n" +
        "  OPS        backup · restore · sync-docs · docs · reindex · config-get · config-set · completion\n" +
        "\nExit codes:\n" +
        "  0  success            2  system error (unreachable Supabase, RPC failure, …)\n" +
        "  1  user error         3  not found (document / version / project)\n" +
        "\nLearn more:\n" +
        "  cerefox docs --list                     # bundled docs (offline)\n" +
        "  cerefox doctor                          # diagnose your install\n" +
        "  https://github.com/fstamatelopoulos/cerefox\n",
    );

  // ── READS ───────────────────────────────────────────────────────────────
  registerSearch(program);
  registerGetDoc(program);
  registerListDocs(program);
  registerListVersions(program);
  registerListProjects(program);
  registerListMetadataKeys(program);
  registerMetadataSearch(program);
  registerGetAuditLog(program);

  // ── WRITES ──────────────────────────────────────────────────────────────
  registerIngest(program);
  registerIngestDir(program);
  registerDeleteDoc(program);

  // ── SERVERS ─────────────────────────────────────────────────────────────
  registerMcp(program);
  registerWeb(program);

  // ── LIFECYCLE ───────────────────────────────────────────────────────────
  registerInit(program);
  registerDoctor(program);
  registerStatus(program);
  registerConfigureAgent(program);
  registerSelfUpdate(program);
  registerSyncSelfDocs(program);
  registerDeployServer(program);

  // ── OPS ─────────────────────────────────────────────────────────────────
  registerBackup(program);
  registerRestore(program);
  registerSyncDocs(program);
  registerDocs(program);
  registerReindex(program);
  registerConfigGet(program);
  registerConfigSet(program);
  registerCompletion(program);

  return program;
}
