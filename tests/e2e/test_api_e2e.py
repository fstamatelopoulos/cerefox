"""E2E tests for the Cerefox API against a live Supabase instance.

Run with: uv run pytest -m e2e
Or:       uv run pytest tests/e2e/ -m e2e

These tests create real data in the database and clean up after themselves.
All test document titles start with [E2E] for easy identification.
"""

from __future__ import annotations

import time

import pytest

from cerefox.db.client import CerefoxClient
from cerefox.ingestion.pipeline import IngestionPipeline

from .conftest import E2ECleanup, EdgeFunctionClient

pytestmark = pytest.mark.e2e

# ── Test content ────────────────────────────────────────────────────────────

SAMPLE_CONTENT = """\
# The Luminous Archipelago

The Luminous Archipelago is a chain of floating islands in the eastern reaches
of Teliboria, known for their bioluminescent flora and ancient crystal spires.

## Geography

The archipelago consists of seven major islands, each suspended above the
Cerulean Depths by an unknown magical force. The islands range in size from
the tiny Shimmer Islet to the sprawling Radiance Major.

## History

### The First Settlers

The Luminari people arrived on the archipelago roughly 3,000 years ago,
drawn by the glow visible from the mainland coast. They developed a
unique culture centered on light manipulation and crystal harmonics.

### The Crystal Wars

A conflict erupted in the year 1247 when rival factions sought control
of the Great Resonance Crystal on Radiance Major. The war lasted twelve
years and reshaped the political landscape of the entire region.
"""

SAMPLE_METADATA = {"author": "e2e-test-suite", "genre": "worldbuilding"}


# ── 1. Supabase REST API tests ─────────────────────────────────────────────


class TestDocumentLifecycle:
    """Tests 1.1–1.10: Full document lifecycle via the Python client."""

    def test_ingest_and_verify(
        self,
        e2e_client: CerefoxClient,
        e2e_pipeline: IngestionPipeline | None,
        cleanup: E2ECleanup,
        unique_title,
    ):
        """1.1–1.10: Ingest → verify → search → update metadata → delete."""
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured (no OPENAI_API_KEY)")

        title = unique_title("Luminous Archipelago")

        # 1.1 Ingest
        result = e2e_pipeline.ingest_text(
            SAMPLE_CONTENT, title, metadata=SAMPLE_METADATA,
        )
        doc_id = result.document_id
        cleanup.track_document(doc_id)

        assert doc_id is not None
        assert result.chunk_count >= 1
        assert result.total_chars > 0
        assert result.action == "created"

        # 1.2 List documents — verify it appears
        docs = e2e_client.list_documents(limit=50)
        doc_ids = [d["id"] for d in docs]
        assert doc_id in doc_ids

        # 1.3 Get document by ID
        doc = e2e_client.get_document_by_id(doc_id)
        assert doc is not None
        assert doc["title"] == title
        assert doc["metadata"]["author"] == "e2e-test-suite"

        # 1.4 Find document by title
        found = e2e_client.find_document_by_title(title)
        assert found is not None
        assert found["id"] == doc_id

        # 1.5 Update document metadata
        e2e_client.update_document(doc_id, {
            "metadata": {"author": "e2e-updated", "genre": "worldbuilding", "status": "draft"},
        })
        updated = e2e_client.get_document_by_id(doc_id)
        assert updated["metadata"]["author"] == "e2e-updated"
        assert updated["metadata"]["status"] == "draft"

        # 1.6 List chunks for document
        chunks = e2e_client.list_chunks_for_document(doc_id)
        assert len(chunks) == result.chunk_count
        assert all(c["document_id"] == doc_id for c in chunks)
        assert all(c["char_count"] > 0 for c in chunks)
        # Verify chunks are ordered
        indices = [c["chunk_index"] for c in chunks]
        assert indices == sorted(indices)

        # 1.7 Reconstruct document
        reconstructed = e2e_client.reconstruct_doc(doc_id)
        assert reconstructed is not None
        assert "Luminous Archipelago" in reconstructed.get("full_content", "")
        assert reconstructed["doc_title"] == title

        # 1.8 List metadata keys — verify our test keys appear
        meta_keys = e2e_client.list_metadata_keys()
        key_names = [k["key"] for k in meta_keys]
        # After the update, we should see author, genre, status
        assert "author" in key_names or "genre" in key_names

        # 1.9 FTS search
        fts_results = e2e_client.fts_search("Luminous Archipelago", match_count=10)
        found_ids = [r.get("document_id") for r in fts_results]
        assert doc_id in found_ids, f"FTS did not find doc {doc_id}. Results: {found_ids}"

        # 1.10 Delete document
        e2e_client.delete_document(doc_id)
        cleanup.document_ids.remove(doc_id)  # Already deleted
        deleted = e2e_client.get_document_by_id(doc_id)
        assert deleted is None

        # Verify chunks are also gone (CASCADE)
        remaining_chunks = e2e_client.list_chunks_for_document(doc_id)
        assert len(remaining_chunks) == 0


