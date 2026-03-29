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

    def delete_document(
        self, document_id: str, author: str = "unknown", author_type: str = "user"
    ) -> None:
        """Soft-delete a document (sets deleted_at, creates audit entry).

        The document remains in the database but is excluded from search.
        Use restore_document() to undo or purge_document() to permanently delete.
        """
        self.rpc("cerefox_delete_document", {
            "p_document_id": document_id,
            "p_author": author,
            "p_author_type": author_type,
        })

    def restore_document(
        self, document_id: str, author: str = "unknown", author_type: str = "user"
    ) -> None:
        """Restore a soft-deleted document (clears deleted_at)."""
        self.rpc("cerefox_restore_document", {
            "p_document_id": document_id,
            "p_author": author,
            "p_author_type": author_type,
        })

    def purge_document(
        self, document_id: str, author: str = "unknown", author_type: str = "user"
    ) -> None:
        """Permanently delete a soft-deleted document (CASCADE). Only works on soft-deleted docs."""
        self.rpc("cerefox_purge_document", {
            "p_document_id": document_id,
            "p_author": author,
            "p_author_type": author_type,
        })

    def list_deleted_documents(self, limit: int = 50) -> list[dict[str, Any]]:
        """List soft-deleted documents (trash bin)."""
        response = self.client.table("cerefox_documents").select(
            "id, title, source, chunk_count, total_chars, review_status, deleted_at, updated_at"
        ).not_.is_("deleted_at", "null").order(
            "deleted_at", desc=True
        ).limit(limit).execute()
        return response.data or []

    def delete_chunks_for_document(self, document_id: str) -> None:
        """Delete all current chunks for a document without deleting the document itself.

        Used by delete_document cascade and direct chunk cleanup. Since update_document
        now archives chunks via the cerefox_snapshot_version RPC, this method is only
        used when permanently removing a document's current chunks (e.g., full deletion).
        """
        try:
            self.client.table("cerefox_chunks").delete().eq(
                "document_id", document_id
            ).is_("version_id", "null").execute()
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
                    "id, title, source, source_path, content_hash, metadata, chunk_count, total_chars, review_status, created_at, updated_at"
                )
                .is_("deleted_at", "null")
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

    def list_all_documents(self, batch_size: int = 200) -> list[dict[str, Any]]:
        """Return every document, paginating internally to avoid the default limit.

        Used by backup to ensure no documents are silently omitted.
        """
        results: list[dict[str, Any]] = []
        offset = 0
        while True:
            try:
                page = (
                    self.client.table("cerefox_documents")
                    .select(
                        "id, title, source, source_path, content_hash, metadata, "
                        "chunk_count, total_chars, created_at, updated_at"
                    )
                    .order("created_at")
                    .range(offset, offset + batch_size - 1)
                    .execute()
                ).data or []
                results.extend(page)
                if len(page) < batch_size:
                    break
                offset += batch_size
            except Exception as exc:
                logger.error("list_all_documents failed at offset %d: %s", offset, exc)
                raise RuntimeError(f"list_all_documents failed: {exc}") from exc
        return results

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

    def ingest_document_rpc(
        self,
        *,
        document_id: str | None = None,
        title: str = "Untitled",
        source: str = "agent",
        source_path: str | None = None,
        content_hash: str = "",
        metadata: dict | None = None,
        review_status: str = "approved",
        chunks: list[dict[str, Any]] | None = None,
        author: str = "unknown",
        author_type: str = "user",
        source_label: str = "manual",
        retention_hours: int = 48,
        cleanup_enabled: bool = True,
    ) -> dict[str, Any]:
        """Ingest a document via the cerefox_ingest_document RPC.

        Handles both create (document_id=None) and update (document_id=UUID).
        Chunks must include embedding as a list of floats.

        Returns dict with: document_id, chunk_count, total_chars, operation, version_id.
        """
        # Convert chunk embeddings to plain lists for JSONB serialization
        chunk_data = []
        for c in (chunks or []):
            entry = {
                "chunk_index": c.get("chunk_index", 0),
                "heading_path": c.get("heading_path", []),
                "heading_level": c.get("heading_level"),
                "title": c.get("title", ""),
                "content": c.get("content", ""),
                "char_count": c.get("char_count", 0),
                "embedding": list(c["embedding_primary"]),
                "embedder": c.get("embedder_primary", "text-embedding-3-small"),
            }
            chunk_data.append(entry)

        params = {
            "p_document_id": document_id,
            "p_title": title,
            "p_source": source,
            "p_source_path": source_path,
            "p_content_hash": content_hash,
            "p_metadata": metadata or {},
            "p_review_status": review_status,
            "p_chunks": chunk_data,
            "p_author": author,
            "p_author_type": author_type,
            "p_source_label": source_label,
            "p_retention_hours": retention_hours,
            "p_cleanup_enabled": cleanup_enabled,
        }

        rows = self.rpc("cerefox_ingest_document", params)
        if not rows:
            raise RuntimeError("cerefox_ingest_document returned no data")
        return rows[0]

    def list_chunks_for_document(self, document_id: str) -> list[dict[str, Any]]:
        """Return current chunks for a document (version_id IS NULL), ordered by chunk_index."""
        try:
            response = (
                self.client.table("cerefox_chunks")
                .select(
                    "id, document_id, chunk_index, heading_path, heading_level, "
                    "title, content, char_count, version_id, "
                    "embedding_primary, embedding_upgrade, embedder_primary, embedder_upgrade, "
                    "created_at"
                )
                .eq("document_id", document_id)
                .is_("version_id", "null")
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
        """Return all current chunks (version_id IS NULL), optionally filtered by embedder.

        Used by ``cerefox reindex`` to find current chunks that need re-embedding.
        Archived chunks are excluded — they retain their original embeddings.

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
                    .is_("version_id", "null")
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

    # ── Document versions ───────────────────────────────────────────────────────

    def snapshot_version(
        self,
        document_id: str,
        source: str = "manual",
        retention_hours: int = 48,
        cleanup_enabled: bool = True,
    ) -> dict[str, Any]:
        """Archive current chunks and create a version record via RPC.

        Calls cerefox_snapshot_version which atomically:
        1. Creates a version row in cerefox_document_versions.
        2. Sets version_id on all current chunks (marking them as archived).
        3. Deletes versions older than retention_hours (always keeps the newest).
           Skips versions with archived=true. Skips cleanup if cleanup_enabled=false.

        Returns a dict with version_id, version_number, chunk_count, total_chars.
        """
        rows = self.rpc(
            "cerefox_snapshot_version",
            {
                "p_document_id": document_id,
                "p_source": source,
                "p_retention_hours": retention_hours,
                "p_cleanup_enabled": cleanup_enabled,
            },
        )
        if not rows:
            raise RuntimeError("cerefox_snapshot_version returned no data")
        return rows[0]

    def get_document_content(
        self,
        document_id: str,
        version_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Return full reconstructed content of a document (current or archived version).

        Args:
            document_id: UUID of the document.
            version_id: UUID of an archived version, or None for the current version.

        Returns:
            Dict with document_id, doc_title, doc_source, doc_metadata, version_id,
            full_content, chunk_count, total_chars, created_at — or None if not found.
        """
        rows = self.rpc(
            "cerefox_get_document",
            {
                "p_document_id": document_id,
                "p_version_id": version_id,
            },
        )
        return rows[0] if rows else None

    def list_document_versions(self, document_id: str) -> list[dict[str, Any]]:
        """Return all archived versions for a document, newest first.

        Each row contains version_id, version_number, source, chunk_count,
        total_chars, created_at.  Pass version_id to get_document_content()
        to retrieve the full content of a specific version.
        """
        return self.rpc(
            "cerefox_list_document_versions",
            {"p_document_id": document_id},
        )

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
        metadata_filter: dict | None = None,
    ) -> list[dict[str, Any]]:
        """Hybrid FTS + semantic search."""
        params: dict[str, Any] = {
            "p_query_text": query_text,
            "p_query_embedding": query_embedding,
            "p_match_count": match_count,
            "p_alpha": alpha,
            "p_use_upgrade": use_upgrade,
            "p_project_id": project_id,
            "p_min_score": min_score,
        }
        if metadata_filter is not None:
            params["p_metadata_filter"] = metadata_filter
        return self.rpc("cerefox_hybrid_search", params)

    def fts_search(
        self,
        query_text: str,
        match_count: int = 10,
        project_id: str | None = None,
        metadata_filter: dict | None = None,
    ) -> list[dict[str, Any]]:
        """Full-text keyword search."""
        params: dict[str, Any] = {
            "p_query_text": query_text,
            "p_match_count": match_count,
            "p_project_id": project_id,
        }
        if metadata_filter is not None:
            params["p_metadata_filter"] = metadata_filter
        return self.rpc("cerefox_fts_search", params)

    def semantic_search(
        self,
        query_embedding: list[float],
        match_count: int = 10,
        use_upgrade: bool = False,
        project_id: str | None = None,
        metadata_filter: dict | None = None,
    ) -> list[dict[str, Any]]:
        """Pure vector similarity search."""
        params: dict[str, Any] = {
            "p_query_embedding": query_embedding,
            "p_match_count": match_count,
            "p_use_upgrade": use_upgrade,
            "p_project_id": project_id,
        }
        if metadata_filter is not None:
            params["p_metadata_filter"] = metadata_filter
        return self.rpc("cerefox_semantic_search", params)

    def search_docs(
        self,
        query_text: str,
        query_embedding: list[float],
        match_count: int = 5,
        alpha: float = 0.7,
        project_id: str | None = None,
        min_score: float = 0.0,
        metadata_filter: dict | None = None,
    ) -> list[dict[str, Any]]:
        """Document-level hybrid search — deduplicates by document, returns content.

        Small-to-big threshold and context window are configured in the RPC
        (see rpcs.sql — cerefox_search_docs defaults). They are not exposed here
        because they are system-level tuning params, not per-call options.
        """
        params: dict[str, Any] = {
            "p_query_text": query_text,
            "p_query_embedding": query_embedding,
            "p_match_count": match_count,
            "p_alpha": alpha,
            "p_project_id": project_id,
            "p_min_score": min_score,
        }
        if metadata_filter is not None:
            params["p_metadata_filter"] = metadata_filter
        return self.rpc("cerefox_search_docs", params)

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

    def list_projects_rpc(self) -> list[dict[str, Any]]:
        """Call cerefox_list_projects RPC. Returns all projects sorted by name."""
        return self.rpc("cerefox_list_projects", {})

    def metadata_search(
        self,
        metadata_filter: dict,
        project_id: str | None = None,
        updated_since: str | None = None,
        created_since: str | None = None,
        limit: int = 10,
        include_content: bool = False,
        max_bytes: int | None = None,
    ) -> list[dict[str, Any]]:
        """Call cerefox_metadata_search RPC.

        Args:
            metadata_filter: JSONB containment filter (AND semantics).
            project_id: Optional project UUID.
            updated_since: ISO-8601 timestamp lower bound for updated_at.
            created_since: ISO-8601 timestamp lower bound for created_at.
            limit: Max results (default 10).
            include_content: Reconstruct full text for each doc.
            max_bytes: Byte budget for accumulated content (None = no limit).
        """
        params: dict[str, Any] = {
            "p_metadata_filter": metadata_filter,
            "p_project_id": project_id,
            "p_updated_since": updated_since,
            "p_created_since": created_since,
            "p_limit": limit,
            "p_include_content": include_content,
        }
        if max_bytes is not None:
            params["p_max_bytes"] = max_bytes
        return self.rpc("cerefox_metadata_search", params)

    # ── Usage tracking ────────────────────────────────────────────────────────

    def get_config(self, key: str) -> str | None:
        """Read a config value from cerefox_config."""
        rows = self.rpc("cerefox_get_config", {"p_key": key})
        # RPC returns a scalar wrapped in a list by the Supabase client
        if isinstance(rows, str):
            return rows
        if isinstance(rows, list) and rows:
            return rows[0] if isinstance(rows[0], str) else None
        return rows if isinstance(rows, str) else None

    def set_config(self, key: str, value: str) -> None:
        """Write a config value to cerefox_config (validated against allowlist)."""
        self.rpc("cerefox_set_config", {"p_key": key, "p_value": value})

    def log_usage(
        self,
        operation: str,
        access_path: str,
        requestor: str | None = None,
        document_id: str | None = None,
        project_id: str | None = None,
        query_text: str | None = None,
        result_count: int | None = None,
        extra: dict | None = None,
    ) -> None:
        """Log a usage entry (no-op if tracking is disabled in config)."""
        try:
            self.rpc("cerefox_log_usage", {
                "p_operation": operation,
                "p_access_path": access_path,
                "p_requestor": requestor,
                "p_document_id": document_id,
                "p_project_id": project_id,
                "p_query_text": query_text,
                "p_result_count": result_count,
                "p_extra": extra or {},
            })
        except Exception:
            pass  # fire-and-forget; never block on usage logging failure

    def list_usage_log(
        self,
        start: str | None = None,
        end: str | None = None,
        operation: str | None = None,
        access_path: str | None = None,
        requestor: str | None = None,
        project_id: str | None = None,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        """Query usage log entries with optional filters."""
        params: dict[str, Any] = {"p_limit": limit}
        if start is not None:
            params["p_start"] = start
        if end is not None:
            params["p_end"] = end
        if operation is not None:
            params["p_operation"] = operation
        if access_path is not None:
            params["p_access_path"] = access_path
        if requestor is not None:
            params["p_requestor"] = requestor
        if project_id is not None:
            params["p_project_id"] = project_id
        return self.rpc("cerefox_list_usage_log", params)

    def usage_summary(
        self,
        start: str | None = None,
        end: str | None = None,
        project_id: str | None = None,
        access_path: str | None = None,
    ) -> dict[str, Any]:
        """Get aggregated usage statistics."""
        params: dict[str, Any] = {}
        if start is not None:
            params["p_start"] = start
        if end is not None:
            params["p_end"] = end
        if project_id is not None:
            params["p_project_id"] = project_id
        if access_path is not None:
            params["p_access_path"] = access_path
        result = self.rpc("cerefox_usage_summary", params)
        if isinstance(result, list) and result:
            return result[0] if isinstance(result[0], dict) else {}
        if isinstance(result, dict):
            return result
        return {}

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

    # ── Audit log ────────────────────────────────────────────────────────────

    def create_audit_entry(
        self,
        operation: str,
        author: str = "unknown",
        author_type: str = "user",
        document_id: str | None = None,
        version_id: str | None = None,
        size_before: int | None = None,
        size_after: int | None = None,
        description: str = "",
    ) -> dict[str, Any]:
        """Insert an immutable audit log entry.

        Args:
            operation: One of 'create', 'update-content', 'update-metadata',
                       'delete', 'status-change', 'archive', 'unarchive'.
            author: Human username, agent name/model, or 'system'.
            author_type: 'user' (human via web UI/CLI) or 'agent' (AI via MCP/Edge Function).
                         Used for review_status auto-transition decisions.
            document_id: UUID of the affected document (nullable).
            version_id: UUID of the version created by this operation (nullable).
            size_before: Document total_chars before the operation.
            size_after: Document total_chars after the operation.
            description: Free-text explaining what changed and why.
        """
        rows = self.rpc(
            "cerefox_create_audit_entry",
            {
                "p_document_id": document_id,
                "p_version_id": version_id,
                "p_operation": operation,
                "p_author": author,
                "p_author_type": author_type,
                "p_size_before": size_before,
                "p_size_after": size_after,
                "p_description": description,
            },
        )
        return rows[0] if rows else {}

    def list_audit_entries(
        self,
        document_id: str | None = None,
        author: str | None = None,
        operation: str | None = None,
        since: str | None = None,
        until: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        """Query audit log entries with optional filters.

        Args:
            document_id: Filter to entries for a specific document.
            author: Filter by author (exact match).
            operation: Filter by operation type.
            since: ISO timestamp -- return entries created after this time.
            until: ISO timestamp -- return entries created before this time.
            limit: Max entries to return (default 50).
        """
        return self.rpc(
            "cerefox_list_audit_entries",
            {
                "p_document_id": document_id,
                "p_author": author,
                "p_operation": operation,
                "p_since": since,
                "p_until": until,
                "p_limit": limit,
            },
        )

    # ── Review status ────────────────────────────────────────────────────────

    def set_review_status(
        self, document_id: str, status: str, author: str = "unknown"
    ) -> dict[str, Any]:
        """Set the review_status of a document and create an audit entry.

        Args:
            document_id: UUID of the document.
            status: 'approved' or 'pending_review'.
            author: Who is making the change.
        """
        if status not in ("approved", "pending_review"):
            raise ValueError(f"Invalid review_status: {status!r}")
        old = self.get_document_by_id(document_id)
        old_status = old.get("review_status", "unknown") if old else "unknown"
        resp = (
            self.client.table("cerefox_documents")
            .update({"review_status": status, "updated_at": "now()"})
            .eq("id", document_id)
            .execute()
        )
        self.create_audit_entry(
            operation="status-change",
            author=author,
            document_id=document_id,
            description=f"Review status changed from '{old_status}' to '{status}'",
        )
        return resp.data[0] if resp.data else {}

    # ── Version archival ─────────────────────────────────────────────────────

    def set_version_archived(
        self, version_id: str, archived: bool, author: str = "unknown"
    ) -> dict[str, Any]:
        """Set or clear the archived flag on a document version.

        Args:
            version_id: UUID of the version to archive/unarchive.
            archived: True to protect from cleanup, False to unprotect.
            author: Who is making the change.
        """
        resp = (
            self.client.table("cerefox_document_versions")
            .update({"archived": archived})
            .eq("id", version_id)
            .execute()
        )
        ver = resp.data[0] if resp.data else {}
        op = "archive" if archived else "unarchive"
        doc_id = ver.get("document_id")
        ver_num = ver.get("version_number", "?")
        self.create_audit_entry(
            operation=op,
            author=author,
            document_id=doc_id,
            version_id=version_id,
            description=f"Version {ver_num} {'archived (protected from cleanup)' if archived else 'unarchived (eligible for cleanup)'}",
        )
        return ver
