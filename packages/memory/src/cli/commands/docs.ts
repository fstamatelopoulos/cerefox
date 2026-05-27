/** `cerefox docs [topic]` — open / print bundled markdown docs. */

import type { Command } from "commander";
import { spawnSync } from "node:child_process";

import {
  c,
  notFound,
  printTable,
  println,
} from "../../../../../_shared/cli-core/index.ts";
import { listBundledDocs, readBundledDoc } from "../util/bundled-docs.ts";

interface DocsOptions {
  print?: boolean;
  list?: boolean;
}

function openInBrowser(path: string): void {
  // Best-effort cross-platform `open`. macOS: `open`; Linux: `xdg-open`;
  // Windows: `start`. We don't fail if it doesn't work — fall back to
  // printing the path.
  const cmd = process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "start"
      : "xdg-open";
  const result = spawnSync(cmd, [path], { stdio: "ignore" });
  if (result.status !== 0) {
    println(c.dim(`(could not auto-open; the file is at: ${path})`));
  }
}

function action(topic: string | undefined, options: DocsOptions): void {
  const docs = listBundledDocs();

  if (options.list || (!topic && !options.print)) {
    if (docs.length === 0) {
      println("(no bundled docs found)");
      return;
    }
    println(c.bold("Available docs:"));
    println("");
    printTable(
      docs.map((d) => ({
        topic: d.topic,
        size_kb: Math.round(d.size / 1024) + " KB",
      })),
    );
    println("");
    println(c.dim("Run `cerefox docs <topic>` to open in browser, or `--print` for stdout."));
    return;
  }

  const doc = topic ? readBundledDoc(topic) : null;
  if (!doc) {
    throw notFound(
      `No bundled doc named "${topic}".`,
      `Run \`cerefox docs --list\` to see available topics.`,
    );
  }

  if (options.print) {
    println(doc.content);
    return;
  }

  // Default: open in browser. (Markdown files render in default app on
  // most systems; a Markdown viewer is nicer but adds a dep.)
  println(c.dim(`Opening ${doc.path} …`));
  openInBrowser(doc.path);
}

export function registerDocs(program: Command): void {
  program
    .command("docs")
    .description("Open bundled Cerefox docs in your browser (or print to stdout).")
    .argument("[topic]", "Doc topic (e.g. quickstart, connect-agents). Omit for the index.")
    .option("--print", "Print to stdout instead of opening a browser.")
    .option("--list", "List available topics.")
    .action(action);
}
