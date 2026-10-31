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
 * service client. Exception: the Trash tests EMPTY THE TARGET'S TRASH (the
 * feature under test); they skip if it holds anything not [E2E-prefixed.
 */

import { expect, test } from "@playwright/test";

import { loadEnv, loadSettings } from "../../../_shared/config/index.ts";
import { createClient } from "../../../_shared/db-client/index.ts";

const APP = "/app";
const E2E_PREFIX = "[E2E-UI]";

/**
 * Refuse to run against an unlabeled (production) target.
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
      "Refusing to run UI e2e against an unlabeled (production) target. " +
        "These tests create real documents and projects, and the Trash tests empty the whole trash. Point them at a labeled " +
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
  // Best-effort, so a cleanup problem never masks the test's own result, but
  // never silent: a leaked [E2E fixture should show up in the run's output.
  try {
    const client = createClient(loadSettings());
    const { error } = await client.raw.from("cerefox_documents").delete().eq("title", title);
    if (error) console.warn(`cleanup: could not delete "${title}": ${error.message}`);
  } catch (err) {
    console.warn(`cleanup: could not delete "${title}": ${String(err)}`);
  }
}

/** Hard-delete a project by exact name. Best-effort. */
async function purgeProjectByName(name: string): Promise<void> {
  try {
    const client = createClient(loadSettings());
    const { error } = await client.raw.from("cerefox_projects").delete().eq("name", name);
    if (error) console.warn(`cleanup: could not delete project "${name}": ${error.message}`);
  } catch (err) {
    console.warn(`cleanup: could not delete project "${name}": ${String(err)}`);
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

// A duplicate create is skipped, and the page must say so (#334 review): it
// used to clear the form and show nothing at all.
test.describe("Ingest: duplicate content", () => {
  test("pasting the same content again says it is already in memory", async ({ page }) => {
    const title = uniqueTitle("Duplicate Paste");
    const body = `# Duplicate\n\nPlaywright e2e ${crypto.randomUUID()}.`;
    try {
      await page.goto(`${APP}/ingest`);
      await page.fill('input[placeholder="Document title"]', title);
      await page.fill('textarea[placeholder="# Paste your Markdown here…"]', body);
      await page.click('button[type="submit"]:has-text("Ingest")');
      await expect(page.getByText("ingested successfully")).toBeVisible({ timeout: 30_000 });

      await page.goto(`${APP}/ingest`);
      await page.fill('input[placeholder="Document title"]', `${title} copy`);
      await page.fill('textarea[placeholder="# Paste your Markdown here…"]', body);
      await page.click('button[type="submit"]:has-text("Ingest")');
      const alert = page.getByTestId("ingest-skipped");
      await expect(alert).toBeVisible({ timeout: 30_000 });
      await expect(alert).toContainText(title);
      await expect(alert.getByText("View document")).toBeVisible();
    } finally {
      await purgeDocByTitle(title);
      await purgeDocByTitle(`${title} copy`);
    }
  });
});

// "Update existing" must actually update when the content changed (#298). It
// sent no concurrency token, so the server refused exactly the case the toggle
// exists for; these walk it through the real UI on both tabs and then check the
// store, not just the banner: one document, carrying the new content.
test.describe("Ingest: Update existing (#298)", () => {
  /** The ids of every live document with this exact title. */
  async function docIdsByTitle(title: string): Promise<string[]> {
    const client = createClient(loadSettings());
    const { data } = await client.raw.from("cerefox_documents").select("id").eq("title", title).is("deleted_at", null);
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  async function toggleUpdateExisting(page: import("@playwright/test").Page): Promise<void> {
    const toggle = page.getByRole("switch");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  }

  test("paste: changed content under the same title updates the document", async ({ page, request }) => {
    const title = uniqueTitle("Update Existing Paste");
    const first = `first-${crypto.randomUUID()}`;
    const second = `second-${crypto.randomUUID()}`;
    try {
      await page.goto(`${APP}/ingest`);
      await page.fill('input[placeholder="Document title"]', title);
      await page.fill('textarea[placeholder="# Paste your Markdown here…"]', `# V1\n\n${first}`);
      await page.click('button[type="submit"]:has-text("Ingest")');
      await expect(page.getByText("ingested successfully")).toBeVisible({ timeout: 30_000 });

      await page.goto(`${APP}/ingest`);
      await page.fill('input[placeholder="Document title"]', title);
      await page.fill('textarea[placeholder="# Paste your Markdown here…"]', `# V2\n\n${second}`);
      await toggleUpdateExisting(page);
      await page.click('button[type="submit"]:has-text("Ingest")');
      await expect(page.getByText("updated and re-indexed")).toBeVisible({ timeout: 30_000 });

      const ids = await docIdsByTitle(title);
      expect(ids).toHaveLength(1);
      const doc = (await (await request.get(`/api/v1/documents/${ids[0]}`)).json()) as { full_content: string };
      expect(doc.full_content).toContain(second);
      expect(doc.full_content).not.toContain(first);
    } finally {
      await purgeDocByTitle(title);
    }
  });

  test("file: a changed re-upload of the same file updates the document", async ({ page, request }) => {
    const title = uniqueTitle("Update Existing File");
    const name = `e2e-update-existing-${crypto.randomUUID().slice(0, 8)}.md`;
    const first = `first-${crypto.randomUUID()}`;
    const second = `second-${crypto.randomUUID()}`;
    const upload = async (body: string, update: boolean) => {
      await page.goto(`${APP}/ingest`);
      await page.getByRole("button", { name: "Upload file" }).click();
      await page.fill('input[placeholder="Document title"]', title);
      await page.setInputFiles('input[type="file"]', {
        name,
        mimeType: "text/markdown",
        buffer: Buffer.from(body),
      });
      if (update) {
        // A file whose name is already stored switches "Update existing" on by
        // itself once the name check answers. Wait for that instead of clicking:
        // on a fast backend the check lands first and a click turns it back off.
        await expect(page.getByText(/already exists/)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByRole("switch")).toHaveAttribute("aria-checked", "true");
      }
      await page.click('button[type="submit"]:has-text("Upload & ingest")');
    };
    try {
      await upload(`# V1\n\n${first}\n`, false);
      await expect(page.getByText("ingested successfully")).toBeVisible({ timeout: 30_000 });

      await upload(`# V2\n\n${second}\n`, true);
      await expect(page.getByText("updated and re-indexed")).toBeVisible({ timeout: 30_000 });

      const ids = await docIdsByTitle(title);
      expect(ids).toHaveLength(1);
      const doc = (await (await request.get(`/api/v1/documents/${ids[0]}`)).json()) as { full_content: string };
      expect(doc.full_content).toContain(second);
      expect(doc.full_content).not.toContain(first);
    } finally {
      await purgeDocByTitle(title);
    }
  });
});

// ── Search ─────────────────────────────────────────────────────────────────
test.describe("Search", () => {
  test("search page loads", async ({ page }) => {
    await page.goto(`${APP}/search`);
    await expect(page.getByTestId("page-title")).toHaveText(/Search/i);
  });

  test("search returns results", async ({ page, request }) => {
    // Seeds what it searches for, so it does not depend on the store's content.
    const title = uniqueTitle("Search Probe");
    const marker = `searchprobe${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    try {
      const r = await request.post("/api/v1/ingest", { data: { title, content: `# ${title}\n\n${marker}\n` } });
      expect(r.ok()).toBeTruthy();
      await page.goto(`${APP}/search?q=${marker}&mode=docs`);
      await expect(page.getByText(/\d+ results? ·/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(title).first()).toBeVisible();
    } finally {
      await purgeDocByTitle(title);
    }
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
    await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
  });

  test("Download offers Markdown, Word and PDF, each a real file", async ({ page, request }) => {
    const title = uniqueTitle("Download Formats");
    const marker = `fmt-${crypto.randomUUID()}`;
    try {
      const r = await request.post("/api/v1/ingest", {
        data: { title, content: `# ${title}\n\nBody ${marker} with **bold** text.\n\n- one\n- two\n` },
      });
      expect(r.ok()).toBeTruthy();
      const id = ((await r.json()) as { document_id: string }).document_id;
      await page.goto(`${APP}/document/${id}`);
      const { readFileSync } = await import("node:fs");
      for (const [label, ext, check] of [
        ["Markdown (.md)", "md", (b: Buffer) => b.toString("utf8").includes(marker)],
        ["Word (.docx)", "docx", (b: Buffer) => b.subarray(0, 2).toString() === "PK"],
        ["PDF (.pdf)", "pdf", (b: Buffer) => b.subarray(0, 5).toString() === "%PDF-"],
      ] as const) {
        await page.getByRole("button", { name: "Download", exact: true }).click();
        const download = page.waitForEvent("download");
        await page.getByRole("menuitem", { name: label }).click();
        const file = await download;
        expect(file.suggestedFilename()).toMatch(new RegExp(`\\.${ext}$`));
        expect(check(readFileSync(await file.path()))).toBe(true);
      }
    } finally {
      await purgeDocByTitle(title);
    }
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

// ── Edit form metadata (#333) ───────────────────────────────────────────
// Content updates MERGE metadata since schema 0.21.0, so a whole-form editor
// that only sent the keys it kept would silently resurrect removed ones. The
// edit route replaces with the metadata_revision the page loaded; these pin
// both halves: a removed key is gone, and a tag changed elsewhere meanwhile is
// a conflict, not a silent revert.
test.describe("Edit form metadata (#333)", () => {
  async function createDoc(
    request: import("@playwright/test").APIRequestContext,
    title: string,
    metadata: Record<string, string>,
  ): Promise<string> {
    const r = await request.post("/api/v1/ingest", {
      data: { title, content: `# ${title}\n\nbody ${crypto.randomUUID()}`, metadata },
    });
    expect(r.ok()).toBeTruthy();
    return ((await r.json()) as { document_id: string }).document_id;
  }

  async function metadataOf(request: import("@playwright/test").APIRequestContext, id: string) {
    return ((await (await request.get(`/api/v1/documents/${id}`)).json()) as { doc_metadata: Record<string, unknown> })
      .doc_metadata;
  }

  async function removeKey(page: import("@playwright/test").Page, key: string): Promise<void> {
    await page
      .locator(".mantine-Group-root", { has: page.locator(`input[placeholder="Key"][value="${key}"]`) })
      .getByRole("button")
      .click();
    await expect(page.locator(`input[placeholder="Key"][value="${key}"]`)).toHaveCount(0);
  }

  for (const withContent of [false, true]) {
    test(`removing a key removes it (${withContent ? "with a content change" : "metadata only"})`, async ({ page, request }) => {
      const title = uniqueTitle(`Edit Meta ${withContent ? "content" : "only"}`);
      try {
        const id = await createDoc(request, title, { keep: "1", drop: "2" });
        await page.goto(`${APP}/document/${id}/edit`);
        await expect(page.locator('input[placeholder="Key"][value="drop"]')).toBeVisible({ timeout: 15_000 });
        await removeKey(page, "drop");
        if (withContent) {
          const editor = page.locator("textarea").first();
          await editor.fill(`# ${title}\n\nchanged ${crypto.randomUUID()}`);
        }
        await page.getByRole("button", { name: "Save" }).first().click();
        await expect(page.getByText("Document saved")).toBeVisible({ timeout: 30_000 });
        expect(await metadataOf(request, id)).toEqual({ keep: "1" });
      } finally {
        await purgeDocByTitle(title);
      }
    });
  }

  test("a tag changed elsewhere while editing is a conflict, not a silent revert", async ({ page, request }) => {
    const title = uniqueTitle("Edit Meta conflict");
    try {
      const id = await createDoc(request, title, { status: "draft" });
      await page.goto(`${APP}/document/${id}/edit`);
      await expect(page.locator('input[placeholder="Key"][value="status"]')).toBeVisible({ timeout: 15_000 });
      // Another writer adds a tag after the page loaded.
      const client = createClient(loadSettings());
      await client.raw.rpc("cerefox_set_document_metadata", {
        p_document_id: id,
        p_metadata: { owner: "other" },
        p_author: "e2e-ui",
        p_author_type: "user",
      });
      await page.locator('input[placeholder="Value"]').first().fill("final");
      await page.getByRole("button", { name: "Save" }).first().click();
      await expect(page.getByText("Metadata changed", { exact: true })).toBeVisible({ timeout: 30_000 });
      expect(await metadataOf(request, id)).toEqual({ status: "draft", owner: "other" });
    } finally {
      await purgeDocByTitle(title);
    }
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

  test("finds a document by a metadata key and value", async ({ page, request }) => {
    // Seeds its own document: the Key picker offers only keys the store holds,
    // so a test that assumed one (it used "author") failed on a fresh store.
    const title = uniqueTitle("Metadata Search");
    const value = `e2e-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const r = await request.post("/api/v1/ingest", {
        data: { title, content: `# ${title}\n\nbody`, metadata: { e2e_probe: value } },
      });
      expect(r.ok()).toBeTruthy();

      await page.goto(`${APP}/metadata-search`);
      const keyInput = page.locator('input[placeholder="Key"]').first();
      await keyInput.click();
      await keyInput.fill("e2e_probe");
      await page.getByRole("option", { name: "e2e_probe" }).first().click();
      await page.locator('input[placeholder="Value"]').first().fill(value);
      await page.getByTestId("metadata-search-submit").click();

      await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });
    } finally {
      await purgeDocByTitle(title);
    }
  });
});

// ── Analytics ─────────────────────────────────────────────────────────────
test.describe("Analytics", () => {
  test("page loads with controls", async ({ page }) => {
    await page.goto(`${APP}/analytics`);
    await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
    await expect(page.getByText("Period")).toBeVisible();
    await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  });

  test("run analysis renders results", async ({ page }) => {
    await page.goto(`${APP}/analytics`);
    await page.getByRole("button", { name: "Run Analysis" }).click();
    await page.waitForTimeout(5000);
    await expect(
      // A store with no usage shows both the zeroed tiles and the empty notice.
      page.getByText("Total Calls").or(page.getByText("No usage data")).first(),
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
// uninvited) and on a labeled staging server, without needing two harnesses.
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

test.describe("Update notice (#323)", () => {
  // The server only reports `latest` when npm has something newer, so the
  // response is mocked: the build under test is usually the newest release.
  test("a newer release shows in the header, with a readable upgrade command", async ({ page, request }) => {
    const info = await (await request.get("/api/v1/version")).json();
    await page.route("**/api/v1/version*", (route) =>
      route.fulfill({ json: { ...info, latest: "99.0.0", update_command: "cerefox self-update" } }),
    );
    await page.goto(`${APP}/`);

    const badge = page.locator("header").getByTestId("update-badge");
    await expect(badge).toBeVisible({ timeout: 15_000 });
    await expect(badge).toHaveText("v99.0.0 available");
    await expect(badge).toHaveAttribute("href", /\/releases\/tag\/v99\.0\.0$/);

    // The command used to render in its own background color, in both
    // themes: a blank pill. Measure the contrast it is actually drawn with.
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      await page.mouse.move(0, 0);
      await badge.hover();
      const tip = page.getByRole("tooltip");
      await expect(tip).toContainText("Run cerefox self-update to upgrade");
      const ratio = await tip.locator("code").evaluate((el) => {
        // "rgb(a)(0-255 …)", or "color(srgb 0-1 … / a)" for a color-mix().
        const rgba = (c: string) => {
          const n = (c.match(/[\d.]+/g) ?? []).map(Number);
          return c.startsWith("color(") ? n.map((v, i) => (i < 3 ? v * 255 : v)) : n;
        };
        const [r, g, b, a = 1] = rgba(getComputedStyle(el).backgroundColor);
        const under = rgba(getComputedStyle(el.closest("[role=tooltip]")!).backgroundColor);
        const bg = [r, g, b].map((v, i) => v * a + under[i] * (1 - a));
        const lum = (c: number[]) => {
          const [R, G, B] = c.map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * R + 0.7152 * G + 0.0722 * B;
        };
        const [l1, l2] = [lum(rgba(getComputedStyle(el).color).slice(0, 3)), lum(bg)].sort((x, y) => y - x);
        return (l1 + 0.05) / (l2 + 0.05);
      });
      expect(ratio, `${colorScheme} contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("no badge when the server reports nothing newer", async ({ page, request }) => {
    const info = await (await request.get("/api/v1/version")).json();
    await page.route("**/api/v1/version*", (route) =>
      route.fulfill({ json: { ...info, latest: null, update_command: null } }),
    );
    await page.goto(`${APP}/`);
    await expect(page.getByText("Cerefox v", { exact: false })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("update-badge")).toHaveCount(0);
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

  test("turning on trash auto-purge states what the next delete would purge (#251)", async ({ page, request }) => {
    const cfg = async () =>
      ((await (await request.get("/api/v1/config")).json()).keys as Array<{ key: string; effective: string }>).find(
        (k) => k.key === "trash_auto_purge_enabled",
      )?.effective;
    const before = await cfg();
    test.skip(before === "true", "auto-purge is already on for this target; nothing to confirm");

    await page.goto(`${APP}/settings`);
    await page.getByTestId("config-row-trash_auto_purge_enabled").locator(".mantine-Switch-track").click();

    // The irreversible part, in numbers, before anything is written.
    const modal = page.getByTestId("config-confirm-body");
    await expect(modal).toBeVisible();
    const preview = modal.getByTestId("trash-purge-preview");
    await expect(preview).toContainText(/day\(s\)/, { timeout: 10_000 });
    await expect(preview).not.toContainText("Counting");

    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();
    expect(await cfg()).toBe(before);
  });

  test("rejects an out-of-range value", async ({ request }) => {
    const resp = await request.put("/api/v1/config/min_search_score", {
      data: { value: "5" },
    });
    expect(resp.status()).toBe(400);
    expect(await resp.text()).toContain("min_search_score");
  });
});

// ── Trash: Empty trash (v1.14.0, #247) ─────────────────────────────────────
test.describe("Trash", () => {
  // The first test empties the WHOLE trash of the target store. Three guards,
  // all of which must pass: the production guard at the top of this file; an
  // explicit opt-in, CEREFOX_E2E_EMPTY_TRASH=1, so a routine run never does it
  // by accident; and a check that the trash holds nothing but [E2E fixtures,
  // so a hand-trashed reproduction on staging is never destroyed. Fixtures are
  // purged in `finally` either way.
  test("Empty trash asks first, purges one by one, and leaves the trash empty", async ({ page, request }) => {
    test.skip(
      process.env.CEREFOX_E2E_EMPTY_TRASH !== "1",
      "empties the target's trash; run with CEREFOX_E2E_EMPTY_TRASH=1 to include it",
    );
    const before = (await (await request.get("/api/v1/documents/trash?limit=500")).json()) as Array<{ title: string }>;
    const foreign = before.filter((d) => !d.title.startsWith("[E2E"));
    test.skip(foreign.length > 0, `trash holds ${foreign.length} non-fixture document(s); not emptying it`);

    const ids: string[] = [];
    try {
    for (let i = 0; i < 3; i++) {
      const title = uniqueTitle(`Empty Trash ${i}`);
      const r = await request.post("/api/v1/ingest", {
        data: {
          title,
          content: `# Trash fixture ${i}\n\nPurged by the Empty-trash e2e.`,
          author: "e2e-ui",
          author_type: "user",
        },
      });
      expect(r.ok()).toBeTruthy();
      const { document_id } = (await r.json()) as { document_id: string };
      ids.push(document_id);
      const del = await request.delete(`/api/v1/documents/${document_id}`);
      expect(del.ok()).toBeTruthy();
    }

    await page.goto(`${APP}/trash`);
    await expect(page.getByTestId("page-title")).toHaveText(/Trash/i);
    const button = page.getByTestId("empty-trash-button");
    await expect(button).toBeEnabled();
    await button.click();

    // Confirmation first: nothing is purged until the red button is clicked.
    const start = page.getByTestId("empty-trash-start");
    await expect(start).toBeVisible();
    // The exact number (#249) — derived, not hardcoded. The guard above only
    // skips on FOREIGN documents, so anything `[E2E`-prefixed already in the
    // trash (a fixture from an earlier run, or from probing a release against
    // staging) passed it and then broke a hardcoded `3`, turning this red for
    // a reason that has nothing to do with the code under test. Deriving the
    // total still asserts what #249 is about — that the modal states the exact
    // number it is about to purge — and now it asserts it for a trash whose
    // contents the test does not control.
    const expected = before.length + 3;
    await expect(page.getByTestId("empty-trash-confirm")).toContainText(
      `Permanently delete ${expected} document${expected === 1 ? "" : "s"}`,
    );
    // Same page size as the `before` fetch, or the two disagree on a trash
    // larger than one default page and the comparison is meaningless.
    expect(
      ((await (await request.get("/api/v1/documents/trash?limit=500")).json()) as unknown[]).length,
    ).toBe(expected);

    await start.click();
    const done = page.getByTestId("empty-trash-done");
    await expect(done).toBeVisible({ timeout: 60_000 });
    await expect(done).toContainText(/Purged \d+ documents?/);
    await expect(done).not.toContainText(/could not be purged/);
    await page.getByTestId("empty-trash-close").click();

    await expect(page.getByText("Trash is empty.")).toBeVisible();
    await expect(button).toBeDisabled();
    for (const id of ids) {
      expect((await request.get(`/api/v1/documents/${id}`)).status()).toBe(404);
    }
    expect((await (await request.get("/api/v1/documents/trash")).json()) as unknown[]).toEqual([]);
    } finally {
      // On an assertion failure the fixtures are still in the trash.
      for (const id of ids) await request.delete(`/api/v1/documents/${id}/purge`);
    }
  });

  test("Cancel in the confirmation purges nothing", async ({ page, request }) => {
    const title = uniqueTitle("Empty Trash Cancel");
    const r = await request.post("/api/v1/ingest", {
      data: { title, content: "# Kept\n\nCancel must leave this in the trash.", author: "e2e-ui", author_type: "user" },
    });
    const { document_id } = (await r.json()) as { document_id: string };
    expect((await request.delete(`/api/v1/documents/${document_id}`)).ok()).toBeTruthy();

    await page.goto(`${APP}/trash`);
    await page.getByTestId("empty-trash-button").click();
    await expect(page.getByTestId("empty-trash-start")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByTestId("empty-trash-modal")).toBeHidden();

    const trash = (await (await request.get("/api/v1/documents/trash")).json()) as Array<{ id: string }>;
    expect(trash.some((d) => d.id === document_id)).toBe(true);

    expect((await request.delete(`/api/v1/documents/${document_id}/purge`)).ok()).toBeTruthy();
  });
});

// ── Browser tab titles (v1.14.2, #253) ─────────────────────────────────────
test.describe("Tab titles", () => {
  test("each page names itself in the tab, and a document names the document", async ({ page, request }) => {
    // Static pages: the page's own name, no "Cerefox:" prefix (tabs truncate
    // from the right, so a shared prefix would make every tab look alike).
    for (const [path, expected] of [
      ["/trash", "Trash"],
      ["/projects", "Projects"],
      ["/settings", "Settings"],
      ["/audit-log", "Audit log"],
    ] as const) {
      await page.goto(`${APP}${path}`);
      await expect(page).toHaveTitle(expected);
    }

    // The dashboard is the app name alone.
    await page.goto(APP);
    await expect(page).toHaveTitle("Cerefox");

    // A search names the query.
    await page.goto(`${APP}/search?q=oauth+design`);
    await expect(page).toHaveTitle("Search: oauth design");

    // A document names the document, once loaded.
    const title = uniqueTitle("Tab Title");
    const r = await request.post("/api/v1/ingest", {
      data: { title, content: "# Tab title\n\nNames the browser tab.", author: "e2e-ui", author_type: "user" },
    });
    expect(r.ok()).toBeTruthy();
    const { document_id } = (await r.json()) as { document_id: string };
    try {
      await page.goto(`${APP}/document/${document_id}`);
      await expect(page).toHaveTitle(new RegExp(`${title.replace(/[[\]()]/g, "\\$&")}$`));
    } finally {
      await request.delete(`/api/v1/documents/${document_id}`);
      await request.delete(`/api/v1/documents/${document_id}/purge`);
    }
  });

});
