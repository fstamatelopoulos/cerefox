/**
 * `cerefox sync-self-docs` — Layer 2 of the MCP discoverability story.
 *
 * Ingests the bundled `AGENT_GUIDE.md`, `AGENT_QUICK_REFERENCE.md`, and
 * curated `docs/guides/*.md` into a dedicated `_cerefox-self-docs`
 * project so any agent connected via MCP can search the official
 * guidance: `cerefox_search "writing linkable content"`.
 *
 * Idempotent: titles are stable so `update_if_exists` skips unchanged
 * docs and updates the rest. Re-run after every `cerefox self-update`
 * to keep the KB ingest in lockstep with the installed package.
 *
 * Each ingested doc carries metadata
 *   { type: "agent-guide", source: "cerefox-self-docs",
 *     version: "<installed-version>", source_path: "<bundle-path>" }
 * so the frontend / cerefox_metadata_search can distinguish "official
 * Cerefox guidance" from user-authored notes that happen to mention
 * agent patterns.
 *
 * `_`-prefixed project name means the frontend filters it from default
 * project listings (see Part 23F.5).
 */

import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";

import {
  c,
  println,
  printTable,
  resolveAuthor,
  resolveAuthorType,
} from "../../../../../_shared/cli-core/index.ts";
import { ingestTool } from "../../../../../_shared/mcp-tools/index.ts";
import { loadSettings } from "../../../../../_shared/config/index.ts";
import { PKG_VERSION } from "../../meta.ts";
import { getClient } from "../util/client.ts";
import { listBundledDocs } from "../util/bundled-docs.ts";

interface SyncSelfDocsOptions {
  dryRun?: boolean;
  project?: string;
}

/**
 * Exported so `init` and `self-update` can call into the sync without
 * spawning a subprocess.
 */
export async function runSyncSelfDocs(options: SyncSelfDocsOptions = {}): Promise<void> {
  const project = options.project ?? "_cerefox-self-docs";
  const docs = listBundledDocs();

  if (docs.length === 0) {
    println(c.dim("(no bundled docs found; nothing to sync)"));
    return;
  }

  println(c.bold(`Syncing ${docs.length} bundled doc(s) → project "${project}"`));
  println(c.dim(`  version: ${PKG_VERSION}`));
  if (options.dryRun) println(c.yellow("  (dry run — no writes)"));
  println("");

  if (options.dryRun) {
    printTable(
      docs.map((d) => ({
        topic: d.topic,
        size_kb: Math.round(d.size / 1024) + " KB",
      })),
    );
    return;
  }

  const client = getClient();
  const settings = loadSettings();
  // self-docs are written as if from the "Cerefox" agent itself.
  const author = resolveAuthor(undefined) === "unknown" ? "cerefox-self-docs" : resolveAuthor(undefined);
  const authorType = resolveAuthorType("agent");

  const outcomes: Array<{ topic: string; status: "ok" | "error"; detail: string }> = [];

  for (const doc of docs) {
    const content = readFileSync(doc.path, "utf8");
    // Title: prefer the first H1 in the doc; fall back to the basename.
    const m = content.match(/^#\s+(.+)$/m);
    const title = (m ? m[1].trim() : basename(doc.path, extname(doc.path)));
    try {
      const message = await ingestTool.handler(
        client.raw as unknown as Parameters<typeof ingestTool.handler>[0],
        {
          title,
          content,
          source: "cerefox-self-docs",
          metadata: {
            type: "agent-guide",
            source: "cerefox-self-docs",
            version: PKG_VERSION,
            source_path: doc.path,
            topic: doc.topic,
          },
          update_if_exists: true,
          // Bundled-docs sync: the npm package is the source of truth, so the
          // optimistic-concurrency check is bypassed by design (iter-32).
          last_write_wins: true,
          project_name: project,
          author,
          author_type: authorType,
        },
        { openaiApiKey: settings.openaiApiKey, accessPath: "cli" },
      );
      outcomes.push({ topic: doc.topic, status: "ok", detail: message });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outcomes.push({ topic: doc.topic, status: "error", detail: msg });
    }
  }

  const ok = outcomes.filter((o) => o.status === "ok").length;
  const errs = outcomes.filter((o) => o.status === "error").length;
  println("");
  println(c.bold(`Summary: ${ok} ok · ${errs} error${errs === 1 ? "" : "s"}`));
  if (errs > 0) {
    printTable(
      outcomes
        .filter((o) => o.status === "error")
        .map((o) => ({ topic: o.topic, error: o.detail.slice(0, 100) })),
    );
  }
}

async function action(options: SyncSelfDocsOptions): Promise<void> {
  await runSyncSelfDocs(options);
}

export function registerSyncSelfDocs(program: Command): void {
  program
    .command("sync-self-docs")
    .description("Ingest bundled Cerefox docs under the _cerefox-self-docs project.")
    .option("--dry-run", "List what would be ingested without writing.")
    .option("--project <name>", "Override the target project name.", "_cerefox-self-docs")
    .action(action);
}
