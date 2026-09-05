/**
 * The caller-identity flags on commands that READ (v1.13.2, #244).
 *
 * One name everywhere: `--author` is the caller's name on every command, reads
 * and writes, exactly as `author` is on every MCP tool since v1.13.1. Reads
 * used to say `--requestor`; that spelling still works as a hidden alias so
 * existing scripts and agent prompts keep running, and it is no longer shown
 * in `--help`. Commands that already use `-a` for something else (document
 * insert: anchor heading) take the long form only.
 */

import { Option } from "commander";

export function authorReadOption(opts: { short?: boolean } = {}): Option {
  const flags = opts.short === false ? "--author <name>" : "-a, --author <name>";
  return new Option(flags, "Your name (agent or user); recorded in the usage log.");
}

/** `-r, --requestor <name>`: the pre-1.13.2 spelling, accepted and hidden. */
export function requestorAliasOption(): Option {
  return new Option("-r, --requestor <name>").hideHelp();
}
