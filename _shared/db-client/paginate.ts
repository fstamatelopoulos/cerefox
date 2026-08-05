/**
 * fetchAllPages — accumulate a PostgREST select past the server row cap.
 *
 * Supabase caps PostgREST responses at 1000 rows per request. A select
 * without `.range()` therefore silently returns a 1000-row prefix on large
 * tables — and because the short read is indistinguishable from a complete
 * one, callers that derive totals from `data.length` report the truncated
 * count as the whole result (#131).
 *
 * This is the pagination loop from `_shared/backup/supabase-adapter.ts`
 * generalized so every caller can use it: the caller supplies a factory
 * that builds its own filtered/ordered query and applies the given range;
 * the helper walks the pages and concatenates.
 *
 * The caller's query MUST include a stable `.order(...)` (unique or
 * near-unique column, e.g. `id` or `created_at`) — range pagination over an
 * unordered select can skip or duplicate rows between pages.
 */

interface PageResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
  /** PostgREST's total row count, present when the query requested
   *  `count: "exact"`. Used as a self-check (#135). */
  count?: number | null;
}

/** The query parameter accepts any thenable resolving to a `{ data, error }`
 *  pair (normalized internally) so supabase-js `PostgrestFilterBuilder`
 *  chains can be passed directly — their response generics don't structurally
 *  match a loose local type, which is why older call sites resorted to
 *  `as never` casts. */
export async function fetchAllPages<T>(
  makeQuery: (from: number, to: number) => PromiseLike<unknown>,
  batchSize = 200,
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  let serverTotal: number | null = null;
  for (;;) {
    const { data, error, count } = (await makeQuery(
      offset,
      offset + batchSize - 1,
    )) as PageResult<T>;
    if (error) throw new Error(error.message ?? JSON.stringify(error));
    // PostgREST reports the unpaginated total when the caller asked for
    // `count: "exact"`. Remember it so we can prove completeness below.
    if (typeof count === "number") serverTotal = count;
    const page = data ?? [];
    results.push(...page);
    if (page.length < batchSize) break;
    offset += batchSize;
  }
  // Self-check (#135): a short read is otherwise indistinguishable from a
  // complete one — the failure mode behind #131 (a truncated backup that
  // reported success). When the caller opted into `count: "exact"`, refuse to
  // return a prefix silently.
  if (serverTotal !== null && results.length !== serverTotal) {
    throw new Error(
      `Paginated read returned ${results.length} row(s) but the server reports ` +
        `${serverTotal}. Refusing to return a partial result — retry, and if this ` +
        `persists please report it (the rows may be changing under the read).`,
    );
  }
  return results;
}