class TestContentHashDedup:
    """Test 1.14: Content hash deduplication."""

    def test_duplicate_content_is_skipped(
        self,
        e2e_pipeline: IngestionPipeline | None,
        cleanup: E2ECleanup,
        unique_title,
    ):
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured")

        content = "# Dedup Test\n\nThis is a deduplication test document."
        title1 = unique_title("Dedup Original")
        title2 = unique_title("Dedup Copy")

        result1 = e2e_pipeline.ingest_text(content, title1)
        cleanup.track_document(result1.document_id)
        assert result1.action == "created"

        result2 = e2e_pipeline.ingest_text(content, title2)
        assert result2.skipped is True
        # Should return the original document's ID
        assert result2.document_id == result1.document_id


class TestProjectCRUD:
    """Test 1.11: Project create, list, get, update, delete."""

    def test_project_lifecycle(
        self,
        e2e_client: CerefoxClient,
        cleanup: E2ECleanup,
        unique_title,
    ):
        name = unique_title("Test Project")

        # Create
        project = e2e_client.create_project(name, "E2E test project")
        project_id = project["id"]
        cleanup.track_project(project_id)
        assert project["name"] == name

        # List
        projects = e2e_client.list_projects()
        project_ids = [p["id"] for p in projects]
        assert project_id in project_ids

        # Get by ID
        fetched = e2e_client.get_project_by_id(project_id)
        assert fetched is not None
        assert fetched["name"] == name

        # Update
        new_name = unique_title("Updated Project")
        updated = e2e_client.update_project(project_id, {"name": new_name})
        assert updated["name"] == new_name

        # Delete
        e2e_client.delete_project(project_id)
        cleanup.project_ids.remove(project_id)
        deleted = e2e_client.get_project_by_id(project_id)
        assert deleted is None


class TestDocumentProjectAssignment:
    """Test 1.12–1.13: Document-project M2M and count."""

    def test_assign_and_count(
        self,
        e2e_client: CerefoxClient,
        e2e_pipeline: IngestionPipeline | None,
        cleanup: E2ECleanup,
        unique_title,
    ):
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured")

        title = unique_title("Project Assignment Test")
        project_name = unique_title("Assignment Project")

        # Create doc and project
        result = e2e_pipeline.ingest_text(
            "# Assignment Test\n\nTest document for project assignment.", title,
        )
        doc_id = result.document_id
        cleanup.track_document(doc_id)

        project = e2e_client.create_project(project_name)
        project_id = project["id"]
        cleanup.track_project(project_id)

        # 1.12 Assign document to project
        e2e_client.assign_document_projects(doc_id, [project_id])
        assigned = e2e_client.get_document_project_ids(doc_id)
        assert project_id in assigned

        # 1.13 Count documents in project
        count = e2e_client.count_documents(project_id=project_id)
        assert count == 1

        total_count = e2e_client.count_documents()
        assert total_count >= 1

        # Unassign
        e2e_client.assign_document_projects(doc_id, [])
        unassigned = e2e_client.get_document_project_ids(doc_id)
        assert project_id not in unassigned


# ── 1b. Versioning lifecycle tests ─────────────────────────────────────────


