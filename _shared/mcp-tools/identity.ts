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

/**
 * The audit log is the one tool where `author` used to mean something else:
 * the entries FILTER (until v1.13.1 on MCP, v1.13.2 on the primitive Edge
 * Function). A caller still on that shape sends `requestor` (its identity)
 * and, optionally, `author` (its filter), and never `by_author`. That shape is
 * unambiguous, so it keeps its meaning instead of turning the filter into a
 * phantom reader in the usage log. Everything else is the current shape:
 * identity from callerIdentity(), filter from `by_author`.
 */
export function auditLogIdentity(
  args: Record<string, unknown>,
): { identity: string | undefined; byAuthor: string | undefined } {
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : undefined);
  const requestor = str(args.requestor);
  const byAuthor = str(args.by_author);
  if (requestor !== undefined && byAuthor === undefined) {
    return { identity: requestor, byAuthor: str(args.author) };
  }
  return { identity: callerIdentity(args), byAuthor };
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
