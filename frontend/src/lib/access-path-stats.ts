/**
 * Turn the usage summary's per-access-path counts into what the dashboard
 * shows (#195).
 *
 * Extracted from `DashboardPage` so it can be tested without a browser: the
 * Playwright suite is 8/13 failing (#155), and this arithmetic is the part that
 * was actually wrong — the rendering is a badge.
 */

export interface AccessPathRow {
  access_path: string;
  count: number;
}

export interface AccessPathStats {
  localMcpOps: number;
  remoteMcpOps: number;
  efOps: number;
  /** `/api/v1` calls from a client that identified itself (#226). */
  apiOps: number;
  /** MCP + Edge Function + identified API. Deliberately excludes CLI — see below. */
  agentOps: number;
  cliOps: number;
  webOps: number;
}

export function deriveAccessPathStats(rows: AccessPathRow[] | undefined): AccessPathStats {
  const at = (p: string) => rows?.find((x) => x.access_path === p)?.count ?? 0;
  const localMcpOps = at("local-mcp");
  const remoteMcpOps = at("remote-mcp");
  const efOps = at("edge-function");
  // `api` = /api/v1 with caller identity supplied (#226). Added here
  // deliberately, which is the whole point of the rule below: the value
  // existed in the database and on the Analytics chart the moment the server
  // started writing it, and would have been invisible in this tile until
  // someone noticed an undercount months later.
  const apiOps = at("api");
  return {
    localMcpOps,
    remoteMcpOps,
    efOps,
    apiOps,
    // Only the paths that are unambiguously agents. An unknown access path is
    // NOT swept in: a future transport should appear deliberately, not by
    // silently inflating this number.
    agentOps: localMcpOps + remoteMcpOps + efOps + apiOps,
    // CLI is reported alongside, never folded in. The usage log records both
    // requestor and access path, but the summary endpoint does not
    // cross-tabulate them, so an agent's CLI use cannot be told from a human's
    // here. Reporting it separately states what is known; folding it in would
    // replace an undercount with a fabrication.
    cliOps: at("cli"),
    webOps: at("webapp"),
  };
}
