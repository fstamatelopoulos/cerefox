"""Heading-aware markdown chunker.

Splits markdown text into chunks using a greedy section-accumulation strategy:

1. Short-circuit: if the entire document fits within *max_chunk_chars*, return
   it as a single chunk.  Splitting small documents at heading boundaries
   creates fragments too short to embed meaningfully.

2. For larger documents, parse the text into H1/H2/H3 sections (preamble
   before the first heading is treated as a level-0 section).

3. Greedy accumulation: sections are collected into a buffer until adding the
   next section would exceed *max_chunk_chars*.  When the buffer is full it is
   flushed as one chunk, and a new buffer starts with the current section.
   This keeps chunks close to the target size instead of creating many tiny
   fragments at every heading boundary.  H1, H2, and H3 sections are all
   treated equally — there are no hard heading-level boundaries.  Size alone
   controls when a chunk is flushed.

4. Oversized sections (a single heading section that already exceeds
   *max_chunk_chars*) are split at paragraph boundaries.  Resulting pieces
   smaller than *min_chunk_chars* are merged into the preceding piece.

5. Headings deeper than H3 (H4–H6) are treated as plain body text — they do
   not create chunk boundaries.

No overlaps are added between chunks: the heading breadcrumb embedded in the
content provides sufficient context for each chunk when read in isolation.
Overlaps cause duplicate content when chunks are concatenated for document
reconstruction.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Matches H1, H2, or H3 only.  Two capturing groups: the hashes and the heading text.
# Strips optional trailing hashes (e.g. "## Heading ##") via rstrip in _parse_sections.
_HEADING_RE = re.compile(r"^(#{1,3})\s+(.+)$", re.MULTILINE)

# Two or more blank lines separate paragraphs.
_PARAGRAPH_SEP = re.compile(r"\n{2,}")


@dataclass
class ChunkData:
    """A single chunk produced by the markdown chunker."""

    chunk_index: int
    heading_path: list[str]
    heading_level: int  # 0 = no heading (preamble or merged), 1–3 = H1–H3
    title: str          # last element of heading_path, or "" for preamble/merged
    content: str        # full text (includes heading lines for non-preamble chunks)
    char_count: int


def chunk_markdown(
    text: str,
    max_chunk_chars: int = 4000,
    min_chunk_chars: int = 100,
) -> list[ChunkData]:
    """Split *text* into heading-aware chunks using greedy accumulation.

    Args:
        text: Raw markdown string.
        max_chunk_chars: Target maximum characters per chunk.  Sections are
            accumulated greedily up to this limit.  A single section that
            already exceeds the limit is split at paragraph boundaries.
        min_chunk_chars: Minimum size for paragraph-level pieces produced when
            splitting an oversized section.  Pieces smaller than this are
            merged into the preceding piece.

    Returns:
        Ordered list of :class:`ChunkData` objects, zero-indexed.
    """
    stripped = text.strip()
    if not stripped:
        return []

    # Short-circuit: if the entire document fits within one chunk, skip
    # heading-based splitting entirely and return a single chunk.
    #
    # Splitting small documents at heading boundaries creates fragments that
    # are too short to embed meaningfully — a 60-char H2 section gives the
    # model almost no signal.  A single chunk preserves full context and
    # produces a better embedding.  Heading-aware splitting is only beneficial
    # for large documents where precision matters more than holistic context.
    if len(stripped) <= max_chunk_chars:
        return [
            ChunkData(
                chunk_index=0,
                heading_path=[],
                heading_level=0,
                title="",
                content=stripped,
                char_count=len(stripped),
            )
        ]

    sections = _parse_sections(stripped)
    chunks: list[ChunkData] = []
    heading_stack: list[str] = []  # current breadcrumb trail

    # ── Greedy accumulation buffer ────────────────────────────────────────────
    # Sections are collected here until adding the next would exceed
    # max_chunk_chars.  The first section's metadata (path/level/heading)
    # anchors the chunk's breadcrumb.
    buf_parts: list[str] = []   # content strings to be joined with "\n\n"
    buf_path: list[str] = []    # heading_path of the first section in buffer
    buf_level: int = 0          # heading_level of the first section
    buf_heading: str = ""       # heading title of the first section
    buf_chars: int = 0          # total chars in buffer (including "\n\n" separators)

    def _flush_buf() -> None:
        nonlocal buf_parts, buf_path, buf_level, buf_heading, buf_chars
        if not buf_parts:
            return
        content = "\n\n".join(buf_parts)
        _append_chunk(chunks, content, buf_path, buf_level, buf_heading, force_new=True)
        buf_parts = []
        buf_path = []
        buf_level = 0
        buf_heading = ""
        buf_chars = 0

    for level, heading, body in sections:
        # Maintain the breadcrumb stack.
        if level > 0:
            heading_stack = heading_stack[: level - 1]
            heading_stack.append(heading)
            path = list(heading_stack)
        else:
            path = []

        # Build the full content string for this section.
        if level > 0:
            header_line = "#" * level + " " + heading
            content = header_line + ("\n\n" + body if body else "")
        else:
            content = body

        if not content.strip():
            continue

        # Oversized single section: flush buffer first, then paragraph-split.
        if len(content) > max_chunk_chars:
            _flush_buf()
            header_prefix = ("#" * level + " " + heading + "\n\n") if level > 0 else ""
            pieces = _split_paragraphs(body, max_chunk_chars)
            for i, raw_piece in enumerate(pieces):
                piece = (header_prefix + raw_piece if i == 0 else raw_piece).strip()
                if not piece:
                    continue
                _append_chunk(
                    chunks, piece, path, level, heading,
                    force_new=(i == 0), min_chunk_chars=min_chunk_chars,
                )
            if not pieces:
                # Body was empty — heading-only content exceeded max (very rare).
                _append_chunk(chunks, content, path, level, heading, force_new=True)
            continue

        # Section fits within max_chunk_chars.  Try to accumulate it.
        # +2 accounts for the "\n\n" separator between accumulated parts.
        addition = len(content) + (2 if buf_parts else 0)

        if buf_chars + addition <= max_chunk_chars:
            # Fits in the current buffer — accumulate.
            if not buf_parts:
                # First section in a new buffer: capture its metadata.
                buf_path = path
                buf_level = level
                buf_heading = heading
            buf_parts.append(content)
            buf_chars += addition
        else:
            # Buffer would overflow — flush it, start a new buffer.
            _flush_buf()
            buf_parts = [content]
            buf_path = path
            buf_level = level
            buf_heading = heading
            buf_chars = len(content)

    _flush_buf()

    # Re-number after any merges.
    for i, chunk in enumerate(chunks):
        chunk.chunk_index = i

    return chunks


# ── Internal helpers ─────────────────────────────────────────────────────────


def _parse_sections(text: str) -> list[tuple[int, str, str]]:
    """Split *text* into ``(level, heading, body)`` tuples.

    ``level == 0`` represents a preamble — content before the first H1/H2/H3
    heading.  Its heading string is empty.

    Uses ``re.split()`` with capturing groups, which produces a flat list in
    the form ``[preamble, hashes, heading_text, body, hashes, heading_text, body, …]``.
    """
    segments: list[tuple[int, str, str]] = []

    parts = _HEADING_RE.split(text)
    # parts[0] is everything before the first heading match.
    preamble = parts[0].strip()
    if preamble:
        segments.append((0, "", preamble))

    # Remaining parts come in triples: (hashes, heading_text, body).
    for i in range(1, len(parts), 3):
        if i + 2 > len(parts):
            break
        hashes = parts[i]                           # e.g. "##"
        heading_text = parts[i + 1].rstrip("#").strip()
        body = parts[i + 2].strip()
        segments.append((len(hashes), heading_text, body))

    return segments


def _append_chunk(
    chunks: list[ChunkData],
    content: str,
    path: list[str],
    level: int,
    heading: str,
    force_new: bool = True,
    min_chunk_chars: int = 0,
) -> None:
    """Append *content* as a new :class:`ChunkData`.

    When *force_new* is ``False`` and the content is shorter than
    *min_chunk_chars*, it is merged into the previous chunk instead of
    creating a new one.  This is only used for paragraph-level pieces from
    oversized sections, never for heading-bounded chunks (those always pass
    ``force_new=True`` via the greedy accumulation logic).
    """
    if not force_new and len(content) < min_chunk_chars and chunks:
        prev = chunks[-1]
        prev.content = prev.content + "\n\n" + content
        prev.char_count = len(prev.content)
        return

    title = heading if level > 0 else (path[-1] if path else "")
    chunks.append(
        ChunkData(
            chunk_index=len(chunks),
            heading_path=path,
            heading_level=level,
            title=title,
            content=content,
            char_count=len(content),
        )
    )


def _split_paragraphs(text: str, max_chars: int) -> list[str]:
    """Split *text* at paragraph boundaries, keeping each piece under *max_chars*.

    Consecutive paragraphs are accumulated until adding the next one would
    exceed *max_chars*.  No overlap is added between pieces — the heading
    prefix (prepended by the caller for the first piece) provides sufficient
    context for each chunk when read in isolation.

    If a single paragraph is longer than *max_chars*, it is kept WHOLE as one
    piece — splitting inside a paragraph would corrupt document reconstruction,
    which joins chunks with "\n\n" (see the inline note below).
    """
    paragraphs = [p for p in _PARAGRAPH_SEP.split(text) if p.strip()]
    if not paragraphs:
        return []

    result: list[str] = []
    current_parts: list[str] = []
    current_len: int = 0

    for para in paragraphs:
        # +2 accounts for the "\n\n" separator between accumulated paragraphs.
        addition = len(para) + (2 if current_parts else 0)

        if current_len + addition <= max_chars:
            current_parts.append(para)
            current_len += addition
        else:
            if current_parts:
                result.append("\n\n".join(current_parts))
                current_parts = [para]
                current_len = len(para)
            else:
                # A single paragraph exceeds max_chars. Keep it WHOLE — never split
                # INSIDE a paragraph. cerefox_reconstruct_doc reassembles a document
                # by joining chunks with "\n\n", so any intra-paragraph split is lossy:
                # it inserts a spurious blank line at each seam (e.g. "Source" ->
                # "Sour\n\nce", and a markdown table gets a blank line mid-row). The
                # earlier step = max_chars // 2 char-slice ALSO overlapped, duplicating
                # content on reconstruction. Only paragraph ("\n\n") boundaries keep the
                # join lossless; a whole oversized paragraph is a valid single chunk.
                result.append(para)
                current_parts = []
                current_len = 0

    if current_parts:
        result.append("\n\n".join(current_parts))

    return result