CONTENT_V1 = """\
# Versioning Test Document

This is version one of the document.

## Section Alpha

Alpha content for the first version.
"""

CONTENT_V2 = """\
# Versioning Test Document

This is version two of the document, with different content.

## Section Beta

Beta content replaces alpha in the second version.
"""


class TestVersioningLifecycle:
    """Ingest → update → verify version created → retrieve version → delete with cascade."""

    def test_update_creates_version_and_archived_chunks(
        self,
        e2e_client: CerefoxClient,
        e2e_pipeline: IngestionPipeline | None,
        cleanup: E2ECleanup,
        unique_title,
    ):
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured")

        title = unique_title("Versioning Lifecycle")

        # Create initial document
        result_v1 = e2e_pipeline.ingest_text(CONTENT_V1, title)
        doc_id = result_v1.document_id
        cleanup.track_document(doc_id)
        assert result_v1.action == "created"
        chunks_v1 = result_v1.chunk_count

        # No versions yet
        versions = e2e_client.list_document_versions(doc_id)
        assert versions == []

        # Update with new content — should create a version
        result_v2 = e2e_pipeline.update_document(doc_id, CONTENT_V2, title)
        assert result_v2.reindexed is True

        # Exactly one version should exist (the snapshot of v1)
        versions = e2e_client.list_document_versions(doc_id)
        assert len(versions) == 1
        v = versions[0]
        assert v["version_number"] == 1
        assert v["chunk_count"] == chunks_v1
        assert v["total_chars"] > 0
        assert v["source"] == "manual"
        version_id = v["version_id"]

        # Current chunks should reflect v2 content (version_id IS NULL)
        current_chunks = e2e_client.list_chunks_for_document(doc_id)
        assert len(current_chunks) == result_v2.chunk_count
        assert all(c["version_id"] is None for c in current_chunks)

        # Retrieve archived v1 content
        v1_content = e2e_client.get_document_content(doc_id, version_id=version_id)
        assert v1_content is not None
        assert "Alpha content" in v1_content["full_content"]
        assert "Beta content" not in v1_content["full_content"]

        # Current content via reconstruct_doc should be v2
        current = e2e_client.reconstruct_doc(doc_id)
        assert "Beta content" in current["full_content"]
        assert "Alpha content" not in current["full_content"]

        # Delete document — versions and archived chunks should cascade
        e2e_client.delete_document(doc_id)
        cleanup.document_ids.remove(doc_id)

        assert e2e_client.get_document_by_id(doc_id) is None
        assert e2e_client.list_chunks_for_document(doc_id) == []
        assert e2e_client.list_document_versions(doc_id) == []

    def test_metadata_only_update_skips_versioning(
        self,
        e2e_client: CerefoxClient,
        e2e_pipeline: IngestionPipeline | None,
        cleanup: E2ECleanup,
        unique_title,
    ):
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured")

        title = unique_title("Versioning Metadata Only")

        result = e2e_pipeline.ingest_text(CONTENT_V1, title)
        doc_id = result.document_id
        cleanup.track_document(doc_id)

        # Update with identical content (metadata change only)
        result2 = e2e_pipeline.update_document(doc_id, CONTENT_V1, title)
        assert result2.reindexed is False

        # No version should have been created
        versions = e2e_client.list_document_versions(doc_id)
        assert versions == []


# ── 2. Edge Function tests ─────────────────────────────────────────────────


