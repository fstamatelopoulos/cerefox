"""Supabase client wrapper for Cerefox.

Thin wrapper around supabase-py that provides a clean, typed interface
for the operations Cerefox needs. All search and retrieval goes through
the RPCs defined in rpcs.sql.
"""

from __future__ import annotations

import logging
from typing import Any

from supabase import Client, create_client

from cerefox.config import Settings

logger = logging.getLogger(__name__)


class CerefoxClient:
    """Lightweight wrapper around the Supabase Python client.

    Provides typed methods for calling Cerefox RPCs and performing
    basic table operations. Does not handle embedding or chunking —
    those live in their respective modules.
    """

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Client | None = None

    @property
    def client(self) -> Client:
        """Lazily initialize and return the Supabase client."""
        if self._client is None:
            if not self._settings.is_supabase_configured():
                raise RuntimeError(
                    "Supabase is not configured. "
                    "Set CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY."
                )
            self._client = create_client(
                self._settings.supabase_url,
                self._settings.supabase_key,
            )
        return self._client

    def rpc(self, function_name: str, params: dict[str, Any]) -> list[dict[str, Any]]:
        """Call a Supabase RPC and return the result rows.

        Args:
            function_name: Name of the Postgres function (e.g. 'cerefox_hybrid_search').
            params: Parameters to pass to the function.

        Returns:
            List of result rows as dicts.

        Raises:
            RuntimeError: If the RPC call fails.
        """
        try:
            response = self.client.rpc(function_name, params).execute()
            return response.data or []
        except Exception as exc:
            logger.error("RPC %s failed: %s", function_name, exc)
            raise RuntimeError(f"RPC {function_name!r} failed: {exc}") from exc

    # ── Documents ──────────────────────────────────────────────────────────────

    def insert_document(self, data: dict[str, Any]) -> dict[str, Any]:
        """Insert a document record and return the created row."""
        try:
            response = self.client.table("cerefox_documents").insert(data).execute()
            if not response.data:
                raise RuntimeError("Insert returned no data")
            return response.data[0]
        except Exception as exc:
            logger.error("insert_document failed: %s", exc)
            raise RuntimeError(f"insert_document failed: {exc}") from exc

    def find_document_by_source_path(self, source_path: str) -> dict[str, Any] | None:
        """Return the most-recently-updated document whose source_path matches, or None."""
        try:
            response = (
                self.client.table("cerefox_documents")
                .select("*")
                .eq("source_path", source_path)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("find_document_by_source_path failed: %s", exc)
            raise RuntimeError(f"find_document_by_source_path failed: {exc}") from exc

    def find_document_by_title(self, title: str) -> dict[str, Any] | None:
        """Return the most-recently-updated document with an exact title match, or None."""
        try:
            response = (
                self.client.table("cerefox_documents")
                .select("*")
                .eq("title", title)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("find_document_by_title failed: %s", exc)
            raise RuntimeError(f"find_document_by_title failed: {exc}") from exc

    def get_document_by_hash(self, content_hash: str) -> dict[str, Any] | None:
        """Return the document with the given content hash, or None if not found."""
        try:
            response = (
                self.client.table("cerefox_documents")
                .select("*")
                .eq("content_hash", content_hash)
                .limit(1)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("get_document_by_hash failed: %s", exc)
            raise RuntimeError(f"get_document_by_hash failed: {exc}") from exc

    def update_document_chunk_stats(
        self, document_id: str, chunk_count: int, total_chars: int
    ) -> None:
        """Update chunk_count and total_chars on a document after ingestion."""
        try:
            self.client.table("cerefox_documents").update(
                {"chunk_count": chunk_count, "total_chars": total_chars}
            ).eq("id", document_id).execute()
        except Exception as exc:
            logger.error("update_document_chunk_stats failed: %s", exc)
            raise RuntimeError(f"update_document_chunk_stats failed: {exc}") from exc

    def get_document_by_id(self, document_id: str) -> dict[str, Any] | None:
        """Return the document with the given ID, or None if not found."""
        try:
            response = (
                self.client.table("cerefox_documents")
                .select("*")
                .eq("id", document_id)
                .limit(1)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("get_document_by_id failed: %s", exc)
            raise RuntimeError(f"get_document_by_id failed: {exc}") from exc

    def delete_document(self, document_id: str) -> None:
        """Delete a document and cascade-delete its chunks."""
        try:
            self.client.table("cerefox_documents").delete().eq("id", document_id).execute()
        except Exception as exc:
            logger.error("delete_document failed: %s", exc)
            raise RuntimeError(f"delete_document failed: {exc}") from exc

    def delete_chunks_for_document(self, document_id: str) -> None:
        """Delete all chunks for a document without deleting the document itself.

        Used by update_document to clear old chunks before re-ingesting.
        """
        try:
            self.client.table("cerefox_chunks").delete().eq("document_id", document_id).execute()
        except Exception as exc:
            logger.error("delete_chunks_for_document failed: %s", exc)
            raise RuntimeError(f"delete_chunks_for_document failed: {exc}") from exc

    def update_document(self, document_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """Update fields on an existing document record and return the updated row."""
        try:
            response = (
                self.client.table("cerefox_documents")
                .update(data)
                .eq("id", document_id)
                .execute()
            )
            if not response.data:
                raise RuntimeError("Update returned no data")
            return response.data[0]
        except Exception as exc:
            logger.error("update_document failed: %s", exc)
            raise RuntimeError(f"update_document failed: {exc}") from exc

    def list_documents(
        self,
        project_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """List documents, optionally filtered by project (M2M junction)."""
        try:
            query = (
                self.client.table("cerefox_documents")
                .select(
                    "id, title, source, source_path, metadata, chunk_count, total_chars, created_at, updated_at"
                )
                .order("updated_at", desc=True)
            )
            if project_id:
                # Resolve document IDs from the M2M junction table.
                jp = (
                    self.client.table("cerefox_document_projects")
                    .select("document_id")
                    .eq("project_id", project_id)
                    .execute()
                )
                doc_ids = [r["document_id"] for r in (jp.data or [])]
                if not doc_ids:
                    return []
                query = query.in_("id", doc_ids)
            return query.range(offset, offset + limit - 1).execute().data or []
        except Exception as exc:
            logger.error("list_documents failed: %s", exc)
            raise RuntimeError(f"list_documents failed: {exc}") from exc

    # ── Document ↔ Project (M2M) ───────────────────────────────────────────────

    def get_document_project_ids(self, document_id: str) -> list[str]:
        """Return all project UUIDs currently assigned to a document."""
        try:
            response = (
                self.client.table("cerefox_document_projects")
                .select("project_id")
                .eq("document_id", document_id)
                .execute()
            )
            return [r["project_id"] for r in (response.data or [])]
        except Exception as exc:
            logger.error("get_document_project_ids failed: %s", exc)
            raise RuntimeError(f"get_document_project_ids failed: {exc}") from exc

    def assign_document_projects(self, document_id: str, project_ids: list[str]) -> None:
        """Replace all project associations for a document.

        Deletes existing associations then inserts the new set.
        Pass an empty list to remove the document from all projects.
        """
        try:
            self.client.table("cerefox_document_projects").delete().eq(
                "document_id", document_id
            ).execute()
            if project_ids:
                rows = [{"document_id": document_id, "project_id": pid} for pid in project_ids]
                self.client.table("cerefox_document_projects").insert(rows).execute()
        except Exception as exc:
            logger.error("assign_document_projects failed: %s", exc)
            raise RuntimeError(f"assign_document_projects failed: {exc}") from exc

    def get_projects_for_documents(
        self,
        doc_ids: list[str],
        projects: list[dict[str, Any]],
    ) -> dict[str, list[dict[str, Any]]]:
        """Return a {doc_id: [project_dicts]} map for a batch of document IDs.

        Performs a single junction-table query rather than N individual lookups.
        Degrades gracefully (returns empty lists) on error so display still works.
        """
        result: dict[str, list[dict[str, Any]]] = {did: [] for did in doc_ids}
        if not doc_ids:
            return result
        projects_by_id = {p["id"]: p for p in projects}
        try:
            resp = (
                self.client.table("cerefox_document_projects")
                .select("document_id, project_id")
                .in_("document_id", doc_ids)
                .execute()
            )
            for row in (resp.data or []):
                did = row["document_id"]
                pid = row["project_id"]
                if did in result and pid in projects_by_id:
                    result[did].append(projects_by_id[pid])
        except Exception as exc:
            logger.error("get_projects_for_documents failed: %s", exc)
        return result

    def get_project_doc_counts(self, project_ids: list[str]) -> dict[str, int]:
        """Return a {project_id: doc_count} map via a single junction-table query.

        Degrades gracefully to all-zeros on error so the dashboard still renders.
        """
        counts: dict[str, int] = {pid: 0 for pid in project_ids}
        if not project_ids:
            return counts
        try:
            resp = (
                self.client.table("cerefox_document_projects")
                .select("project_id")
                .in_("project_id", project_ids)
                .execute()
            )
            for row in (resp.data or []):
                pid = row["project_id"]
                if pid in counts:
                    counts[pid] += 1
        except Exception as exc:
            logger.error("get_project_doc_counts failed: %s", exc)
        return counts

    # ── Chunks ─────────────────────────────────────────────────────────────────

    def insert_chunks(self, chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Insert multiple chunk records and return the created rows."""
        if not chunks:
            return []
        try:
            response = self.client.table("cerefox_chunks").insert(chunks).execute()
            return response.data or []
        except Exception as exc:
            logger.error("insert_chunks failed: %s", exc)
            raise RuntimeError(f"insert_chunks failed: {exc}") from exc

    def list_chunks_for_document(self, document_id: str) -> list[dict[str, Any]]:
        """Return all chunks for a document, ordered by chunk_index."""
        try:
            response = (
                self.client.table("cerefox_chunks")
                .select(
                    "id, document_id, chunk_index, heading_path, heading_level, "
                    "title, content, char_count, embedder_primary, created_at"
                )
                .eq("document_id", document_id)
                .order("chunk_index")
                .execute()
            )
            return response.data or []
        except Exception as exc:
            logger.error("list_chunks_for_document failed: %s", exc)
            raise RuntimeError(f"list_chunks_for_document failed: {exc}") from exc

    def list_all_chunks(
        self,
        embedder_not: str | None = None,
        batch_size: int = 200,
    ) -> list[dict[str, Any]]:
        """Return all chunks, optionally excluding those already embedded by a given model.

        Used by ``cerefox reindex`` to find chunks that need re-embedding.

        Args:
            embedder_not: If set, exclude chunks where ``embedder_primary`` equals
                this string (i.e. already up to date).
            batch_size: Page size for pagination (max Supabase returns per request).
        """
        results: list[dict[str, Any]] = []
        offset = 0
        while True:
            try:
                query = (
                    self.client.table("cerefox_chunks")
                    .select("id, document_id, content, embedder_primary")
                    .order("id")
                    .range(offset, offset + batch_size - 1)
                )
                if embedder_not:
                    query = query.neq("embedder_primary", embedder_not)
                page = query.execute().data or []
                results.extend(page)
                if len(page) < batch_size:
                    break
                offset += batch_size
            except Exception as exc:
                logger.error("list_all_chunks failed at offset %d: %s", offset, exc)
                raise RuntimeError(f"list_all_chunks failed: {exc}") from exc
        return results

    def update_chunk_embedding(
        self,
        chunk_id: str,
        embedding: list[float],
        embedder_name: str,
    ) -> None:
        """Update the primary embedding and embedder label for a single chunk."""
        try:
            self.client.table("cerefox_chunks").update(
                {"embedding_primary": embedding, "embedder_primary": embedder_name}
            ).eq("id", chunk_id).execute()
        except Exception as exc:
            logger.error("update_chunk_embedding failed for chunk %s: %s", chunk_id, exc)
            raise RuntimeError(f"update_chunk_embedding failed: {exc}") from exc

    # ── Projects ───────────────────────────────────────────────────────────────

    def get_or_create_project(self, name: str, description: str = "") -> dict[str, Any]:
        """Return an existing project by name, or create it if it doesn't exist."""
        try:
            response = (
                self.client.table("cerefox_projects")
                .select("*")
                .eq("name", name)
                .limit(1)
                .execute()
            )
            if response.data:
                return response.data[0]
            # Create it
            create_resp = (
                self.client.table("cerefox_projects")
                .insert({"name": name, "description": description})
                .execute()
            )
            if not create_resp.data:
                raise RuntimeError("Project creation returned no data")
            return create_resp.data[0]
        except RuntimeError:
            raise
        except Exception as exc:
            logger.error("get_or_create_project failed: %s", exc)
            raise RuntimeError(f"get_or_create_project failed: {exc}") from exc

    def list_projects(self) -> list[dict[str, Any]]:
        """Return all projects ordered by name."""
        try:
            response = (
                self.client.table("cerefox_projects")
                .select("*")
                .order("name")
                .execute()
            )
            return response.data or []
        except Exception as exc:
            logger.error("list_projects failed: %s", exc)
            raise RuntimeError(f"list_projects failed: {exc}") from exc

    def get_project_by_id(self, project_id: str) -> dict[str, Any] | None:
        """Return a project by ID, or None if not found."""
        try:
            response = (
                self.client.table("cerefox_projects")
                .select("*")
                .eq("id", project_id)
                .limit(1)
                .execute()
            )
            return response.data[0] if response.data else None
        except Exception as exc:
            logger.error("get_project_by_id failed: %s", exc)
            raise RuntimeError(f"get_project_by_id failed: {exc}") from exc

    def create_project(self, name: str, description: str = "") -> dict[str, Any]:
        """Create a new project and return the created row."""
        try:
            response = (
                self.client.table("cerefox_projects")
                .insert({"name": name, "description": description})
                .execute()
            )
            if not response.data:
                raise RuntimeError("Project creation returned no data")
            return response.data[0]
        except RuntimeError:
            raise
        except Exception as exc:
            logger.error("create_project failed: %s", exc)
            raise RuntimeError(f"create_project failed: {exc}") from exc

    def update_project(self, project_id: str, data: dict[str, Any]) -> dict[str, Any]:
        """Update fields on an existing project and return the updated row."""
        try:
            response = (
                self.client.table("cerefox_projects")
                .update(data)
                .eq("id", project_id)
                .execute()
            )
            if not response.data:
                raise RuntimeError("Project update returned no data")
            return response.data[0]
        except RuntimeError:
            raise
        except Exception as exc:
            logger.error("update_project failed: %s", exc)
            raise RuntimeError(f"update_project failed: {exc}") from exc

    def delete_project(self, project_id: str) -> None:
        """Delete a project by ID. Documents assigned to it are not deleted."""
        try:
            self.client.table("cerefox_projects").delete().eq("id", project_id).execute()
        except Exception as exc:
            logger.error("delete_project failed: %s", exc)
            raise RuntimeError(f"delete_project failed: {exc}") from exc

    def count_documents(self, project_id: str | None = None) -> int:
        """Return the total number of documents, optionally filtered by project."""
        try:
            if project_id:
                # Count via junction table for M2M project filter.
                response = (
                    self.client.table("cerefox_document_projects")
                    .select("document_id", count="exact")
                    .eq("project_id", project_id)
                    .limit(1)
                    .execute()
                )
                return response.count or 0
            query = self.client.table("cerefox_documents").select("id", count="exact").limit(1)
            response = query.execute()
            return response.count or 0
        except Exception as exc:
            logger.error("count_documents failed: %s", exc)
            raise RuntimeError(f"count_documents failed: {exc}") from exc

    # ── Metadata keys ──────────────────────────────────────────────────────────

    def list_metadata_keys(self) -> list[dict[str, Any]]:
        """Return metadata keys derived from actual doc_metadata across all documents.

        Each row has: key (str), doc_count (int), example_values (list[str]).
        """
        return self.rpc("cerefox_list_metadata_keys", {})

    # ── Search (convenience wrappers around RPCs) ──────────────────────────────

    def hybrid_search(
        self,
        query_text: str,
        query_embedding: list[float],
        match_count: int = 10,
        alpha: float = 0.7,
        use_upgrade: bool = False,
        project_id: str | None = None,
        min_score: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Hybrid FTS + semantic search."""
        return self.rpc(
            "cerefox_hybrid_search",
            {
                "p_query_text": query_text,
                "p_query_embedding": query_embedding,
                "p_match_count": match_count,
                "p_alpha": alpha,
                "p_use_upgrade": use_upgrade,
                "p_project_id": project_id,
                "p_min_score": min_score,
            },
        )

    def fts_search(
        self,
        query_text: str,
        match_count: int = 10,
        project_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Full-text keyword search."""
        return self.rpc(
            "cerefox_fts_search",
            {
                "p_query_text": query_text,
                "p_match_count": match_count,
                "p_project_id": project_id,
            },
        )

    def semantic_search(
        self,
        query_embedding: list[float],
        match_count: int = 10,
        use_upgrade: bool = False,
        project_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Pure vector similarity search."""
        return self.rpc(
            "cerefox_semantic_search",
            {
                "p_query_embedding": query_embedding,
                "p_match_count": match_count,
                "p_use_upgrade": use_upgrade,
                "p_project_id": project_id,
            },
        )

    def search_docs(
        self,
        query_text: str,
        query_embedding: list[float],
        match_count: int = 5,
        alpha: float = 0.7,
        project_id: str | None = None,
        min_score: float = 0.0,
    ) -> list[dict[str, Any]]:
        """Document-level hybrid search — deduplicates by document, returns full content."""
        return self.rpc(
            "cerefox_search_docs",
            {
                "p_query_text": query_text,
                "p_query_embedding": query_embedding,
                "p_match_count": match_count,
                "p_alpha": alpha,
                "p_project_id": project_id,
                "p_min_score": min_score,
            },
        )

    def reconstruct_doc(self, document_id: str) -> dict[str, Any] | None:
        """Reconstruct the full markdown content of a document from its chunks."""
        rows = self.rpc("cerefox_reconstruct_doc", {"p_document_id": document_id})
        return rows[0] if rows else None

    def context_expand(
        self, chunk_ids: list[str], window_size: int = 1
    ) -> list[dict[str, Any]]:
        """Expand chunk IDs to include neighbouring chunks (small-to-big retrieval).

        Returns seed chunks plus up to *window_size* chunks before and after each
        seed within the same document, ordered by document + chunk_index.
        The ``is_seed`` field is True for the original result chunks.
        """
        return self.rpc(
            "cerefox_context_expand",
            {"p_chunk_ids": chunk_ids, "p_window_size": window_size},
        )

    def save_note(
        self,
        title: str,
        content: str,
        source: str = "agent",
        project_id: str | None = None,
        metadata: dict | None = None,
    ) -> dict[str, Any]:
        """Call cerefox_save_note to quickly capture a document record.

        This is the agent write path.  Content is NOT chunked or embedded
        server-side — use :class:`~cerefox.ingestion.pipeline.IngestionPipeline`
        for full ingest with search support.
        """
        rows = self.rpc(
            "cerefox_save_note",
            {
                "p_title": title,
                "p_content": content,
                "p_source": source,
                "p_project_id": project_id,
                "p_metadata": metadata or {},
            },
        )
        if not rows:
            raise RuntimeError("cerefox_save_note returned no data")
        return rows[0]
