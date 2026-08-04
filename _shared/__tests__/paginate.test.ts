import { describe, expect, test } from "bun:test";

import { fetchAllPages } from "../db-client/paginate.js";

/** Simulates PostgREST: honors the requested range, but never returns more
 *  than `serverCap` rows per response — the behavior that silently truncates
 *  unpaginated selects (#131). */
function makeCappedServer(totalRows: number, serverCap = 1000) {
  const rows = Array.from({ length: totalRows }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  return {
    calls,
    query(from: number, to: number) {
      calls.push([from, to]);
      const requested = rows.slice(from, to + 1);
      return Promise.resolve({
        data: requested.slice(0, serverCap),
        error: null,
      });
    },
  };
}

describe("fetchAllPages", () => {
  test("returns every row past the server cap", async () => {
    // 2,500 rows against a 1000-row cap: a one-shot select gets 1000 and
    // cannot tell it was truncated. The paginated walk must get all 2,500.
    const server = makeCappedServer(2500);
    const rows = await fetchAllPages<{ id: number }>((from, to) =>
      server.query(from, to),
    );
    expect(rows.length).toBe(2500);
    expect(rows[0].id).toBe(0);
    expect(rows[2499].id).toBe(2499);
    // No duplicates, no gaps.
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
  });

  test("issues ranged requests within the cap", async () => {
    const server = makeCappedServer(450, 1000);
    await fetchAllPages((from, to) => server.query(from, to), 200);
    expect(server.calls).toEqual([
      [0, 199],
      [200, 399],
      [400, 599],
    ]);
  });

  test("one-shot fetch demonstrates the truncation this helper prevents", async () => {
    // The old pattern: a single unbounded request. The server cap makes the
    // short read indistinguishable from a complete one.
    const server = makeCappedServer(2500);
    const { data } = await server.query(0, Number.MAX_SAFE_INTEGER);
    expect(data.length).toBe(1000); // silently a prefix of 2,500
  });

  test("empty result", async () => {
    const server = makeCappedServer(0);
    const rows = await fetchAllPages((from, to) => server.query(from, to));
    expect(rows).toEqual([]);
  });

  test("exact page-boundary total does not loop forever", async () => {
    const server = makeCappedServer(400, 1000);
    const rows = await fetchAllPages((from, to) => server.query(from, to), 200);
    expect(rows.length).toBe(400);
    // 2 full pages + 1 empty probe (page.length < batchSize terminates).
    expect(server.calls.length).toBe(3);
  });

  test("propagates errors", async () => {
    await expect(
      fetchAllPages(() =>
        Promise.resolve({ data: null, error: { message: "boom" } }),
      ),
    ).rejects.toThrow("boom");
  });
});
