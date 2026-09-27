/**
 * No handler may read a React event inside a functional `setState` updater.
 *
 * This is the bug class behind #289, and it is worth a source scan rather than
 * three fixes, because the broken form and the correct one look almost the same:
 *
 *     onChange={(e) =>                                     // BROKEN
 *       setPairs((m) => m.map((x, i) => i === idx ? {...x, key: e.currentTarget.value} : x))}
 *
 *     onChange={(e) => { const v = e.currentTarget.value;   // CORRECT
 *       setPairs((m) => m.map((x, i) => i === idx ? {...x, key: v} : x)); }}
 *
 * React nulls `event.currentTarget` the moment the handler returns — it is only
 * valid during dispatch. A functional updater runs LATER, in the render phase,
 * so the read throws `Cannot read properties of null (reading 'value')` *during
 * render*. The consequence is out of all proportion to the typo: a render throw
 * unmounts the whole tree, so one metadata input blanked the entire app. Two
 * separate screens shipped with it (Ingest → Metadata, Search → Filters), which
 * is what a class-level guard is for.
 *
 * `e.target` is included: it survives longer in practice, but relying on that is
 * relying on an implementation detail of a lifecycle React documents as over.
 *
 * Scope: a text scan over `.ts`/`.tsx` under `src/`, no browser, no network. It
 * matches the shape, not the semantics — a name other than `e` for the event
 * parameter would slip past. That is deliberate; the repo writes `e`, and a
 * matcher loose enough to catch every alias would flag safe code instead.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * The body of every `setX(<arrow>)` call, by brace/paren balance.
 *
 * Balance-matching rather than a regex over the whole call: these updaters nest
 * `.map()` calls and object spreads several levels deep, and a non-greedy regex
 * stops at the first `)` — which is inside the updater, not at its end, and
 * would make the check quietly miss the exact shape it exists to catch.
 */
export function updaterBodies(source: string): Array<{ body: string; offset: number }> {
  const bodies: Array<{ body: string; offset: number }> = [];
  const call = /\bset[A-Z]\w*\(\s*\(?\s*\w+\s*\)?\s*=>/g;
  for (const m of source.matchAll(call)) {
    const start = source.indexOf("=>", m.index!) + 2;
    let depth = 0;
    let j = start;
    while (j < source.length) {
      const ch = source[j]!;
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") {
        if (depth === 0) break;
        depth--;
      }
      j++;
    }
    bodies.push({ body: source.slice(start, j), offset: start });
  }
  return bodies;
}

const EVENT_READ = /\be\.(currentTarget|target)\b/g;

function offenders(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, "utf8");
    for (const { body, offset } of updaterBodies(source)) {
      for (const hit of body.matchAll(EVENT_READ)) {
        const line = source.slice(0, offset + hit.index!).split("\n").length;
        found.push(`${relative(SRC, file)}:${line}  ${hit[0]}`);
      }
    }
  }
  return found.sort();
}

describe("React events are never read inside a lazy state updater", () => {
  test("no source file does it", () => {
    expect(offenders()).toEqual([]);
  });

  test("the scanner reaches a plausible amount of code", () => {
    // Without this, a broken glob or a moved directory turns the assertion above
    // into a guard that passes because it inspected nothing — the failure mode
    // this repo has hit more than once.
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThanOrEqual(30);
    expect(files.some((f) => f.endsWith("IngestPage.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("SearchControls.tsx"))).toBe(true);
    // And it finds updaters at all, which is what the event read is searched in.
    // 16 at the time of writing; the floor is set below that so ordinary churn
    // does not fail the suite, but a matcher that stops matching does.
    const total = files.reduce((n, f) => n + updaterBodies(readFileSync(f, "utf8")).length, 0);
    expect(total).toBeGreaterThanOrEqual(10);
  });

  test("it fires on the exact shape that shipped", () => {
    // The real #289 handler, verbatim. A guard that cannot fail proves nothing.
    const broken = `
      onChange={(e) =>
        setMetaPairs((m) =>
          m.map((x, idx) => (idx === i ? { ...x, key: e.currentTarget.value } : x)),
        )
      }`;
    const hits = updaterBodies(broken).flatMap((b) => [...b.body.matchAll(EVENT_READ)]);
    expect(hits.length).toBe(1);
  });

  test("it accepts the corrected shape", () => {
    // Capturing first is the fix, and must not read as a violation — otherwise
    // the only way to satisfy the test is to stop using functional updaters.
    const fixed = `
      onChange={(e) => {
        const next = e.currentTarget.value;
        setMetaPairs((m) => m.map((x, idx) => (idx === i ? { ...x, key: next } : x)));
      }}`;
    const hits = updaterBodies(fixed).flatMap((b) => [...b.body.matchAll(EVENT_READ)]);
    expect(hits).toEqual([]);
  });

  test("balance-matching spans the whole updater, not up to the first paren", () => {
    // The nested `.map(...)` is why: a non-greedy body match ends inside it and
    // never sees the read that follows.
    const nested = `setX((prev) => prev.map((p, i) => (i === idx ? { ...p, v: e.target.value } : p)))`;
    const [only] = updaterBodies(nested);
    expect(only!.body).toContain("e.target.value");
  });
});