class TestEdgeFunctionIngest:
    """Tests 2.1, 2.4, 2.5: cerefox-ingest Edge Function."""

    def test_ingest_and_dedup(
        self, e2e_edge: EdgeFunctionClient | None, e2e_client, cleanup, unique_title,
    ):
        if e2e_edge is None:
            pytest.skip("No JWT key for Edge Functions (set CEREFOX_SUPABASE_ANON_KEY)")
        title = unique_title("Edge Ingest Test")
        content = "# Edge Ingest\n\nThis document was ingested via the Edge Function."
        metadata = {"source_test": "e2e", "layer": "edge-function"}

        # 2.1 Ingest via Edge Function
        data = e2e_edge.invoke("cerefox-ingest", {
            "title": title,
            "content": content,
            "metadata": metadata,
        })
        assert "error" not in data, f"Ingest failed: {data}"
        doc_id = data["document_id"]
        cleanup.track_document(doc_id)

        assert data["title"] == title
        assert data["chunk_count"] >= 1

        # Verify doc exists in DB
        doc = e2e_client.get_document_by_id(doc_id)
        assert doc is not None
        assert doc["title"] == title
        assert doc["metadata"]["source_test"] == "e2e"

        # 2.5 Dedup — same content again
        data2 = e2e_edge.invoke("cerefox-ingest", {
            "title": unique_title("Edge Ingest Dedup"),
            "content": content,
        })
        assert data2.get("skipped") is True
        assert data2["document_id"] == doc_id

        # 2.4 Update — different content, same title, update_if_exists=true
        updated_content = content + "\n\n## Update\n\nThis section was added by the e2e test."
        data3 = e2e_edge.invoke("cerefox-ingest", {
            "title": title,
            "content": updated_content,
            "update_if_exists": True,
        })
        assert "error" not in data3, f"Update failed: {data3}"
        assert data3.get("updated") is True
        assert data3["document_id"] == doc_id


class TestEdgeFunctionSearch:
    """Test 2.2: cerefox-search Edge Function."""

    def test_fts_search(
        self, e2e_edge: EdgeFunctionClient | None, e2e_pipeline, cleanup, unique_title,
    ):
        if e2e_edge is None:
            pytest.skip("No JWT key for Edge Functions (set CEREFOX_SUPABASE_ANON_KEY)")
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured")

        title = unique_title("Edge Search Target")
        content = (
            "# Crystalline Resonance Theory\n\n"
            "The crystalline resonance theory posits that certain mineral formations "
            "can amplify psychic frequencies across dimensional boundaries."
        )

        result = e2e_pipeline.ingest_text(content, title)
        cleanup.track_document(result.document_id)

        # Small delay for indexing
        time.sleep(1)

        # 2.2 Search via Edge Function (FTS mode — no embedding cost)
        data = e2e_edge.invoke("cerefox-search", {
            "query": "crystalline resonance",
            "mode": "fts",
            "match_count": 10,
        })
        assert "error" not in data, f"Search failed: {data}"
        assert "results" in data
        found_ids = [r.get("document_id") for r in data["results"]]
        assert result.document_id in found_ids, (
            f"FTS search did not find doc {result.document_id}. Results: {found_ids}"
        )


