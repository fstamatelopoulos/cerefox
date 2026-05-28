#!/usr/bin/env bun
/**
 * Reindex all documents with title-boosted embeddings and FTS.
 *
 * Run this after applying migration 0011 (title boosting) to update
 * existing documents with the new embedding format (title prefix).
 * Documents ingested after migration 0011 are already correct — this
 * script is only needed for documents that existed before.
 *
 * Usage:
 *   bun scripts/reindex_all.ts [--dry-run] [--batch N]
 *
 * v0.7+: delegates to the TS `cerefox reindex` CLI command. Pre-v0.7
 * the Python script shelled out to `uv run cerefox reindex` which
 * itself was a Python implementation. v0.7's `cerefox reindex` (from
 * `@cerefox/memory`) is the in-process TS path; this script invokes
 * the bundled bin if it can find it, otherwise falls back to
 * `npx --package=@cerefox/memory cerefox reindex` so it works from a
 * checkout without a global install.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXIT_OK,
  EXIT_USER_ERROR,
  println,
  errorln,
} from "../_shared/cli-core/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const BUILT_BIN = join(REPO_ROOT, "packages", "memory", "dist", "bin", "cerefox.js");

interface Args {
  dryRun: boolean;
  batch: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, batch: "50" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--batch") out.batch = argv[++i] ?? "50";
    else if (a.startsWith("--batch=")) out.batch = a.split("=")[1];
    else if (a === "--help" || a === "-h") {
      println("Usage: bun scripts/reindex_all.ts [--dry-run] [--batch N]");
      process.exit(EXIT_OK);
    } else {
      errorln(`Unknown arg: ${a}`);
      process.exit(EXIT_USER_ERROR);
    }
  }
  return out;
}

function pickCommand(): { cmd: string; preargs: string[] } {
  if (existsSync(BUILT_BIN)) {
    return { cmd: "node", preargs: [BUILT_BIN] };
  }
  // Fallback: globally-installed cerefox, then npx.
  return { cmd: "npx", preargs: ["-y", "--package=@cerefox/memory", "cerefox"] };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { cmd, preargs } = pickCommand();
  const fullArgs = [
    ...preargs,
    "reindex",
    "--all",
    "--batch",
    args.batch,
  ];
  if (args.dryRun) fullArgs.push("--dry-run");

  println(`Running: ${cmd} ${fullArgs.join(" ")}`);
  const child = spawn(cmd, fullArgs, { stdio: "inherit" });
  child.on("close", (code) => process.exit(code ?? EXIT_OK));
}

main().catch((err) => {
  errorln(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
