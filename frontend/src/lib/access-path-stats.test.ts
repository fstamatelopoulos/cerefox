/**
 * The dashboard's access-path arithmetic (#195), tested without a browser.
 *
 * The Playwright suite is 8/13 failing on main (#155), so a UI change lands
 * there with no working coverage. The computation is the part that was wrong —
 * the rendering is a badge — so it lives in its own module and is asserted
 * directly against the code the page actually calls. Not a substitute for the
 * e2e suite; what is verifiable while that suite is broken.
 *
 * Lives beside the module rather than under `tests/`, because `bun test` in
 * `frontend/` also collects the Playwright specs and cannot run them.
 */

import { describe, expect, test } from "bun:test";

import { deriveAccessPathStats, type AccessPathRow } from "./access-path-stats";

const derive = deriveAccessPathStats;
type PathCount = AccessPathRow;

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
