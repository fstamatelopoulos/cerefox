/**
 * The "Empty trash" loop, without a browser (`cd frontend && bun test src/`,
 * which is also CI's frontend step).
 *
 * The loop is the whole feature's logic: there is no bulk endpoint, so what
 * gets purged, in what order, what happens on a failure and when the run
 * ends are all decided here. The modal only renders what it reports.
 *
 * Lives beside the module rather than under `tests/`, like
 * access-path-stats.test.ts: `bun test` in `frontend/` would otherwise also
 * collect the Playwright specs, and a test under `tests/` is one CI never runs.
 */
import { describe, expect, test } from "bun:test";

import { emptyTrash, type EmptyTrashProgress, type TrashEntry } from "./emptyTrash";

const T0 = Date.parse("2026-09-05T10:00:00Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

/**
 * An in-memory trash: purge removes; a listing is capped like the server's and,
 * like the server's, ordered newest-deleted first.
 */
function fakeTrash(ids: string[], opts: { cap?: number; failing?: Set<string> } = {}) {
  const trash = new Map<string, TrashEntry>(
    ids.map((id, i) => [id, { id, title: `Doc ${id}`, deleted_at: at(i) }]),
  );
  const purged: string[] = [];
  const listings: number[] = [];
  const listTrash = async (): Promise<TrashEntry[]> => {
    const rows = [...trash.values()]
      .sort((a, b) => Date.parse(b.deleted_at!) - Date.parse(a.deleted_at!))
      .slice(0, opts.cap ?? 500);
    listings.push(rows.length);
    return rows;
  };
  return {
    purged,
    listings,
    trash,
    listTrash,
    deps: {
      listTrash,
      purge: async (id: string) => {
        if (opts.failing?.has(id)) throw new Error(`refused ${id}`);
        if (!trash.has(id)) return { purged: false };
        trash.delete(id);
        purged.push(id);
        return { purged: true };
      },
    },
  };
}

const NONE = { restored: [], failures: [], stopped: false, aborted: null };

describe("emptyTrash", () => {
  test("purges the confirmed set one call at a time and ends when nothing eligible remains", async () => {
    const t = fakeTrash(["a", "b", "c"]);
    const confirmed = await t.listTrash();
    const result = await emptyTrash({ ...t.deps, confirmed });
    expect(result).toEqual({ purged: 3, ...NONE });
    expect(t.purged).toEqual(["c", "b", "a"]);
    expect(t.trash.size).toBe(0);
    // The confirmed rows seed the first pass; one re-list confirms nothing is left.
    expect(t.listings).toEqual([3, 0]);
  });

  test("re-lists past the server cap until nothing eligible comes back", async () => {
    const ids = Array.from({ length: 7 }, (_, i) => `d${i}`);
    const t = fakeTrash(ids, { cap: 3 });
    const confirmed = await t.listTrash();
    // The user confirmed "3 or more". The listing is newest-first, so the
    // cutoff (the newest confirmed row) is the newest in the whole trash and
    // every older row is eligible on the later passes: all 7 go, three at a
    // time, and the progress total grows as each re-list finds more.
    const totals: number[] = [];
    const result = await emptyTrash({ ...t.deps, confirmed, onProgress: (p) => totals.push(p.total) });
    expect(result.purged).toBe(7);
    expect(t.trash.size).toBe(0);
    expect(t.listings).toEqual([3, 3, 1, 0]);
    expect(Math.max(...totals)).toBe(7);
  });

  test("a document trashed after the confirmation is never touched", async () => {
    const t = fakeTrash(["a", "b"]);
    const confirmed = await t.listTrash();
    // An agent soft-deletes something while the run is going.
    t.trash.set("late", { id: "late", title: "Doc late", deleted_at: at(60) });
    const result = await emptyTrash({ ...t.deps, confirmed });
    expect(result.purged).toBe(2);
    expect(t.trash.has("late")).toBe(true);
    expect(t.purged).toEqual(["b", "a"]);
  });

  test("a document restored before its turn is reported, not counted as purged", async () => {
    const t = fakeTrash(["a", "b", "c"]);
    const confirmed = await t.listTrash();
    t.trash.delete("b"); // restored by another tab: no longer in the trash
    const result = await emptyTrash({ ...t.deps, confirmed });
    expect(result.purged).toBe(2);
    expect(result.restored.map((d) => d.id)).toEqual(["b"]);
    expect(result.failures).toEqual([]);
  });

  test("a failure is recorded, not retried, and does not stop the others", async () => {
    const t = fakeTrash(["a", "b", "c"], { failing: new Set(["b"]) });
    const confirmed = await t.listTrash();
    const result = await emptyTrash({ ...t.deps, confirmed });
    expect(result.purged).toBe(2);
    expect(result.failures).toEqual([{ id: "b", title: "Doc b", error: "refused b" }]);
    expect(result.aborted).toBeNull();
    // "b" is still in the trash and is listed again, but never attempted twice:
    // the loop must terminate on a document that will not go away.
    expect(t.trash.has("b")).toBe(true);
    expect(t.listings).toEqual([3, 1]);
  });

  test("a fatal purge error aborts the run instead of failing every remaining document", async () => {
    // Newest-first: d is purged, then c is the fatal one; a and b are never attempted.
    const t = fakeTrash(["a", "b", "c", "d"], { failing: new Set(["a", "b", "c"]) });
    const confirmed = await t.listTrash();
    let calls = 0;
    const result = await emptyTrash({
      ...t.deps,
      confirmed,
      purge: (id) => {
        calls += 1;
        return t.deps.purge(id);
      },
      isFatal: (err) => String(err).includes("refused"),
    });
    expect(result.purged).toBe(1);
    expect(result.aborted).toBe("refused c");
    expect(result.failures).toEqual([]);
    expect(calls).toBe(2);
    expect(t.trash.size).toBe(3);
  });

  test("a failed re-list ends the run with an aborted message, not an exception", async () => {
    const t = fakeTrash(["a"]);
    const confirmed = await t.listTrash();
    const result = await emptyTrash({
      ...t.deps,
      confirmed,
      listTrash: async () => {
        throw new Error("503 Service Unavailable");
      },
    });
    expect(result.purged).toBe(1);
    expect(result.aborted).toBe("Could not list the trash: 503 Service Unavailable");
  });

  test("shouldStop ends the run after the purge in flight", async () => {
    const t = fakeTrash(["a", "b", "c", "d"]);
    const confirmed = await t.listTrash();
    let stop = false;
    const result = await emptyTrash({
      ...t.deps,
      confirmed,
      purge: async (id) => {
        const r = await t.deps.purge(id);
        if (id === "c") stop = true; // newest-first: d, then c, then stop
        return r;
      },
      shouldStop: () => stop,
    });
    expect(result).toEqual({ purged: 2, ...NONE, stopped: true });
    expect(t.trash.size).toBe(2);
  });

  test("progress reports the current title, a growing done count, and a total never below done", async () => {
    const t = fakeTrash(["a", "b"]);
    const confirmed = await t.listTrash();
    const seen: EmptyTrashProgress[] = [];
    await emptyTrash({ ...t.deps, confirmed, onProgress: (p) => seen.push(p) });
    const currents = seen.map((p) => p.current).filter((c): c is string => c !== null);
    expect(currents).toEqual(["Doc b", "Doc a"]);
    for (const p of seen) expect(p.total).toBeGreaterThanOrEqual(p.done);
    expect(seen.at(-1)).toMatchObject({ done: 2, total: 2, purged: 2, current: null });
    // Snapshots, not a shared array: an earlier report must not gain later failures.
    expect(seen[0]!.failures).toEqual([]);
  });

  test("totalHint makes progress report the full size from the first purge", async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `d${i}`);
    const t = fakeTrash(ids, { cap: 2 });
    const confirmed = await t.listTrash();
    const totals: number[] = [];
    await emptyTrash({ ...t.deps, confirmed, totalHint: 5, onProgress: (p) => totals.push(p.total) });
    expect(totals[0]).toBe(5);
    expect(new Set(totals)).toEqual(new Set([5]));
  });

  test("an empty confirmed set is a no-op with no listing at all", async () => {
    const t = fakeTrash([]);
    expect(await emptyTrash({ ...t.deps, confirmed: [] })).toEqual({ purged: 0, ...NONE });
    expect(t.listings).toEqual([]);
  });
});
