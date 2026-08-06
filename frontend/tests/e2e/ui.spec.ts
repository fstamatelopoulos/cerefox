/**
 * UI end-to-end tests for the Cerefox React SPA via Playwright
 * (iter-26 Part 26I — TS port of tests/e2e/test_ui_e2e.py).
 *
 * Run: cd frontend && bun run test:e2e
 * Prereqs: `bun run build` (SPA built), `bunx playwright install chromium`,
 * CEREFOX_* in ~/.cerefox/.env. The webServer config auto-starts (or
 * reuses) `cerefox web` at :8000.
 *
 * Created docs/projects are [E2E-UI]-prefixed and hard-deleted via the
 * service client.
 */

import { expect, test } from "@playwright/test";

import { loadSettings } from "../../../_shared/config/index.ts";
import { createClient } from "../../../_shared/db-client/index.ts";

const APP = "/app";
const E2E_PREFIX = "[E2E-UI]";

function uniqueTitle(label: string): string {
  return `${E2E_PREFIX} ${label} ${crypto.randomUUID().slice(0, 8)}`;
}

/** Hard-delete a document by exact title (cascades to chunks). Best-effort. */
async function purgeDocByTitle(title: string): Promise<void> {
  try {
    const client = createClient(loadSettings());
    await client.raw.from("cerefox_documents").delete().eq("title", title);
  } catch {
    /* best-effort */
  }
}

/** Hard-delete a project by exact name. Best-effort. */
async function purgeProjectByName(name: string): Promise<void> {
  try {
    const client = createClient(loadSettings());
    await client.raw.from("cerefox_projects").delete().eq("name", name);
  } catch {
    /* best-effort */
  }
}

// ── Dashboard ──────────────────────────────────────────────────────────────
test.describe("Dashboard", () => {
  test("loads and shows stats", async ({ page }) => {
    await page.goto(APP);
    await expect(page.getByTestId("page-title")).toBeVisible();
    await expect(page.getByText("Documents", { exact: true }).first()).toBeVisible();
  });

  test("quick search navigates to search", async ({ page }) => {
    await page.goto(APP);
    await page.fill('input[placeholder="Quick search…"]', "cerefox");
    await page.getByRole("button", { name: "Search" }).first().click();
    await page.waitForURL("**/search**");
    await expect(page.getByTestId("page-title")).toHaveText(/Search/i);
  });
});

// ── Ingest ─────────────────────────────────────────────────────────────────
test.describe("Ingest (paste)", () => {
  test("paste ingest creates a document", async ({ page }) => {
    const title = uniqueTitle("Playwright Paste Test");
    await page.goto(`${APP}/ingest`);
    await expect(page.getByTestId("page-title")).toHaveText(/Ingest/i);

    await page.fill('input[placeholder="Document title"]', title);
    await page.fill(
      'textarea[placeholder="# Paste your Markdown here…"]',
      `# Test Document\n\nPlaywright e2e ${crypto.randomUUID()}.`,
    );
    await page.click('button[type="submit"]:has-text("Ingest")');

    await expect(
      page.getByText("ingested successfully").or(page.getByText("updated and re-indexed")),
    ).toBeVisible({ timeout: 30_000 });

    await purgeDocByTitle(title);
  });
});

// ── Search ─────────────────────────────────────────────────────────────────
test.describe("Search", () => {
  test("search page loads", async ({ page }) => {
    await page.goto(`${APP}/search`);
    await expect(page.getByTestId("page-title")).toHaveText(/Search/i);
  });

  test("search returns results", async ({ page }) => {
    await page.goto(`${APP}/search?q=cerefox&mode=docs`);
    await expect(page.getByText(/\d+ results? ·/)).toBeVisible({ timeout: 15_000 });
  });
});

// ── Projects ───────────────────────────────────────────────────────────────
test.describe("Projects", () => {
  test("project create → verify → delete", async ({ page }) => {
    const projectName = uniqueTitle("Test Project");
    await page.goto(`${APP}/projects`);
    await expect(page.getByTestId("page-title")).toHaveText("Projects");

    await page.getByRole("button", { name: "New project" }).click();
    await page.fill('input[placeholder="Project name"]', projectName);
    await page.fill('input[placeholder="Optional description"]', "E2E test project");
    await page.click('button[type="submit"]:has-text("Create")');
    await page.waitForTimeout(3000);

    await expect(page.getByText(projectName)).toBeVisible({ timeout: 10_000 });

    await purgeProjectByName(projectName);
  });
});

