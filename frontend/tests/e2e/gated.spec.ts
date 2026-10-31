/**
 * The web UI against a server with the API key gate on everywhere (#346).
 *
 * Runs in the `gated` Playwright project, against the second server in
 * `playwright.config.ts` (`CEREFOX_API_REQUIRE_KEY=1`, a fresh key per run). The
 * loopback exemption is off there, so the browser is refused exactly as it is
 * by a container on a LAN host. Design: `docs/specs/lan-web-access.md`.
 *
 * Writes one [E2E-GATED] document and hard-deletes it; refuses an unlabeled
 * (production) target like `ui.spec.ts`.
 */

import { expect, test, type Page } from "@playwright/test";

import { loadEnv, loadSettings } from "../../../_shared/config/index.ts";
import { createClient } from "../../../_shared/db-client/index.ts";

const APP = "/app";
const KEY = process.env.CEREFOX_E2E_GATED_KEY ?? "";
const PROMPT = "This server needs its API key";

function mayWriteToLiveTarget(): boolean {
  if (process.env.CEREFOX_ALLOW_PROD_WRITE_TESTS === "1") return true;
  if ((process.env.CEREFOX_ENV_LABEL ?? "").trim()) return true;
  try {
    loadEnv();
    return Boolean((process.env.CEREFOX_ENV_LABEL ?? "").trim());
  } catch {
    return false;
  }
}

test.beforeAll(() => {
  if (!mayWriteToLiveTarget()) {
    throw new Error(
      "Refusing to run the gated UI e2e against an unlabeled (production) target. " +
        "Use CEREFOX_CONFIG_DIR=~/.cerefox/staging bun run test:e2e.",
    );
  }
  if (!KEY) throw new Error("CEREFOX_E2E_GATED_KEY is not set (playwright.config.ts sets it).");
});

async function purgeDocByTitle(title: string): Promise<void> {
  try {
    const client = createClient(loadSettings());
    await client.raw.from("cerefox_documents").delete().eq("title", title);
  } catch {
    /* best-effort */
  }
}

async function enterKey(page: Page, key: string, remember = false): Promise<void> {
  const dialog = page.getByRole("dialog", { name: PROMPT });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "API key" }).fill(key);
  if (remember) await dialog.getByLabel("Remember on this browser").check();
  await dialog.getByRole("button", { name: "Continue" }).click();
}

test.describe("Gated server", () => {
  test("the API refuses a keyless call and accepts the key", async ({ request }) => {
    expect((await request.get("/api/v1/version")).status()).toBe(401);
    const ok = await request.get("/api/v1/projects", {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    expect(ok.status()).toBe(200);
  });

  test("the SPA still loads without a key, so the prompt can show", async ({ request }) => {
    const shell = await request.get(`${APP}/`);
    expect(shell.status()).toBe(200);
    const asset = /\/app\/assets\/[^"]+\.js/.exec(await shell.text())?.[0];
    expect(asset).toBeTruthy();
    expect((await request.get(asset!)).status()).toBe(200);
  });

  test("a wrong key is refused in the dialog; the right one opens the app", async ({ page }) => {
    await page.goto(APP);
    await enterKey(page, "cfx_lak_wrong");
    await expect(page.getByText("That key was not accepted.")).toBeVisible();
    await expect(page.getByRole("dialog", { name: PROMPT })).toBeVisible();

    await page.getByRole("textbox", { name: "API key" }).fill(KEY);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("dialog", { name: PROMPT })).toBeHidden();
    await expect(page.getByTestId("page-title")).toBeVisible();
    await expect(page.getByText("Documents", { exact: true }).first()).toBeVisible();
  });

  test("no request storm while the prompt waits", async ({ page }) => {
    const refused: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/v1/") && r.status() === 401) refused.push(r.url());
    });
    await page.goto(APP);
    await expect(page.getByRole("dialog", { name: PROMPT })).toBeVisible();
    await page.waitForTimeout(1500);
    const settled = refused.length;
    // Focus changes and polling would refetch; none of it may reach the server.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.waitForTimeout(3000);
    expect(refused.length).toBe(settled);
    expect(settled).toBeLessThan(15);
  });

  test("search, document view, download and upload work with the key", async ({ page }) => {
    const title = `[E2E-GATED] Upload ${crypto.randomUUID().slice(0, 8)}`;
    const marker = `gated-${crypto.randomUUID()}`;
    try {
      await page.goto(`${APP}/ingest`);
      await enterKey(page, KEY);
      await page.getByRole("button", { name: "Upload file" }).click();
      await page.fill('input[placeholder="Document title"]', title);
      await page.setInputFiles('input[type="file"]', {
        name: `e2e-gated-${crypto.randomUUID().slice(0, 8)}.md`,
        mimeType: "text/markdown",
        buffer: Buffer.from(`# Gated\n\n${marker}\n`),
      });
      await page.click('button[type="submit"]:has-text("Upload & ingest")');
      await expect(page.getByText("ingested successfully")).toBeVisible({ timeout: 30_000 });

      await page.goto(`${APP}/search?q=${encodeURIComponent(marker)}`);
      await page.getByText(title).first().click();
      await expect(page.getByRole("button", { name: "Download" })).toBeVisible();

      await page.getByRole("button", { name: "Download" }).click();
      const download = page.waitForEvent("download");
      await page.getByRole("menuitem", { name: "Markdown (.md)" }).click();
      const file = await download;
      const path = await file.path();
      const { readFileSync } = await import("node:fs");
      expect(readFileSync(path, "utf8")).toContain(marker);
    } finally {
      await purgeDocByTitle(title);
    }
  });

  test("session key survives a reload; a remembered one survives a new tab", async ({ page, context }) => {
    await page.goto(APP);
    await enterKey(page, KEY);
    await expect(page.getByRole("dialog", { name: PROMPT })).toBeHidden();
    await page.reload();
    await expect(page.getByTestId("page-title")).toBeVisible();
    await expect(page.getByRole("dialog", { name: PROMPT })).toBeHidden();

    // sessionStorage is per tab: a new tab asks again.
    const other = await context.newPage();
    await other.goto(APP);
    await enterKey(other, KEY, true);
    await expect(other.getByRole("dialog", { name: PROMPT })).toBeHidden();
    const third = await context.newPage();
    await third.goto(APP);
    await expect(third.getByTestId("page-title")).toBeVisible();
    await expect(third.getByRole("dialog", { name: PROMPT })).toBeHidden();
  });

  test("a saved key the server no longer accepts brings the prompt back", async ({ page }) => {
    await page.goto(APP);
    await page.evaluate(() => localStorage.setItem("cerefox.apiKey", "cfx_lak_rotated_away"));
    await page.reload();
    await expect(page.getByText("The saved key was not accepted")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("cerefox.apiKey"))).toBeNull();
    await page.getByRole("textbox", { name: "API key" }).fill(KEY);
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("dialog", { name: PROMPT })).toBeHidden();
  });

  test("forget key clears it and the prompt returns", async ({ page }) => {
    await page.goto(APP);
    await enterKey(page, KEY, true);
    await expect(page.getByRole("dialog", { name: PROMPT })).toBeHidden();
    await page.getByRole("button", { name: "Forget API key" }).click();
    await expect(page.getByRole("dialog", { name: PROMPT })).toBeVisible();
    expect(
      await page.evaluate(() => [localStorage.getItem("cerefox.apiKey"), sessionStorage.getItem("cerefox.apiKey")]),
    ).toEqual([null, null]);
  });
});
