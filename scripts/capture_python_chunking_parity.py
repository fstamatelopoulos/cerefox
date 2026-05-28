#!/usr/bin/env python
"""Capture Python `chunk_markdown` output for the iter-25 / v0.7 TS port.

Writes one JSON file per fixture under
`packages/memory/test/fixtures/python-parity/chunking/`. The TS chunker
in `_shared/ingest/chunker.ts` (Part 25A) must produce byte-identical
output for every fixture.

Also captures a single OpenAI embedding for a known reference string,
saved to `packages/memory/test/fixtures/python-parity/embedding/
reference.json`. The TS embedder in Part 25B asserts cosine similarity
within 1e-6 against this baseline.

Run from the repo root: `uv run python scripts/capture_python_chunking_parity.py`.
Idempotent — safe to re-run; overwrites existing fixtures.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict
from pathlib import Path

# Make src/ importable when run from repo root.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from cerefox.chunking.markdown import chunk_markdown  # noqa: E402

OUT_CHUNKING = REPO_ROOT / "packages/memory/test/fixtures/python-parity/chunking"
OUT_EMBEDDING = REPO_ROOT / "packages/memory/test/fixtures/python-parity/embedding"
OUT_CHUNKING.mkdir(parents=True, exist_ok=True)
OUT_EMBEDDING.mkdir(parents=True, exist_ok=True)

# ── Fixtures ─────────────────────────────────────────────────────────────────
# Each fixture is (name, markdown_text). Names map to <name>.json output files.

FIXTURES: list[tuple[str, str]] = [
    # 1. Small document → single chunk (short-circuit branch).
    ("01-short", "# Tiny\n\nJust a small paragraph. Should fit in one chunk.\n"),

    # 2. Headless content (preamble only, under max).
    (
        "02-no-headings",
        "Plain text with no headings at all.\n\n"
        "Just paragraphs separated by blank lines. "
        "Tests the level-0 preamble path.\n",
    ),

    # 3. Multiple H1/H2/H3 sections, all under max → still single chunk because total is small.
    (
        "03-heading-light",
        "# Top\n\nIntro paragraph.\n\n"
        "## Section A\n\nA paragraph.\n\n"
        "## Section B\n\nAnother paragraph.\n\n"
        "### Subsection B.1\n\nDeeper content.\n",
    ),

    # 4. Many sections, each small individually but total > max_chunk_chars
    #    → forces greedy accumulation across multiple chunks.
    (
        "04-heading-heavy",
        "# Document\n\n"
        + ("Long intro paragraph. " * 30)
        + "\n\n## Section 1\n\n"
        + ("Body text of section 1. " * 50)
        + "\n\n## Section 2\n\n"
        + ("Body text of section 2. " * 50)
        + "\n\n## Section 3\n\n"
        + ("Body text of section 3. " * 50)
        + "\n\n## Section 4\n\n"
        + ("Body text of section 4. " * 50)
        + "\n\n### Subsection 4.1\n\n"
        + ("Deeper detail. " * 50)
        + "\n",
    ),

    # 5. One section exceeds max → paragraph-split path.
    (
        "05-oversized-section",
        "# Big Doc\n\n"
        "## The Long Section\n\n"
        + "\n\n".join(
            [
                f"Paragraph {i}. " + ("Filler content. " * 30)
                for i in range(20)
            ]
        )
        + "\n",
    ),

    # 6. CRLF line endings (normalisation test). The chunker doesn't normalise
    #    line endings itself — the caller is expected to, OR the chunker treats
    #    \r\n as text. Capture what Python actually does so TS matches.
    (
        "06-crlf",
        "# CRLF Doc\r\n\r\nFirst paragraph with Windows endings.\r\n\r\n"
        "## Section\r\n\r\nMore content with carriage returns.\r\n",
    ),

    # 7. Unicode + emoji (multi-byte chars). Tests char_count vs byte_count.
    (
        "07-unicode",
        "# Unicode 🌍\n\n"
        "Multi-byte: café, naïve, résumé. Emoji: 🎉🚀💡.\n\n"
        "## CJK Test\n\n"
        "中文测试. 日本語テスト. 한국어 테스트.\n\n"
        "## Math\n\n"
        "∑ ∫ √ ≠ ≈ ∞\n",
    ),

    # 8. Empty input → returns []
    ("08-empty", ""),

    # 9. Heading-only (no body content).
    (
        "09-heading-only",
        "# Just A Heading\n\n## And Another\n\n### Even Deeper\n",
    ),

    # 10. H4/H5/H6 treated as body text (not chunk boundaries).
    (
        "10-h4-h6",
        "# Top\n\nIntro.\n\n"
        "## Section A\n\n"
        "Body before H4.\n\n"
        "#### Deep Heading 4\n\n"
        "Body under H4.\n\n"
        "##### Deep Heading 5\n\n"
        "Body under H5.\n\n"
        "###### Deep Heading 6\n\n"
        "Body under H6.\n",
    ),

    # 11. Trailing-hash heading (e.g. "## Section ##") — Python rstrip("#").
    (
        "11-trailing-hash",
        "# Title ###\n\nBody.\n\n## Sub ##\n\nMore body.\n",
    ),

    # 12. Mixed empty lines (3+ blank lines collapsed at paragraph parse?).
    (
        "12-many-blank-lines",
        "# Doc\n\n\n\nParagraph after extra blanks.\n\n\n\n\nAnother paragraph.\n",
    ),
]


def fixture_to_json(name: str, text: str) -> dict:
    chunks = chunk_markdown(text)
    return {
        "fixture": name,
        "input_text": text,
        "input_char_count": len(text),
        "chunk_count": len(chunks),
        "chunks": [asdict(c) for c in chunks],
    }


def main() -> None:
    print(f"Writing chunking fixtures to: {OUT_CHUNKING}")
    for name, text in FIXTURES:
        out = OUT_CHUNKING / f"{name}.json"
        with out.open("w", encoding="utf-8") as f:
            json.dump(fixture_to_json(name, text), f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"  ✓ {name}.json ({len(text)} chars → {len(chunk_markdown(text))} chunks)")

    # ── Embedding reference ──────────────────────────────────────────────
    # Single text → single embedding. TS embedder in Part 25B asserts
    # cosine similarity within 1e-6 against this baseline.
    ref_text = (
        "Cerefox is a user-owned knowledge memory layer for AI agents. "
        "It stores curated Markdown documents in Supabase and supports "
        "hybrid search via FTS and semantic embeddings."
    )

    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get(
        "CEREFOX_OPENAI_API_KEY"
    )
    if not api_key:
        print("  ⊘ embedding reference SKIPPED (no OPENAI_API_KEY in env)")
        return

    try:
        from cerefox.embeddings.cloud import CloudEmbedder

        embedder = CloudEmbedder(
            api_key=api_key,
            model="text-embedding-3-small",
            dimensions=768,
        )
        vector = embedder.embed(ref_text)
    except Exception as exc:  # noqa: BLE001
        print(f"  ⊘ embedding reference FAILED: {exc}")
        return

    out = OUT_EMBEDDING / "reference.json"
    with out.open("w", encoding="utf-8") as f:
        json.dump(
            {
                "text": ref_text,
                "model": "text-embedding-3-small",
                "dimensions": 768,
                "embedding": vector,
            },
            f,
            indent=2,
            ensure_ascii=False,
        )
        f.write("\n")
    print(f"  ✓ embedding/reference.json (dim={len(vector)})")


if __name__ == "__main__":
    main()
