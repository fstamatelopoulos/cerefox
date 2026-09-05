/**
 * The "Empty trash" loop, without a browser (`cd frontend && bun run test:unit`).
 *
 * The loop is the whole feature's logic: there is no bulk endpoint, so what
 * gets purged, in what order, what happens on a failure and when the run
 * ends are all decided here. The modal only renders what it reports.
 */
import { describe, expect, test } from "bun:test";

import { emptyTrash, type EmptyTrashProgress, type TrashEntry } from "../../src/lib/emptyTrash";

/** An in-memory trash: purge removes; a listing is capped like the server's. */
function fakeTrash(ids: string[], opts: { cap?: number; failing?: Set<string> } = {}) {
  const trash = new Map(ids.map((id) => [id, { id, title: `Doc ${id}` }]));
  const purged: string[] = [];
  const listings: number[] = [];
  return {
    purged,
    listings,
    trash,
    deps: {
      listTrash: async (): Promise<TrashEntry[]> => {
        const rows = [...trash.values()].slice(0, opts.cap ?? 500);
        listings.push(rows.length);
        return rows;
      },
      purge: async (id: string) => {
        if (opts.failing?.has(id)) throw new Error(`refused ${id}`);
        trash.delete(id);
        purged.push(id);
      },
    },
  };
}

describe("emptyTrash", () => {
  test("purges every document one call at a time and ends when the trash is empty", async () => {
    const t = fakeTrash(["a", "b", "c"]);
    const result = await emptyTrash(t.deps);
    expect(result).toEqual({ purged: 3, failures: [], stopped: false });
    expect(t.purged).toEqual(["a", "b", "c"]);
    expect(t.trash.size).toBe(0);
    // One listing to find them, one to confirm nothing is left.
    expect(t.listings).toEqual([3, 0]);
  });

  test("re-lists past the server cap until nothing new comes back", async () => {
    const ids = Array.from({ length: 7 }, (_, i) => `d${i}`);
    const t = fakeTrash(ids, { cap: 3 });
    const result = await emptyTrash(t.deps);
    expect(result.purged).toBe(7);
    expect(t.trash.size).toBe(0);
    expect(t.listings).toEqual([3, 3, 1, 0]);
  });

  test("a failure is recorded, not retried, and does not stop the others", async () => {
    const t = fakeTrash(["a", "b", "c"], { failing: new Set(["b"]) });
    const result = await emptyTrash(t.deps);
    expect(result.purged).toBe(2);
    expect(result.failures).toEqual([{ id: "b", title: "Doc b", error: "refused b" }]);
    expect(result.stopped).toBe(false);
    // "b" is still in the trash and was listed again, but never attempted twice:
    // the loop must terminate on a document that will not go away.
    expect(t.trash.has("b")).toBe(true);
    expect(t.listings).toEqual([3, 1]);
  });

  test("shouldStop ends the run after the purge in flight", async () => {
    const t = fakeTrash(["a", "b", "c", "d"]);
    let stop = false;
    const result = await emptyTrash({
      ...t.deps,
      purge: async (id) => {
        await t.deps.purge(id);
        if (id === "b") stop = true;
      },
      shouldStop: () => stop,
    });
    expect(result).toEqual({ purged: 2, failures: [], stopped: true });
    expect(t.trash.size).toBe(2);
  });

  test("progress reports a growing done count, the current title, and a total that never shrinks below done", async () => {
    const t = fakeTrash(["a", "b"]);
    const seen: EmptyTrashProgress[] = [];
    await emptyTrash({ ...t.deps, onProgress: (p) => seen.push(p) });
    const currents = seen.map((p) => p.current).filter((c): c is string => c !== null);
    expect(currents).toEqual(["Doc a", "Doc b"]);
    for (const p of seen) expect(p.total).toBeGreaterThanOrEqual(p.done);
    expect(seen.at(-1)).toMatchObject({ done: 2, total: 2, purged: 2, current: null });
    // Snapshots, not a shared array: an earlier report must not gain later failures.
    expect(seen[0]!.failures).toEqual([]);
  });

  test("an empty trash is a no-op with one listing", async () => {
    const t = fakeTrash([]);
    expect(await emptyTrash(t.deps)).toEqual({ purged: 0, failures: [], stopped: false });
    expect(t.listings).toEqual([0]);
  });
});
