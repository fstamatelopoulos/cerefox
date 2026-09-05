/**
 * The caller's identity, as one concept with one name.
 *
 * Every MCP tool takes `author`: the agent's (or person's) name, recorded as
 * the author in the audit log on writes and as the requestor in the usage log
 * on every call. Until v1.13.1 the tools disagreed about what to call it —
 * reads and the partial-edit tools said `requestor`, the other writes said
 * `author`, four tools took both — and an agent that followed the guide's
 * "author on writes" rule found no `author` on cerefox_insert/cerefox_edit,
 * passed nothing, and its edits were attributed to "mcp-agent".
 *
 * `requestor` is still accepted everywhere as a silent alias so nothing that
 * worked stops working; it is no longer listed in any schema. No exceptions:
 * on cerefox_get_audit_log, where `author` used to be the entries FILTER,
 * the filter is now `by_author` so that `author` means the same thing there
 * as everywhere else. (That one is a real behaviour change for a caller that
 * filtered with `author`; it is called out in the CHANGELOG.)
 */

export const DEFAULT_IDENTITY = "mcp-agent";

/** `author`, else `requestor`, else undefined. Blank strings count as absent. */
export function callerIdentity(args: Record<string, unknown>): string | undefined {
  for (const key of ["author", "requestor"] as const) {
    const v = args[key];
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return undefined;
}

const EXAMPLE = 'e.g. "Claude Code", "archiver"';

/** Schema entry for tools that write (audit log + usage log). */
export const AUTHOR_PARAM_WRITE = {
  type: "string",
  description:
    `Your name (agent or user), ${EXAMPLE}. Recorded as the author in the audit log and ` +
    `in the usage log. Defaults to "${DEFAULT_IDENTITY}" if not provided. May be enforced ` +
    "via server config.",
} as const;

/** Schema entry for tools that only read (usage log). */
export const AUTHOR_PARAM_READ = {
  type: "string",
  description:
    `Your name (agent or user), ${EXAMPLE}. Recorded in the usage log. Defaults to ` +
    `"${DEFAULT_IDENTITY}" if not provided. May be enforced via server config.`,
} as const;
