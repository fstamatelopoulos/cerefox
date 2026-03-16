"""Ingestion pipeline: markdown text → chunks → embeddings → Supabase.

Usage::

    from cerefox.ingestion.pipeline import IngestionPipeline
    from cerefox.config import Settings
    from cerefox.db.client import CerefoxClient
    from cerefox.embeddings.cloud import CloudEmbedder

    settings = Settings()
    client = CerefoxClient(settings)
    embedder = CloudEmbedder(...)
    pipeline = IngestionPipeline(client, embedder, settings)

    result = pipeline.ingest_text(
        text="# My note\\n\\nSome content.",
        title="My note",
        source="paste",
        project_ids=["<uuid>"],
    )
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

from cerefox.chunking.markdown import chunk_markdown

if TYPE_CHECKING:
    from cerefox.config import Settings
    from cerefox.db.client import CerefoxClient
    from cerefox.embeddings.base import Embedder

log = logging.getLogger(__name__)


@dataclass
class IngestResult:
    """Summary returned by every ingest_* call.

    ``action`` is the canonical outcome:
    - ``"created"``  — new document written to the knowledge base.
    - ``"updated"``  — existing document updated; check ``reindexed`` to
                       distinguish a full re-embed from a metadata-only save.
    - ``"skipped"``  — identical content already present; nothing written.

    ``reindexed`` is only meaningful when ``action == "updated"`` and
    indicates that chunks were deleted and re-embedded because the content
    changed.
    """

    document_id: str
    title: str
    chunk_count: int
    total_chars: int
    action: Literal["created", "updated", "skipped"]
    reindexed: bool = False  # True when chunks were re-embedded (content changed on update)
    project_ids: list[str] = field(default_factory=list)

    @property
    def skipped(self) -> bool:
        """Back-compat shim — prefer checking ``action`` directly."""
        return self.action == "skipped"


class IngestionPipeline:
    """Orchestrates the full parse → chunk → embed → store flow.

    All public methods are synchronous.  For fire-and-forget background
    ingestion wrap them in a thread or process pool.

    Args:
        client: Supabase client wrapper.
        embedder: Any object satisfying the :class:`~cerefox.embeddings.base.Embedder` protocol.
        settings: Application settings (chunk sizes, etc.).
    """

    def __init__(
        self,
        client: "CerefoxClient",
        embedder: "Embedder",
        settings: "Settings",
    ) -> None:
        self._client = client
        self._embedder = embedder
        self._settings = settings

    # ── Public API ────────────────────────────────────────────────────────

    def ingest_text(
        self,
        text: str,
        title: str,
        source: str = "paste",
        source_path: str | None = None,
        project_name: str | None = None,
        project_id: str | None = None,
        project_ids: list[str] | None = None,
        metadata: dict | None = None,
        update_existing: bool = False,
    ) -> IngestResult:
        """Ingest a raw markdown string.

        Args:
            text: Markdown content to ingest.
            title: Human-readable document title.
            source: Origin label (e.g. ``"file"``, ``"paste"``, ``"agent"``).
            source_path: Optional filesystem path or URL the content came from.
            project_name: If given, the document is linked to this project
                (created automatically if it doesn't exist).  Ignored when
                ``project_ids`` is provided.
            project_id: Single project UUID (legacy convenience; converted to
                ``project_ids=[project_id]`` internally).
            project_ids: List of project UUIDs to assign (M2M).  Takes
                precedence over ``project_id`` and ``project_name``.
            metadata: Arbitrary key/value pairs stored as JSONB on the document.
            update_existing: When True, look up an existing document by
                ``source_path`` (for file ingestion) or by ``title`` (for
                paste/agent content).  If found, update it in-place instead of
                creating a new document.  Falls through to normal create when no
                match is found.

        Returns:
            :class:`IngestResult` summary.
        """
        # ── Update-existing shortcut ───────────────────────────────────────────
        if update_existing:
            existing_doc: dict | None = None
            lookup_key = "source_path" if source_path else "title"
            if source_path:
                existing_doc = self._client.find_document_by_source_path(source_path)
            if existing_doc is None:
                existing_doc = self._client.find_document_by_title(title)
            if existing_doc is not None:
                log.info(
                    "update_existing: found doc %s by %s, updating in place",
                    existing_doc["id"],
                    lookup_key,
                )
                resolved_ids = self._resolve_project_ids(project_ids, project_id, project_name)
                return self.update_document(
                    document_id=existing_doc["id"],
                    text=text,
                    title=title,
                    project_ids=resolved_ids if resolved_ids else None,
                    metadata=metadata,
                )
            log.info("update_existing: no existing doc found — creating new document")

        # Resolve project_ids from the various caller styles.
        resolved_ids = self._resolve_project_ids(project_ids, project_id, project_name)

        validated_meta = metadata or {}

        content_hash = _hash(text)

        # ── Deduplication ──────────────────────────────────────────────────
        existing = self._client.get_document_by_hash(content_hash)
        if existing is not None:
            log.info("Document already ingested (hash match): %s", existing["id"])
            existing_project_ids = self._client.get_document_project_ids(existing["id"])
            return IngestResult(
                document_id=existing["id"],
                title=existing.get("title", title),
                chunk_count=existing.get("chunk_count", 0),
                total_chars=existing.get("total_chars", 0),
                action="skipped",
                project_ids=existing_project_ids,
            )

        # ── Chunk ─────────────────────────────────────────────────────────
        s = self._settings
        chunks = chunk_markdown(
            text,
            max_chunk_chars=s.max_chunk_chars,
            min_chunk_chars=s.min_chunk_chars,
        )
        total_chars = sum(c.char_count for c in chunks)

        # ── Create document record ─────────────────────────────────────────
        doc_row = self._client.insert_document(
            {
                "title": title,
                "source": source,
                "source_path": source_path,
                "content_hash": content_hash,
                "metadata": validated_meta,
                "chunk_count": len(chunks),
                "total_chars": total_chars,
            }
        )
        document_id: str = doc_row["id"]
        log.info("Created document %s (%d chunks)", document_id, len(chunks))

        # ── Assign projects (M2M) ──────────────────────────────────────────
        if resolved_ids:
            self._client.assign_document_projects(document_id, resolved_ids)

        # ── Embed + store chunks ───────────────────────────────────────────
        if chunks:
            texts = [c.content for c in chunks]
            embeddings = self._embedder.embed_batch(texts)

            chunk_rows = [
                {
                    "document_id": document_id,
                    "chunk_index": c.chunk_index,
                    "heading_path": c.heading_path,
                    "heading_level": c.heading_level,
                    "title": c.title,
                    "content": c.content,
                    "char_count": c.char_count,
                    "embedding_primary": embeddings[i],
                    "embedder_primary": self._embedder.model_name,
                }
                for i, c in enumerate(chunks)
            ]
            self._client.insert_chunks(chunk_rows)
            log.info("Stored %d chunks for document %s", len(chunks), document_id)

        return IngestResult(
            document_id=document_id,
            title=title,
            chunk_count=len(chunks),
            total_chars=total_chars,
            action="created",
            project_ids=resolved_ids,
        )

    def update_document(
        self,
        document_id: str,
        text: str,
        title: str,
        project_id: str | None = None,
        project_ids: list[str] | None = None,
        metadata: dict | None = None,
    ) -> IngestResult:
        """Re-ingest an existing document in place, preserving its ID.

        Replaces the document's content, title, and metadata. Old chunks are
        deleted and new ones are computed from the provided text. The document
        UUID is kept, so any external references remain valid.

        Project assignments are only updated when ``project_ids`` (or legacy
        ``project_id``) is explicitly provided; ``None`` leaves current
        assignments unchanged, while ``[]`` removes all project assignments.

        Args:
            document_id: UUID of the document to update.
            text: New markdown content.
            title: New document title.
            project_id: Single project UUID (legacy; prefer ``project_ids``).
            project_ids: New list of project UUIDs.  ``None`` = unchanged;
                ``[]`` = remove from all projects.
            metadata: New metadata dict. If None, existing metadata is preserved.

        Returns:
            :class:`IngestResult` summary (skipped=False always).

        Raises:
            ValueError: If the document is not found, or if the new content is
                identical to another document (hash collision on a different ID).
        """
        # ── Verify document exists ─────────────────────────────────────────
        existing = self._client.get_document_by_id(document_id)
        if existing is None:
            raise ValueError(f"Document {document_id!r} not found")

        # ── Hash check ─────────────────────────────────────────────────────
        new_hash = _hash(text)
        content_unchanged = new_hash == existing.get("content_hash")

        # Guard against collision with a *different* document.
        if not content_unchanged:
            collision = self._client.get_document_by_hash(new_hash)
            if collision is not None and collision["id"] != document_id:
                raise ValueError(
                    f"Identical content already exists as document {collision['title']!r}. "
                    "Edit that document or change the content before saving."
                )

        # metadata is passed through as-is (open-ended JSONB)

        # ── Resolve project associations ───────────────────────────────────
        new_project_ids: list[str] | None = None
        if project_ids is not None:
            new_project_ids = [p for p in project_ids if p]
        elif project_id is not None:
            new_project_ids = [project_id]

        if content_unchanged:
            # Content didn't change — skip chunking, embedding, and chunk swap.
            # Only update title, metadata, and project associations.
            update_data: dict = {"title": title}
            if metadata is not None:
                update_data["metadata"] = metadata
            self._client.update_document(document_id, update_data)

            if new_project_ids is not None:
                self._client.assign_document_projects(document_id, new_project_ids)
                final_project_ids = new_project_ids
            else:
                final_project_ids = self._client.get_document_project_ids(document_id)

            chunk_count = existing.get("chunk_count") or 0
            total_chars = existing.get("total_chars") or 0
            log.info("Document %s unchanged — skipped reindex (%d chunks)", document_id, chunk_count)
            return IngestResult(
                document_id=document_id,
                title=title,
                chunk_count=chunk_count,
                total_chars=total_chars,
                action="updated",
                reindexed=False,
                project_ids=final_project_ids,
            )

        # ── Chunk + embed (content changed) ───────────────────────────────
        s = self._settings
        chunks = chunk_markdown(
            text,
            max_chunk_chars=s.max_chunk_chars,
            min_chunk_chars=s.min_chunk_chars,
        )
        total_chars = sum(c.char_count for c in chunks)

        # Embed before touching the DB — if embedding fails we haven't broken anything.
        texts = [c.content for c in chunks]
        embeddings = self._embedder.embed_batch(texts) if chunks else []

        # ── Swap chunks ────────────────────────────────────────────────────
        self._client.delete_chunks_for_document(document_id)

        # ── Update document record ─────────────────────────────────────────
        update_data = {
            "title": title,
            "content_hash": new_hash,
            "chunk_count": len(chunks),
            "total_chars": total_chars,
        }
        if metadata is not None:
            update_data["metadata"] = metadata

        self._client.update_document(document_id, update_data)
        log.info("Updated document %s (%d chunks)", document_id, len(chunks))

        # ── Update project associations if provided ────────────────────────
        if new_project_ids is not None:
            self._client.assign_document_projects(document_id, new_project_ids)
            final_project_ids = new_project_ids
        else:
            final_project_ids = self._client.get_document_project_ids(document_id)

        # ── Insert new chunks ──────────────────────────────────────────────
        if chunks:
            chunk_rows = [
                {
                    "document_id": document_id,
                    "chunk_index": c.chunk_index,
                    "heading_path": c.heading_path,
                    "heading_level": c.heading_level,
                    "title": c.title,
                    "content": c.content,
                    "char_count": c.char_count,
                    "embedding_primary": embeddings[i],
                    "embedder_primary": self._embedder.model_name,
                }
                for i, c in enumerate(chunks)
            ]
            self._client.insert_chunks(chunk_rows)
            log.info("Re-stored %d chunks for document %s", len(chunks), document_id)

        return IngestResult(
            document_id=document_id,
            title=title,
            chunk_count=len(chunks),
            total_chars=total_chars,
            action="updated",
            reindexed=True,
            project_ids=final_project_ids,
        )

    def ingest_file(
        self,
        path: str,
        title: str | None = None,
        project_name: str | None = None,
        project_ids: list[str] | None = None,
        metadata: dict | None = None,
        update_existing: bool = False,
    ) -> IngestResult:
        """Read a markdown file from disk and ingest it.

        Args:
            path: Absolute or relative path to a ``.md`` file.
            title: Document title.  Defaults to the filename stem.
            project_name: Optional project name to assign the document to.
            project_ids: Optional list of project UUIDs (M2M).
            metadata: Arbitrary JSONB metadata.
            update_existing: When True, update an existing document with the
                same ``source_path`` (resolved absolute path) instead of
                creating a new document.

        Returns:
            :class:`IngestResult` summary.
        """
        from pathlib import Path  # noqa: PLC0415

        p = Path(path)
        text = p.read_text(encoding="utf-8")
        return self.ingest_text(
            text=text,
            title=title or p.stem,
            source="file",
            source_path=str(p.resolve()),
            project_name=project_name,
            project_ids=project_ids,
            metadata=metadata,
            update_existing=update_existing,
        )

    # ── Private helpers ────────────────────────────────────────────────────

    def _resolve_project_ids(
        self,
        project_ids: list[str] | None,
        project_id: str | None,
        project_name: str | None,
    ) -> list[str]:
        """Return a normalised list of project UUIDs from the caller's inputs."""
        if project_ids is not None:
            return [p for p in project_ids if p]  # strip empties / empty strings
        if project_id:
            return [project_id]
        if project_name:
            project = self._client.get_or_create_project(project_name)
            return [project["id"]]
        return []


# ── Helpers ───────────────────────────────────────────────────────────────────


def _normalize(text: str) -> str:
    """Normalise content before hashing.

    Converts CRLF (and bare CR) line endings to LF, strips leading/trailing
    whitespace, and collapses 3+ consecutive newlines to two.  This ensures
    that hashes are stable across round-trips through the web edit form
    (browsers submit textarea content with CRLF per the HTML spec) and the
    TypeScript Edge Function.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return re.sub(r"\n{3,}", "\n\n", text.strip())


def _hash(text: str) -> str:
    """Return a SHA-256 hex digest of the normalised UTF-8 encoded text."""
    return hashlib.sha256(_normalize(text).encode("utf-8")).hexdigest()
