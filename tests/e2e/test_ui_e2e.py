"""UI end-to-end tests for the Cerefox React SPA via Playwright.

Run with: uv run pytest -m ui
Or:       uv run pytest tests/e2e/test_ui_e2e.py -m ui

Prerequisites:
  - The Cerefox web app must be running at http://127.0.0.1:8000/
    Start it with: uv run uvicorn cerefox.api.app:app --host 127.0.0.1 --port 8000
  - Frontend must be built: cd frontend && npm run build
  - Playwright browsers must be installed: uv run playwright install chromium

If the app is not running, tests will fail with a connection error.
"""

from __future__ import annotations

import uuid

import pytest
from playwright.sync_api import Page, expect

from cerefox.db.client import CerefoxClient

pytestmark = pytest.mark.ui

BASE_URL = "http://127.0.0.1:8000/app"
E2E_PREFIX = "[E2E-UI]"


def _unique_title(label: str) -> str:
    return f"{E2E_PREFIX} {label} {uuid.uuid4().hex[:8]}"


# ── Dashboard ──────────────────────────────────────────────────────────────


class TestDashboard:
    def test_loads_and_shows_stats(self, page: Page):
        page.goto(BASE_URL)
        expect(page.get_by_role("heading", name="Dashboard")).to_be_visible()
        expect(page.get_by_text("Documents", exact=True).first).to_be_visible()
        expect(page.get_by_text("Recent Documents")).to_be_visible()

    def test_quick_search_navigates_to_search(self, page: Page):
        page.goto(BASE_URL)
        page.fill('input[placeholder="Quick search..."]', "cerefox")
        page.click('button:has-text("Go")')
        page.wait_for_url("**/search**")
        expect(page.get_by_role("heading", name="Search Knowledge Base")).to_be_visible()


# ── Ingest ─────────────────────────────────────────────────────────────────


class TestIngestPaste:
    def test_paste_ingest_creates_document(self, page: Page, e2e_client: CerefoxClient):
        """Full ingest flow: paste content, verify success, clean up."""
        title = _unique_title("Playwright Paste Test")

        page.goto(f"{BASE_URL}/ingest")
        expect(page.get_by_role("heading", name="Ingest Content")).to_be_visible()

        # Fill in the paste form (default tab)
        page.fill('input[placeholder="Document title"]', title)
        page.fill(
            'textarea[placeholder="Paste your Markdown content here..."]',
            "# Test Document\n\nThis is a Playwright test document for e2e testing.",
        )
        page.click('button[type="submit"]:has-text("Ingest")')

        # Should see success alert (embedding can take several seconds)
        expect(
            page.get_by_text("ingested successfully").or_(page.get_by_text("updated and re-indexed"))
        ).to_be_visible(timeout=30000)

        # Clean up via REST API
        docs = e2e_client.list_documents(limit=50)
        for doc in docs:
            if doc.get("title") == title:
                e2e_client.delete_document(doc["id"])
                break


# ── Search ─────────────────────────────────────────────────────────────────


class TestSearch:
    def test_search_page_loads(self, page: Page):
        page.goto(f"{BASE_URL}/search")
        expect(page.get_by_role("heading", name="Search Knowledge Base")).to_be_visible()

    def test_search_returns_results(self, page: Page):
        """Search for a term that should match existing documents."""
        page.goto(f"{BASE_URL}/search?q=cerefox&mode=docs")
        # Should show "N results found" text
        expect(page.get_by_text("results found")).to_be_visible(timeout=10000)


# ── Projects ───────────────────────────────────────────────────────────────


class TestProjects:
    def test_project_crud(self, page: Page, e2e_client: CerefoxClient):
        """Create, verify, delete a project via the web UI."""
        project_name = _unique_title("Test Project")

        page.goto(f"{BASE_URL}/projects")
        expect(page.get_by_role("heading", name="Projects", exact=True)).to_be_visible()

        # Create project
        page.fill('input[placeholder="Project name"]', project_name)
        page.fill('input[placeholder="Optional description"]', "E2E test project")
        page.click('button[type="submit"]:has-text("Create")')
        page.wait_for_timeout(3000)

        # Verify it appears (page refreshes query after mutation)
        expect(page.get_by_text(project_name)).to_be_visible(timeout=10000)

        # Clean up via REST API
        for proj in e2e_client.list_projects():
            if proj.get("name") == project_name:
                e2e_client.delete_project(proj["id"])
                break


# ── Document detail ────────────────────────────────────────────────────────


class TestDocumentView:
    def test_document_page_loads(self, page: Page):
        """Navigate to dashboard, click first document, verify detail page loads."""
        page.goto(BASE_URL)
        page.wait_for_timeout(2000)

        # Click on the first document link if any exist
        doc_links = page.locator("a[href*='/document/']")
        if doc_links.count() == 0:
            pytest.skip("No documents in the database to test")

        doc_links.first.click()
        page.wait_for_timeout(2000)

        # Should show document detail with action buttons
        expect(page.get_by_role("button", name="Edit")).to_be_visible()
        expect(page.get_by_role("link", name="Download")).to_be_visible()

    def test_review_status_toggle_visible(self, page: Page):
        """Document detail should show review status toggle."""
        page.goto(BASE_URL)
        page.wait_for_timeout(2000)
        doc_links = page.locator("a[href*='/document/']")
        if doc_links.count() == 0:
            pytest.skip("No documents in the database to test")
        doc_links.first.click()
        page.wait_for_timeout(2000)
        expect(page.get_by_text("Approved")).to_be_visible()


# ── Audit Log ─────────────────────────────────────────────────────────────


class TestAuditLog:
    def test_audit_log_page_loads(self, page: Page):
        page.goto(f"{BASE_URL}/audit-log")
        expect(page.get_by_role("heading", name="Audit Log")).to_be_visible()