class TestSmallToBigRetrieval:
    """Tests 12.6: Small-to-big retrieval via cerefox_search_docs RPC.

    Verifies that search_docs:
    - Returns is_partial=False and full content for docs below the threshold
    - Returns is_partial=True and expanded-chunk content for large docs
    - Respects p_context_window=0 (matched chunks only) vs N=1 (default, ±1 neighbour)
    - Returns total_chars equal to the stored document total regardless of partial flag
    - Returns fewer chunks than the full document when is_partial=True
    """

    _LARGE_DOC_THRESHOLD = 40_000  # Must match rpcs.sql DEFAULT for cerefox_search_docs

    @staticmethod
    def _make_large_content(target_chars: int = 44_000) -> str:
        """Build a large Teliboria-themed markdown document exceeding *target_chars*."""
        section_text = (
            "The ancient towers of Teliboria rise above the canopy of the Verdant Reach, "
            "each stone carved with the sigils of the First Architects who shaped the land "
            "during the Age of Formation. Scholars from the Academy at Emberveil travel many "
            "leagues to study these inscriptions, hoping to unlock the secrets of a civilisation "
            "that mastered the manipulation of aetheric currents before the Great Severance. "
            "The resonance crystals embedded in every archway still hum with residual energy, "
            "and on quiet evenings the hum can be heard from the valley floor far below. "
        )
        lines: list[str] = ["# Large Teliboria Reference — Small-to-Big Test\n\n"]
        section_num = 0
        while sum(len(line) for line in lines) < target_chars:
            section_num += 1
            lines.append(f"## Region {section_num}: Chronicles of the Verdant Reach\n\n")
            lines.append(section_text * 8)
            lines.append("\n\n")
        return "".join(lines)

    def test_small_doc_is_not_partial(
        self,
        e2e_client: CerefoxClient,
        e2e_pipeline: IngestionPipeline | None,
        e2e_embedder,
        cleanup: E2ECleanup,
        unique_title,
    ):
        """A document below the threshold returns is_partial=False and total_chars matches."""
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured (no OPENAI_API_KEY)")

        title = unique_title("S2B Small Doc")
        result = e2e_pipeline.ingest_text(SAMPLE_CONTENT, title)
        cleanup.track_document(result.document_id)

        doc = e2e_client.get_document_by_id(result.document_id)
        assert doc["total_chars"] < self._LARGE_DOC_THRESHOLD, (
            f"SAMPLE_CONTENT is too large ({doc['total_chars']} chars) — "
            "it should be well below the 40 000 char threshold"
        )

        time.sleep(1)

        embedding = e2e_embedder.embed("Luminous Archipelago floating islands")
        rows = e2e_client.search_docs(
            "Luminous Archipelago floating islands", embedding, match_count=10
        )
        our_rows = [r for r in rows if r["document_id"] == result.document_id]
        assert our_rows, (
            f"Small doc {result.document_id} not found in search results. "
            f"Returned IDs: {[r['document_id'] for r in rows]}"
        )
        row = our_rows[0]
        assert row["is_partial"] is False
        assert row["total_chars"] == doc["total_chars"]
        # Full content should contain the document text
        assert "Luminous Archipelago" in row.get("full_content", "")

    def test_large_doc_is_partial(
        self,
        e2e_client: CerefoxClient,
        e2e_pipeline: IngestionPipeline | None,
        e2e_embedder,
        cleanup: E2ECleanup,
        unique_title,
    ):
        """A document above the threshold returns is_partial=True and total_chars=full size."""
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured (no OPENAI_API_KEY)")

        title = unique_title("S2B Large Doc")
        large_content = self._make_large_content(44_000)
        result = e2e_pipeline.ingest_text(large_content, title)
        cleanup.track_document(result.document_id)

        doc = e2e_client.get_document_by_id(result.document_id)
        assert doc["total_chars"] > self._LARGE_DOC_THRESHOLD, (
            f"Document is only {doc['total_chars']} chars — "
            "not large enough to trigger small-to-big path"
        )

        time.sleep(1)

        embedding = e2e_embedder.embed("aetheric currents First Architects")
        rows = e2e_client.search_docs(
            "aetheric currents First Architects", embedding, match_count=5
        )
        our_rows = [r for r in rows if r["document_id"] == result.document_id]
        assert our_rows, (
            f"Large doc {result.document_id} not found in search results. "
            f"Returned IDs: {[r['document_id'] for r in rows]}"
        )
        row = our_rows[0]

        assert row["is_partial"] is True
        # total_chars should equal the full document size (not just returned content)
        assert row["total_chars"] == doc["total_chars"]
        # Partial content should be smaller than the full document
        assert len(row.get("full_content", "")) < row["total_chars"]
        # chunk_count reflects only the returned (partial) chunks
        assert row["chunk_count"] < result.chunk_count

    def test_context_window_zero_returns_fewer_chunks_than_window_one(
        self,
        e2e_client: CerefoxClient,
        e2e_pipeline: IngestionPipeline | None,
        e2e_embedder,
        cleanup: E2ECleanup,
        unique_title,
    ):
        """p_context_window=0 returns only matched chunks; N=1 returns matched + neighbours."""
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured (no OPENAI_API_KEY)")

        title = unique_title("S2B Window Compare")
        large_content = self._make_large_content(44_000)
        result = e2e_pipeline.ingest_text(large_content, title)
        cleanup.track_document(result.document_id)

        time.sleep(1)

        query = "aetheric currents First Architects Teliboria towers"
        embedding = e2e_embedder.embed(query)

        rpc_params_base = {
            "p_query_text": query,
            "p_query_embedding": embedding,
            "p_match_count": 3,
            "p_alpha": 0.7,
            "p_project_id": None,
            "p_min_score": 0.0,
        }

        rows_n0 = e2e_client.rpc(
            "cerefox_search_docs", {**rpc_params_base, "p_context_window": 0}
        )
        rows_n1 = e2e_client.rpc(
            "cerefox_search_docs", {**rpc_params_base, "p_context_window": 1}
        )

        our_n0 = [r for r in rows_n0 if r["document_id"] == result.document_id]
        our_n1 = [r for r in rows_n1 if r["document_id"] == result.document_id]

        assert our_n0, "Large doc not found in N=0 results"
        assert our_n1, "Large doc not found in N=1 results"

        n0_row = our_n0[0]
        n1_row = our_n1[0]

        # Both should be partial (doc is large)
        assert n0_row["is_partial"] is True
        assert n1_row["is_partial"] is True

        # N=1 should have at least as many chunks as N=0 (neighbours expand the window)
        assert n1_row["chunk_count"] >= n0_row["chunk_count"]
        # N=1 content should be at least as long as N=0 content
        assert len(n1_row.get("full_content", "")) >= len(n0_row.get("full_content", ""))

    def test_partial_result_has_no_duplicate_content(
        self,
        e2e_client: CerefoxClient,
        e2e_pipeline: IngestionPipeline | None,
        e2e_embedder,
        cleanup: E2ECleanup,
        unique_title,
    ):
        """Overlapping context windows from multiple matched chunks produce no duplicate text."""
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured (no OPENAI_API_KEY)")

        title = unique_title("S2B Dedup Check")
        # Build a large doc where the same phrase repeats in consecutive sections
        # so multiple chunks will match and their context windows will overlap.
        large_content = self._make_large_content(44_000)
        result = e2e_pipeline.ingest_text(large_content, title)
        cleanup.track_document(result.document_id)

        time.sleep(1)

        # Use a high match_count to maximise chance of overlapping windows
        query = "aetheric currents resonance crystals"
        embedding = e2e_embedder.embed(query)
        rows = e2e_client.rpc(
            "cerefox_search_docs",
            {
                "p_query_text": query,
                "p_query_embedding": embedding,
                "p_match_count": 5,
                "p_alpha": 0.7,
                "p_project_id": None,
                "p_min_score": 0.0,
                "p_context_window": 2,
            },
        )
        our_rows = [r for r in rows if r["document_id"] == result.document_id]
        assert our_rows, "Large doc not found in search results"

        row = our_rows[0]
        assert row["is_partial"] is True

        full_content: str = row.get("full_content", "")
        assert full_content

        # Split on section headings to detect repeated sections in the stitched content.
        # Each "## Region N:" heading should appear at most once.
        import re
        headings = re.findall(r"## Region \d+:", full_content)
        assert len(headings) == len(set(headings)), (
            f"Duplicate section headings found in partial content: {headings}"
        )


class TestEdgeFunctionMetadata:
    """Test 2.3: cerefox-metadata Edge Function."""

    def test_list_metadata_keys(
        self, e2e_edge: EdgeFunctionClient | None, e2e_pipeline, cleanup, unique_title,
    ):
        if e2e_edge is None:
            pytest.skip("No JWT key for Edge Functions (set CEREFOX_SUPABASE_ANON_KEY)")
        if e2e_pipeline is None:
            pytest.skip("Embedder not configured")

        # Ingest a doc with known metadata
        title = unique_title("Edge Metadata Test")
        result = e2e_pipeline.ingest_text(
            "# Metadata Test\n\nDocument for testing metadata key discovery.",
            title,
            metadata={"e2e_tag": "metadata-test", "e2e_category": "testing"},
        )
        cleanup.track_document(result.document_id)

        # 2.3 List metadata keys via Edge Function
        data = e2e_edge.invoke("cerefox-metadata", {})
        assert isinstance(data, list), f"Expected list, got: {data}"
        key_names = [k["key"] for k in data]
        assert "e2e_tag" in key_names, f"Expected 'e2e_tag' in {key_names}"
