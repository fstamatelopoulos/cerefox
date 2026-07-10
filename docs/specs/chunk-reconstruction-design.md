# Design: chunk storage & lossless document reconstruction

> **Status**: Phase 0 + Phase 1 **CODE-COMPLETE** (2026-07-11) on `fix/chunk-reconstruction`,
> pending the supervised schema-0.8.0 deploy + live round-trip validation. Built: the
> exact-partition chunker (single consolidated TS impl), `content_format` on `cerefox_chunks`
> (§4.3), all 5 reconstruction branches, ingest `p_content_format`, callers passing format-2 +
> heading-breadcrumb embeddings, the doctor stats check, and `docs/guides/content-format.md`.
> Python parity dropped (retired at v1.0, workstream 28G). NOT deployed. Target v1.0.0.

## 1. The problem

Documents are stored as chunks and reassembled on read by
`cerefox_reconstruct_doc` (and 3 sibling RPCs) via
`STRING_AGG(content, E'\n\n' ORDER BY chunk_index)` — i.e. reconstruction
**re-synthesizes a `\n\n` separator it never stored**. That is only correct if the
chunker splits *exactly* at paragraph boundaries. Any other split point injects a
`\n\n` into the middle of content on read.

Two failure modes (both observed / proven):
- **Duplication** — the oversized-single-paragraph hard-split used
  `step = max_chars/2` with a `max_chars`-wide window → 50% overlap → the overlapped
  span was duplicated on reconstruction. (Trigger: a markdown table, which has no
  blank lines, so the whole table is one paragraph; once it exceeded `max_chunk_chars`
  it hit this path. 4 documents in the maintainer KB were corrupted this way.)
- **Mid-content blank lines** — even a *non-overlapping* char-split (`step = max_chars`)
  inserts a blank line mid-word / mid-table-row on reconstruction (e.g. `Source` →
  `Sour\n\nce`).

Root cause: **the reconstruction separator is not part of the stored data.**

## 2. Interim fix (already shipped, `feat/oauth-mcp`)

