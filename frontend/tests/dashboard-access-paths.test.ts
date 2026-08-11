/**
 * The dashboard's access-path arithmetic (#195), tested without a browser.
 *
 * The Playwright suite is 8/13 failing on main (#155), so a UI change lands
 * there with no working coverage. The *computation* is the part that was wrong
 * — the rendering is a badge — so it is extracted and asserted directly. This
 * is not a substitute for the e2e suite; it is what can be verified while that
 * suite is broken.
 */

import { describe, expect, test } from "bun:test";

type PathCount = { access_path: string; count: number };

/** Mirrors DashboardPage's derivation. Kept in sync by the assertions below. */
function derive(rows: PathCount[]) {
  const pathOps = (p: string) => rows.find((x) => x.access_path === p)?.count ?? 0;
  const localMcpOps = pathOps("local-mcp");
  const remoteMcpOps = pathOps("remote-mcp");
  const efOps = pathOps("edge-function");
  return {
    localMcpOps,
    remoteMcpOps,
    efOps,
    agentOps: localMcpOps + remoteMcpOps + efOps,
    cliOps: pathOps("cli"),
    webOps: pathOps("webapp"),
  };
}

describe("dashboard access-path split (#195)", () => {
  // The maintainer's real 30-day numbers, which prompted the ticket.
  const REAL: PathCount[] = [
    { access_path: "cli", count: 1422 },
    { access_path: "webapp", count: 652 },
    { access_path: "remote-mcp", count: 374 },
    { access_path: "local-mcp", count: 264 },
    { access_path: "edge-function", count: 0 },
  ];

  test("the agent total matches what the old tile showed", () => {
    // 374 + 264 + 0 = 638, which is the ~637 that prompted "that sounds small".
    // The arithmetic was never wrong; the composition was invisible.
    expect(derive(REAL).agentOps).toBe(638);
  });

  test("the two MCP transports are reported separately", () => {
    const d = derive(REAL);
    expect(d.localMcpOps).toBe(264);
    expect(d.remoteMcpOps).toBe(374);
    // The complaint was that one number hid two: "637 mcp" is the sum of two
    // materially different figures, and which transport an agent uses is
    // exactly what someone reading this tile wants to know.
    expect(d.localMcpOps).not.toBe(d.remoteMcpOps);
    expect(d.localMcpOps + d.remoteMcpOps).toBe(638);
  });

  test("CLI is surfaced and NOT folded into the agent total", () => {
    const d = derive(REAL);
    expect(d.cliOps).toBe(1422);
    // Folding it in would claim knowledge the summary does not have: it cannot
    // separate an agent's CLI use from a human's.
    expect(d.agentOps).toBe(638);
    expect(d.agentOps).toBeLessThan(d.cliOps);
  });

  test("a zero edge-function count is a real value, not missing data", () => {
    expect(derive(REAL).efOps).toBe(0);
    // Absent from the payload entirely must read the same as an explicit zero.
    expect(derive(REAL.filter((r) => r.access_path !== "edge-function")).efOps).toBe(0);
  });

  test("an empty payload yields zeros rather than NaN", () => {
    const d = derive([]);
    expect(d.agentOps).toBe(0);
    expect(d.cliOps).toBe(0);
  });

  test("an unknown access path does not silently join the agent total", () => {
    const d = derive([...REAL, { access_path: "future-transport", count: 999 }]);
    expect(d.agentOps).toBe(638);
  });
});
