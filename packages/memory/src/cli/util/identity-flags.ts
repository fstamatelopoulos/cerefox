/**
 * The caller-identity flags, one name on every command (v1.13.2, #244).
 *
 * `--author` is the caller's name on every command, reads and writes, exactly
 * as `author` is on every MCP tool since v1.13.1. Reads used to say
 * `--requestor`; that spelling still works as a hidden alias so existing
 * scripts and agent prompts keep running, and it is no longer shown in
 * `--help`. Commands that already use `-a` for something else (document
 * insert: anchor heading; audit list: it was the filter's short flag until
 * v1.13.2, and reusing it would silently change a script's meaning) take the
 * long form only.
 */

import { Option } from "commander";

/**
 * `kind` only changes the help text: a read records the name in the usage
 * log, a write also records it as the author in the audit log.
 */
export function authorOption(kind: "read" | "write", opts: { short?: boolean } = {}): Option {
  const flags = opts.short === false ? "--author <name>" : "-a, --author <name>";
  const where = kind === "write" ? "recorded in the audit log and the usage log" : "recorded in the usage log";
  return new Option(flags, `Your name (agent or user); ${where}.`);
}

/** `-r, --requestor <name>`: the pre-1.13.2 spelling, accepted and hidden. */
export function requestorAliasOption(): Option {
  return new Option("-r, --requestor <name>").hideHelp();
}