// ── Document detail ────────────────────────────────────────────────────────
test.describe("Document detail", () => {
  test("document page loads with action buttons", async ({ page }) => {
    await page.goto(APP);
    await page.waitForTimeout(2000);
    const docRows = page.getByTestId("recent-doc-row");
    if ((await docRows.count()) === 0) {
      test.skip(true, "No documents in the database to test");
      return;
    }
    await docRows.first().click();
    await page.waitForTimeout(2000);
    await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download" })).toBeVisible();
  });

  test("review status toggle visible", async ({ page }) => {
    await page.goto(APP);
    await page.waitForTimeout(2000);
    const docRows = page.getByTestId("recent-doc-row");
    if ((await docRows.count()) === 0) {
      test.skip(true, "No documents in the database to test");
      return;
    }
    await docRows.first().click();
    await page.waitForTimeout(2000);
    // The toggle shows the CURRENT state — either is correct; the point is that
    // the control renders.
    await expect(page.getByText(/^(Approved|Pending)$/)).toBeVisible();
  });
});

// ── Metadata Search ──────────────────────────────────────────────────────
test.describe("Metadata Search", () => {
  test("page loads with filter builder", async ({ page }) => {
    await page.goto(`${APP}/metadata-search`);
    await expect(page.getByTestId("page-title")).toHaveText(/Metadata/i);
    await expect(page.getByText("Metadata Filters")).toBeVisible();
    await expect(page.getByTestId("metadata-search-submit")).toBeVisible();
  });

  test("returns results or empty message", async ({ page }) => {
    await page.goto(`${APP}/metadata-search`);
    await page.waitForTimeout(1000);

    const keyInput = page.locator('input[placeholder="Key"]').first();
    await keyInput.click();
    await page.waitForTimeout(500);
    await keyInput.fill("author");
    await page.waitForTimeout(500);
    const option = page.locator('[role="option"]').first();
    if (await option.isVisible().catch(() => false)) {
      await option.click();
    }
    await page.locator('input[placeholder="Value"]').first().fill("e2e-test-suite");
    await page.getByTestId("metadata-search-submit").click();
    await page.waitForTimeout(5000);

    await expect(
      page.getByText("found").or(page.getByText("No documents match the metadata filter")),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ── Analytics ─────────────────────────────────────────────────────────────
test.describe("Analytics", () => {
  test("page loads with controls", async ({ page }) => {
    await page.goto(`${APP}/analytics`);
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await expect(page.getByText("Period")).toBeVisible();
    await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();
  });

  test("run analysis renders results", async ({ page }) => {
    await page.goto(`${APP}/analytics`);
    await page.getByRole("button", { name: "Run Analysis" }).click();
    await page.waitForTimeout(5000);
    await expect(
      page.getByText("Total Calls").or(page.getByText("No usage data")),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ── Audit Log ─────────────────────────────────────────────────────────────
test.describe("Audit Log", () => {
  test("page loads", async ({ page }) => {
    await page.goto(`${APP}/audit-log`);
    await expect(page.getByTestId("page-title")).toHaveText(/Audit/i);
  });
});

// ── Environment banner ────────────────────────────────────────────────────
// Asserts the contract rather than a fixed outcome: the banner appears if and
// only if the server reports an `env_label`. That way the test is meaningful
// on a normal install (where it guards against a banner ever showing up
// uninvited) and on a labelled staging server, without needing two harnesses.
test.describe("Environment banner", () => {
  test("shown only when the server reports an env_label", async ({ page, request }) => {
    const info = await (await request.get("/api/v1/version")).json();
    const label = (info.env_label ?? "").trim();

    await page.goto(`${APP}/`);
    const banner = page.getByTestId("environment-banner");

    if (label) {
      await expect(banner).toBeVisible({ timeout: 15_000 });
      await expect(banner).toContainText(label.toUpperCase());
      await expect(banner).toContainText("not production");
    } else {
      // The overwhelmingly common case: a normal single-environment install
      // must never see this.
      await expect(banner).toHaveCount(0);
    }
  });
});
