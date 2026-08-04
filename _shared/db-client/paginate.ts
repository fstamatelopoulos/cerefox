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
  for (;;) {
    const { data, error } = (await makeQuery(
      offset,
      offset + batchSize - 1,
    )) as PageResult<T>;
    if (error) throw new Error(error.message ?? JSON.stringify(error));
    const page = data ?? [];
    results.push(...page);
    if (page.length < batchSize) break;
    offset += batchSize;
  }
  return results;
}
