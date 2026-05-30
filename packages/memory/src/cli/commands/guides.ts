/**
 * `cerefox guides {list|open|show|ingest}` — the bundled Cerefox
 * documentation (README, AGENT_GUIDE, AGENT_QUICK_REFERENCE, docs/guides/*).
 *
 * v0.9.1: renamed from the flat `docs` command (disambiguates from the
 * `document` resource — stored docs) and merged with `sync-self-docs`:
 *   - list / open / show  — view the bundled guides (was `docs`).
 *   - ingest              — ingest them into the KB (was `sync-self-docs`;
 *                            registered here in program.ts via `moveInto`).
 */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";

import {
  c,
  notFound,
  printTable,
  println,
} from "../../../../../_shared/cli-core/index.ts";
import { listBundledDocs, readBundledDoc } from "../util/bundled-docs.ts";

function openInBrowser(path: string): void {
  // Best-effort cross-platform open. macOS: `open`; Windows: `start`;
  // Linux: `xdg-open`. Never fails the command — falls back to printing.
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const result = spawnSync(cmd, [path], { stdio: "ignore" });
  if (result.status !== 0) {
    println(c.dim(`(could not auto-open; the file is at: ${path})`));
  }
}

function resolveDoc(topic: string) {
  const doc = readBundledDoc(topic);
  if (!doc) {
    throw notFound(
      `No bundled guide named "${topic}".`,
      "Run `cerefox guides list` to see available topics.",
    );
  }
  return doc;
}

function listAction(): void {
  const docs = listBundledDocs();
  if (docs.length === 0) {
    println("(no bundled guides found)");
    return;
  }
  println(c.bold("Available guides:"));
  println("");
  printTable(docs.map((d) => ({ topic: d.topic, size_kb: Math.round(d.size / 1024) + " KB" })));
  println("");
  println(
    c.dim("Open with `cerefox guides open <topic>` (browser) or `cerefox guides show <topic>` (stdout)."),
  );
}

function openAction(topic: string): void {
  const doc = resolveDoc(topic);
  println(c.dim(`Opening ${doc.path} …`));
  openInBrowser(doc.path);
}

function showAction(topic: string): void {
  println(resolveDoc(topic).content);
}

export function registerGuides(parent: Command): void {
  parent
    .command("list")
    .description("List the bundled documentation topics.")
    .action(listAction);
  parent
    .command("open")
    .description("Open a bundled guide in your browser.")
    .argument("<topic>", "Topic (e.g. quickstart, connect-agents).")
    .action(openAction);
  parent
    .command("show")
    .description("Print a bundled guide to stdout.")
    .argument("<topic>", "Topic (e.g. quickstart, connect-agents).")
    .action(showAction);
}