Keep an oversized single paragraph **whole** (one chunk) — never split inside a
paragraph, so the `\n\n`-join stays lossless. This fixes the corruption for all
realistic documents (tables up to the embedder's limit). Its limitation is exactly
what this design removes: a very large single paragraph becomes one huge chunk, and
the embedder (no input cap today) will reject a chunk over its token limit → ingest
failure. Regression test asserts `reconstruct(chunk(doc)) === doc`.

## 3. Phase 0 — embedding-input cap (safety, no migration)

Independent of the reconstruction redesign, and good regardless: **truncate the text
sent to the embedding model to its token limit**, and `log.warn` when truncation
happens (so a huge chunk is visible, not silent). The full chunk `content` is stored
and reconstructed untouched; only that chunk's *embedding* is computed on a prefix
(degraded search for that chunk, never an ingest failure).

- Where: the embedding call sites in `packages/memory/src/ingestion/pipeline.ts` (and
  the EF ingest path / `_shared/embeddings`). Cap the built input
  (`# {title}\n{...}\n{content}`) to a conservative char/token budget for
  `text-embedding-3-small` (8191 tokens; use a safe char proxy, configurable).
- This makes the interim keep-whole fix production-safe on its own.

## 4. Phase 1 — exact-partition chunks + versioned blind-stitch reconstruction

### 4.1 The invariant
Store chunks so that **blind concatenation reproduces the document**:
`concat(content[0..n]) === document` (no separator injected on read). Then a chunk
boundary may fall **anywhere** — including mid-paragraph at a size limit — with zero
corruption, which is what lets us bound chunk size again.

### 4.2 Chunker changes
- `content` becomes an **exact slice** of the (trimmed) document; the chunker no longer
  trims section bodies and re-joins with `\n\n`. Boundaries are chosen at headings →
  paragraph (`\n\n`) boundaries → a hard size limit (a big single paragraph splits at
  the size limit; losslessly, since reconstruction adds nothing).
- **Heading context moves from stored content to the embedding input.** A mid-section
  chunk no longer needs the `## heading` line embedded in its `content` (that would
  break the exact partition). Instead the embedding input becomes
  `# {doc_title}\n{heading_path breadcrumb}\n{content}`, taking the breadcrumb from the
  already-stored `heading_path` metadata. Stored content stays a clean partition;
  search still gets full heading context. (`heading_path`, `heading_level`, `title`
  metadata are computed as today.)
- **Python parity dropped (decided 2026-07-10).** Python is fully retired at v1.0
  (workstream 28G), so `src/cerefox/chunking/markdown.py` is NOT updated to format-2.
  The frozen Python MCP keeps its interim keep-whole fix and produces **format-1**
  chunks (lossless via the `\n\n` branch); only the TS chunker
  (`_shared/ingest/chunker.ts`) produces **format-2** blind-stitch. The versioned
  reconstruction (§4.3) handles both, so nothing breaks during the deprecation window.

### 4.2b Chunker consolidation — REQUIRED FIRST (discovered 2026-07-10)

The design above assumed one TS chunker. There are **three**, plus Python:
1. `_shared/ingest/chunker.ts` — used by the CLI/web/pipeline (`packages/memory/src/ingestion/pipeline.ts`).
2. `_shared/mcp-tools/_chunker.ts` — used by `_shared/mcp-tools/ingest.ts` (local MCP + `cerefox-mcp` EF).
3. `supabase/functions/cerefox-ingest/index.ts` inline `chunkMarkdown` — the GPT-Actions ingest path.

A partial/inconsistent Phase-1 change across these would itself corrupt data, so **consolidate to
one before rewriting**. `_shared/ingest/index.ts` claims Deno EFs "can't import from `_shared/`",
but iter-28E disproved that (the EFs now import `ef-auth`/`ef-meta`/`embeddings` via the bundler).
Plan: point (2) and (3) at `_shared/ingest/chunker.ts`; add `"ingest"` to the
`bundle_server_assets.ts` subtree list; delete the two duplicate copies. Then the exact-partition
rewrite is a single change. **Status: the exact-partition algorithm + `blindStitch` + invariant
tests are written and green as `chunkMarkdownExact` (unwired); consolidation + swap-in is the next
step.**

### 4.3 Reconstruction (backward-compatible, versioned)

**REVISED (2026-07-11) — put `content_format` on `cerefox_chunks`, NOT `cerefox_documents`.**
Cerefox uses **chunks-anchored versioning** (design decision 7): a document's history lives in
`cerefox_chunks.version_id` (NULL = current, UUID = archived), with no separate content table.
An archived version can therefore have a *different* format than the current one (e.g. a doc
first ingested format-1, later re-saved format-2 — the archived format-1 chunks must still
reconstruct with `\n\n`). If the flag lived on `cerefox_documents`, reconstruction site **#5
below (`p_version_id`, the archived-version read) would use the current doc's format and corrupt
the archived copy.** The format belongs *with the chunks*, exactly like `version_id`.

- New column `cerefox_chunks.content_format SMALLINT NOT NULL DEFAULT 1` (`1` = legacy `\n\n`-join;
  `2` = blind-stitch). Adding a column with a constant default is metadata-only in PG 11+ (no
  rewrite of the large chunks table).
- The ingest RPC gains `p_content_format SMALLINT DEFAULT 1` and stamps it **on each chunk row**
  it inserts. TS callers (new chunker) pass `2`; anything else defaults to `1`.
- The **5** reconstruction sites (`rpcs.sql`, schema 0.7.0: lines ~406, ~683, ~693, ~869, ~1512 —
  four reconstruct current `version_id IS NULL`, #869 reconstructs an archived version) branch
  uniformly on the aggregated chunks' format:
  `CASE WHEN MAX(c.content_format) >= 2 THEN STRING_AGG(c.content, '' ORDER BY c.chunk_index)
        ELSE STRING_AGG(c.content, E'\n\n' ORDER BY c.chunk_index) END`
  (all chunks in one group share a format, so `MAX` = "the group's format"; this handles current
  AND archived with one pattern — no per-site current/archived special-casing).
- Schema bump: `schema_version` 0.7.0 → 0.8.0 (both literals in lockstep).

### 4.4 Migration — lazy, zero forced re-embed
- **Existing documents stay `content_format = 1`** and reconstruct exactly as today.
- A document **flips to `2` the next time it is written** (re-chunked by the new
  chunker). No mass re-embed; existing large KBs are untouched until edited.
- **Eager option:** `cerefox server reindex` re-chunks + re-embeds and stamps
  `content_format = 2` (offer, don't force).

### 4.5 Doctor check
`cerefox doctor` reports migration progress:
*"N of M documents use the legacy reconstruction format (auto-convert on next edit;
run `cerefox server reindex` to convert now)."* Informational, not a gate. Needs the
`content_format` column, so it ships with Phase 1. A fresh install shows 0 legacy.

## 5. Acceptance tests
- **The invariant** (the one that would have caught this bug): for a corpus of inputs
  — plain prose, multi-heading docs, a markdown table larger than `max_chunk_chars`, a
  single blank-line-free paragraph larger than `max_chunk_chars`, unicode/multibyte,
  trailing/leading whitespace — assert `blindStitch(chunk(doc)) === trim(doc)` for
  format-2, and `join('\n\n', chunk_legacy(doc))` still equals the legacy expectation
  for format-1.
- **No chunk exceeds the size limit** (bounded chunks again).
- **Reconstruction-RPC branch**: legacy-format doc reconstructs with `\n\n`; new-format
  doc reconstructs by blind concat; a live round-trip through the ingest RPC + a read.
- **Remove the `python-parity` chunking fixtures** (Python retired at v1.0, 28G) and
  replace their coverage with the format-2 invariant tests above.

## 6. Risks & rollout
- Changing how *new* writes are stored right before the v1.0 stability freeze is the
  main risk — mitigated by: versioning (old docs unaffected), the strong `reconstruct
  === original` acceptance test, and lazy migration (no big-bang).
- Doing this **before** 1.0 means the frozen format is the correct one; doing it after
  would be a format migration under the stability contract. So: before 1.0.
- The interim keep-whole fix stays until Phase 1 lands (no regression window).

## 7. References
- Interim fix: `fix(chunker): keep oversized single paragraphs whole` (shipped on `main`);
  regression test in `_shared/__tests__/ingest-chunker.test.ts`.
- Reconstruction sites: `src/cerefox/db/rpcs.sql` (`STRING_AGG(c.content, E'\n\n' …)`,
  5 occurrences — see §4.3).
