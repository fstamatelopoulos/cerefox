# Document content format (chunk reconstruction)

Cerefox stores each document as a set of **chunks** (for search and small-to-big
retrieval) and reassembles the full text from those chunks whenever you read a
document. The **content format** records *how* a document's chunks reassemble.
You normally never need to think about it: it exists so that a fix shipped in a
later version can't change how your older documents read back.

There are two formats:

| Format | Meaning | When |
|---|---|---|
| **1 — legacy** | Chunk contents were trimmed sections; the full document is rebuilt by joining them with a blank line (`\n\n`) on read. | Every document written before the fix (Cerefox ≤ 0.11.x). |
| **2 — blind-stitch** | Chunk contents are an exact, gapless slice-by-slice partition of the document; the full document is rebuilt by plain concatenation (nothing is inserted between chunks). | Documents written by the newer exact-partition chunker. |

## Why it exists

The older reconstruction always inserted a `\n\n` between chunks on read — a
separator that was **never actually stored**. That is only correct if a chunk
boundary falls exactly on a paragraph break. When a boundary fell elsewhere (for
example, inside a large markdown table that has no blank lines), reconstruction
injected a spurious blank line mid-content — splitting a table row, or turning
`Source` into `Sour` + blank line + `ce`. A handful of large documents were
corrupted this way.

Format 2 fixes this at the root: because the stored chunks are an exact partition
of the document, reconstruction just concatenates them and gets the original back
byte-for-byte, so a chunk boundary can fall anywhere with zero corruption.

The format is stored **per chunk** (on `cerefox_chunks`), not per document, so an
archived version of a document always reconstructs with the format it was written
in — even after the current version has moved to format 2.

## Do I need to do anything?

**No.** The migration is lazy and safe:

- **Existing documents keep format 1** and reconstruct exactly as they always did.
  Nothing is re-processed, nothing re-embeds.
- A document **moves to format 2 automatically the next time it is edited/saved**
  (it gets re-chunked by the new chunker).
- If you want to convert everything now rather than on next edit, run
  `cerefox server reindex` (re-chunks + re-embeds the whole knowledge base).

`cerefox doctor` reports how many documents still use the legacy format — purely
informational, never a failure. A fresh install shows zero.

## For contributors

- Column: `cerefox_chunks.content_format SMALLINT NOT NULL DEFAULT 1`.
- The ingest RPC (`cerefox_ingest_document`) takes `p_content_format` and stamps it
  on every chunk it writes; the exact-partition chunker path passes `2`.
- The reconstruction RPCs branch on `MAX(content_format) >= 2` per aggregated group
  (blind concat vs the legacy `\n\n`-join).
- Design: `docs/specs/chunk-reconstruction-design.md`.
