/**
 * Class guard for #268: every surface that accepts a `max_bytes` budget must
 * SANITISE it before it reaches the RPC.
 *
 * Why this is a static scan rather than a behavioural test. The hole is always
 * the same shape and always invisible at the call site:
 *
 *     Math.min(requested_max_bytes ?? MAX_BYTES, MAX_BYTES)   // "lots" -> NaN
 *
 * `NaN` serialises to JSON `null`, and `p_max_bytes NULL` means NO limit in
 * Postgres — so the one parameter that exists to bound the reply, handed a
 * word, removes the bound instead. It was fixed on the search tool (#265),
 * missed on the metadata-search Edge Function, and found only by pointing a
 * malformed call at a deployed function. A unit test per surface would have to
 * be remembered for each NEW surface; this cannot be forgotten, because the
 * file list is DERIVED from the tree.
 *
 * The same shape produced the missing RLS table, the unguarded test suites and
 * the Edge Function bundle allow-list: a list that must match another list,
 * maintained by hand, drifts.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");

/** Every source file in the tree that takes a caller-supplied byte budget. */
function budgetTakingSources(): Array<{ path: string; source: string }> {
  const candidates: string[] = [];

  const efDir = join(REPO_ROOT, "supabase", "functions");
  for (const name of readdirSync(efDir)) {
    const p = join(efDir, name, "index.ts");
    if (existsSync(p)) candidates.push(p);
  }

  const toolsDir = join(REPO_ROOT, "_shared", "mcp-tools");
  for (const name of readdirSync(toolsDir)) {
    if (name.endsWith(".ts")) candidates.push(join(toolsDir, name));
  }

  const cliDir = join(REPO_ROOT, "packages", "memory", "src", "cli", "commands");
  if (existsSync(cliDir)) {
    for (const name of readdirSync(cliDir)) {
      if (name.endsWith(".ts")) candidates.push(join(cliDir, name));
    }
  }

  return candidates
    .map((path) => ({ path, source: readFileSync(path, "utf8") }))
    // A file that merely mentions the parameter in prose (a tool schema
    // description, a docblock) is not a surface. A surface READS a budget out
    // of caller input, and each layer has exactly one way to do that: MCP tools
    // take `args`, Edge Functions parse a JSON `body`, the CLI gets commander
    // `options`. Keying on the three input shapes rather than on a file list
    // means a new surface is policed the day it is written — and keying on the
    // RPC parameter alone was not enough, because the search surfaces spend
    // the budget in TypeScript instead of forwarding it.
    .filter(({ source }) =>
      /\bargs\.max_bytes\b/.test(source) ||
      /\bbody\.max_bytes\b/.test(source) ||
      /\boptions\.maxBytes\b/.test(source) ||
      // An Edge Function may destructure it out of the parsed body under a
      // local alias (`max_bytes: requested_max_bytes`) instead of reading the
      // property, which is how the one surface this guard was written for was
      // nearly missed a second time.
      /max_bytes\s*:\s*\w+[\s\S]{0,400}?\}\s*=\s*body/.test(source),
    );
}

/**
 * Does this source sanitise before clamping?
 *
 * Two idioms are legitimate and both are proven safe against a non-numeric
 * value: the shared `Math.floor(Number(x))` + `Number.isFinite` pair used by
 * the tools and Edge Functions, and the CLI's `parseNonNegativeInt`, which
 * rejects the call outright rather than coercing.
 */
function sanitisesBudget(source: string): boolean {
  const coercesThenChecksFinite =
    /Math\.floor\(\s*Number\(/.test(source) && /Number\.isFinite\(/.test(source);
  const rejectsAtTheBoundary = /parseNonNegativeInt\(/.test(source);
  return coercesThenChecksFinite || rejectsAtTheBoundary;
}

describe("max_bytes is sanitised on every surface that accepts one", () => {
  const surfaces = budgetTakingSources();

  test("the detector finds the surfaces it is meant to police", () => {
    // If this ever collapses to nothing the suite below passes vacuously —
    // which is exactly how two static checks in this project once passed while
    // policing an empty set. Assert a plausible population, and name the ones
    // that must always be in it.
    expect(surfaces.length).toBeGreaterThanOrEqual(4);
    const names = surfaces.map((s) => s.path.replace(REPO_ROOT + "/", ""));
    expect(names).toContain("supabase/functions/cerefox-search/index.ts");
    expect(names).toContain("supabase/functions/cerefox-metadata-search/index.ts");
    expect(names).toContain("_shared/mcp-tools/search.ts");
    expect(names).toContain("_shared/mcp-tools/metadata-search.ts");
  });

  for (const { path, source } of surfaces) {
    const rel = path.replace(REPO_ROOT + "/", "");
    test(`${rel} sanitises its byte budget`, () => {
      expect(sanitisesBudget(source)).toBe(true);
    });
  }

  test("the guard fires on the shape it exists to catch", () => {
    // A guard that cannot fail is not a guard. This is the exact code that
    // shipped in the metadata-search Edge Function, and it must be rejected.
    const shippedHole = `
      const requested_max_bytes = body.max_bytes;
      const max_bytes = include_content
        ? Math.min(requested_max_bytes ?? MAX_BYTES, MAX_BYTES)
        : null;
      params.p_max_bytes = max_bytes;
    `;
    expect(sanitisesBudget(shippedHole)).toBe(false);

    // And a clamp without the finite check is still the hole: `Math.max` and
    // `Math.min` both propagate NaN.
    const clampOnly = `
      const max_bytes = Math.min(Math.max(1, Number(body.max_bytes)), MAX_BYTES);
      params.p_max_bytes = max_bytes;
    `;
    expect(sanitisesBudget(clampOnly)).toBe(false);

    // The two accepted idioms must pass, or the guard is unsatisfiable.
    expect(
      sanitisesBudget(`
        const requestedBytes = Math.floor(Number(body.max_bytes));
        const max_bytes = Number.isFinite(requestedBytes) ? requestedBytes : MAX_BYTES;
        params.p_max_bytes = max_bytes;
      `),
    ).toBe(true);
    expect(
      sanitisesBudget(`
        const maxBytes = parseNonNegativeInt(options.maxBytes, "--max-bytes", 200_000);
        params.p_max_bytes = maxBytes;
      `),
    ).toBe(true);
  });
});
