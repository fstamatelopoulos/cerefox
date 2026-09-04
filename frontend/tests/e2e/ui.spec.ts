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

import { loadEnv, loadSettings } from "../../../_shared/config/index.ts";
import { createClient } from "../../../_shared/db-client/index.ts";

const APP = "/app";
const E2E_PREFIX = "[E2E-UI]";

/**
 * Refuse to run against an unlabelled (production) target.
 *
 * This suite creates documents and projects through the real UI, so it writes
 * to whatever store the server it is talking to is pointed at. It is the last
 * live suite without this check — the others gained it after a `bun test` run
 * wrote to the production store — and it was missed because it runs under
 * Playwright rather than `bun test`, so the coverage guard that enumerates
 * live-capable suites never looked at it.
 *
 * Mirrors `packages/memory/test/_live-target-guard.ts`. Kept as a local copy
 * rather than an import because Playwright and Bun resolve modules differently
 * here, and a guard that fails to load is a guard that does not run.
 */
function mayWriteToLiveTarget(): boolean {
  if (process.env.CEREFOX_ALLOW_PROD_WRITE_TESTS === "1") return true;
  if ((process.env.CEREFOX_ENV_LABEL ?? "").trim()) return true;
  try {
    // The label usually lives in the resolved config FILE, not the ambient
    // environment — `CEREFOX_CONFIG_DIR=~/.cerefox/staging` sets none here — so
    // load that file the way the CLI does and re-read. `Settings` carries no
    // envLabel field, so reading process.env after loadEnv() is the only route.
    loadEnv();
    return Boolean((process.env.CEREFOX_ENV_LABEL ?? "").trim());
  } catch {
    return false;
  }
}

test.beforeAll(() => {
  if (!mayWriteToLiveTarget()) {
    throw new Error(
      "Refusing to run UI e2e against an unlabelled (production) target. " +
        "These tests create real documents and projects. Point them at a labelled " +
        "environment — CEREFOX_CONFIG_DIR=~/.cerefox/staging bun run test:e2e — " +
        "or set CEREFOX_ALLOW_PROD_WRITE_TESTS=1 if you truly mean production.",
    );
  }
});

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

// ── Dashboard recent-docs project scope ────────────────────────────────────
test.describe("Dashboard recent docs", () => {
  test("project selector scopes the tile and refetches", async ({ page }) => {
    await page.goto(APP);
    const select = page.getByTestId("recent-project-select");
    await expect(select).toBeVisible();
    await expect(select).toHaveValue(""); // "All projects" default

    // The options arrive with the dashboard query — poll instead of reading
    // once, or the test skips on a race it should have waited out.
    const options = select.locator("option");
    try {
      await expect.poll(async () => options.count(), { timeout: 8000 }).toBeGreaterThan(1);
    } catch {
      test.skip(true, "No projects to scope by");
      return;
    }
    const value = await options.nth(1).getAttribute("value");
    // Selecting a project must hit the server with the scope, not filter
    // client-side: the tile's rows are a fresh top-10 within the project.
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/dashboard/recent-docs?project_id=")),
      select.selectOption(value!),
    ]);
    await expect(select).toHaveValue(value!);
  });

  test("the misleading View all link is gone", async ({ page }) => {
    await page.goto(APP);
    await expect(page.getByTestId("recent-project-select")).toBeVisible();
    await expect(page.getByRole("button", { name: "View all" })).toHaveCount(0);
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

  test("review status toggle follows review_workflow_enabled", async ({ page, request }) => {
    // Off → the toggle does not exist (#241); on → it renders the CURRENT
    // state, either of which is correct. Read the flag, do not set it.
    const flag = (await (await request.get("/api/v1/config/review_workflow_enabled")).json()) as {
      value: string | null;
    };
    const on = String(flag.value ?? "").toLowerCase() === "true";
    await page.goto(APP);
    await page.waitForTimeout(2000);
    const docRows = page.getByTestId("recent-doc-row");
    if ((await docRows.count()) === 0) {
      test.skip(true, "No documents in the database to test");
      return;
    }
    await docRows.first().click();
    await page.waitForTimeout(2000);
    const toggle = page.getByText(/^(Approved|Pending)$/);
    if (on) await expect(toggle).toBeVisible();
    else await expect(toggle).toHaveCount(0);
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

// ── Settings ──────────────────────────────────────────────────────────────
test.describe("Settings", () => {
  test("page loads and lists config groups", async ({ page }) => {
    await page.goto(`${APP}/settings`);
    await expect(page.getByTestId("page-title")).toHaveText(/Settings/i);
    await expect(page.getByTestId("config-row-relations_enabled")).toBeVisible();
    await expect(page.getByTestId("config-row-review_workflow_enabled")).toBeVisible();
    await expect(page.getByTestId("config-row-min_search_score")).toBeVisible();
  });

  test("a stale retired env var is flagged as inert", async ({ page, request }) => {
    const cfg = await (await request.get("/api/v1/config")).json();
    const stale = (cfg.keys as Array<{ key: string; retired_env_set: unknown }>).filter(
      (k) => k.retired_env_set !== null && k.retired_env_set !== undefined,
    );

    await page.goto(`${APP}/settings`);
    for (const k of stale) {
      // A leftover .env line that looks applied but does nothing is exactly the
      // failure mode v1.1.0 fixes, so the page must say so where the setting is.
      const warn = page.getByTestId(`config-retired-env-${k.key}`);
      await expect(warn).toBeVisible();
      await expect(warn).toContainText("no longer read");
      // It must distinguish "already carried over" (inert leftover) from "your
      // tuning is NOT in effect" — the second is the only one that needs action,
      // and saying "just delete the line" there would be actively wrong.
      const entry = k as unknown as { effective: string; retired_env_set: { value: string } };
      const same = Number(entry.retired_env_set.value) === Number(entry.effective);
      await expect(warn).toContainText(same ? "already matches" : "is what actually runs");
    }
    // Whether or not any are set, the page itself must render.
    await expect(page.getByTestId("config-row-min_search_score")).toBeVisible();
  });

  test("toggling a high-impact key asks for confirmation first", async ({ page, request }) => {
    const before = await (await request.get("/api/v1/config")).json();
    const relations = (before.keys as Array<{ key: string; effective: string }>).find(
      (k) => k.key === "relations_enabled",
    );

    await page.goto(`${APP}/settings`);
    const row = page.getByTestId("config-row-relations_enabled");
    // Click the track, not the input: Mantine's switch input is visually
    // hidden and does not receive the click.
    await row.locator(".mantine-Switch-track").click();

    // Nothing is written until the consequence has been read and accepted:
    // this switch decides whether four tools appear in every agent's list.
    // Assert on the modal BODY — `data-testid` on <Modal> lands on Mantine's
    // positioning root, which reports as hidden even while open.
    const modal = page.getByTestId("config-confirm-body");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("agent");

    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();

    const after = await (await request.get("/api/v1/config")).json();
    const relationsAfter = (after.keys as Array<{ key: string; effective: string }>).find(
      (k) => k.key === "relations_enabled",
    );
    expect(relationsAfter?.effective).toBe(relations?.effective);
  });

  test("rejects an out-of-range value", async ({ request }) => {
    const resp = await request.put("/api/v1/config/min_search_score", {
      data: { value: "5" },
    });
    expect(resp.status()).toBe(400);
    expect(await resp.text()).toContain("min_search_score");
  });
});
