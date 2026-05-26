"""Tests for ``cerefox.docs_resources`` — the bundled-docs helper module."""

from __future__ import annotations

from pathlib import Path

from cerefox.docs_resources import (
    DocEntry,
    find_doc,
    list_bundled_docs,
    read_doc,
    real_path,
)


class TestListBundledDocs:
    def test_returns_non_empty_list(self) -> None:
        entries = list_bundled_docs()
        assert len(entries) > 0, "Expected at least README + AGENT_GUIDE + some guides"

    def test_includes_readme(self) -> None:
        entries = list_bundled_docs()
        paths = [e.path for e in entries]
        assert "README.md" in paths

    def test_includes_agent_guide(self) -> None:
        entries = list_bundled_docs()
        paths = [e.path for e in entries]
        assert "AGENT_GUIDE.md" in paths
        assert "AGENT_QUICK_REFERENCE.md" in paths

    def test_includes_guides(self) -> None:
        entries = list_bundled_docs()
        paths = [e.path for e in entries]
        guide_paths = [p for p in paths if p.startswith("guides/")]
        assert len(guide_paths) >= 3, f"Expected several guides, found {guide_paths}"

    def test_excludes_contributor_only_docs(self) -> None:
        entries = list_bundled_docs()
        paths = [e.path for e in entries]
        # CLAUDE.md, docs/research/*, docs/specs/*, docs/plan.md must NOT appear
        for forbidden in (
            "CLAUDE.md",
            "research/vision.md",
            "specs/polish-and-distribution-design.md",
            "plan.md",
            "TODO.md",
        ):
            assert forbidden not in paths, f"{forbidden} should not be bundled"

    def test_titles_are_non_empty(self) -> None:
        entries = list_bundled_docs()
        for e in entries:
            assert e.title, f"Empty title for {e.path}"

    def test_categories_are_known(self) -> None:
        entries = list_bundled_docs()
        for e in entries:
            assert e.category in ("readme", "agent-guide", "guide")

    def test_readme_appears_before_guides(self) -> None:
        entries = list_bundled_docs()
        paths = [e.path for e in entries]
        readme_idx = paths.index("README.md")
        first_guide_idx = next(i for i, p in enumerate(paths) if p.startswith("guides/"))
        assert readme_idx < first_guide_idx


class TestReadDoc:
    def test_reads_readme(self) -> None:
        content = read_doc("README.md")
        assert content is not None
        assert "Cerefox" in content

    def test_reads_a_guide(self) -> None:
        content = read_doc("guides/quickstart.md")
        assert content is not None
        assert len(content) > 100

    def test_returns_none_for_unknown(self) -> None:
        assert read_doc("guides/nonexistent.md") is None

    def test_rejects_path_traversal_dotdot(self) -> None:
        assert read_doc("../etc/passwd") is None
        assert read_doc("guides/../../etc/passwd") is None

    def test_rejects_absolute_path(self) -> None:
        assert read_doc("/etc/passwd") is None

    def test_rejects_empty_path(self) -> None:
        assert read_doc("") is None

    def test_rejects_paths_outside_known_locations(self) -> None:
        # CLAUDE.md is not in the bundled-set even though it exists at repo root.
        assert read_doc("CLAUDE.md") is None
        assert read_doc("docs/plan.md") is None


class TestRealPath:
    def test_returns_path_for_known_doc(self) -> None:
        path = real_path("README.md")
        assert path is not None
        assert isinstance(path, Path)
        assert path.is_file()

    def test_returns_none_for_path_traversal(self) -> None:
        assert real_path("../README.md") is None


class TestFindDoc:
    def test_exact_path_match(self) -> None:
        entry = find_doc("README.md")
        assert entry is not None
        assert entry.path == "README.md"

    def test_basename_match(self) -> None:
        entry = find_doc("quickstart")
        assert entry is not None
        assert entry.path == "guides/quickstart.md"

    def test_case_insensitive_title_substring(self) -> None:
        entry = find_doc("quick")
        assert entry is not None
        # Should match either AGENT_QUICK_REFERENCE or quickstart
        assert "quick" in entry.title.lower() or "quick" in entry.path.lower()

    def test_returns_none_for_no_match(self) -> None:
        assert find_doc("completely-unknown-doc-xyz") is None

    def test_returns_none_for_empty_query(self) -> None:
        assert find_doc("") is None

    def test_returns_dataclass_instance(self) -> None:
        entry = find_doc("README")
        assert isinstance(entry, DocEntry)
