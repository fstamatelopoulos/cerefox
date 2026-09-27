/**
 * A render-time throw must not blank the app (#289).
 *
 * The bug: three `onChange` handlers read `e.currentTarget.value` inside a
 * functional `setState` updater. React nulls `currentTarget` when the handler
 * returns, the updater runs later in the render phase, so typing one character
 * threw *during render* — and with no error boundary, React unmounted the entire
 * tree. `#root` ended up with zero children: a white page, no message, nothing
 * to click.
 *
 * Two things are asserted here, and they fail for different reasons:
 *
 *   1. Typing in those fields works and the app is still mounted. That is the
 *      regression test for the three handlers.
 *   2. `#root` still has children after typing. That is the regression test for
 *      the *blankness* — the symptom that made a one-line bug look like a dead
 *      web app. It would fail again for any render throw in the same place, not
 *      just this one.
 *
 * `src/lib/no-event-in-updater.test.ts` guards the source-level pattern in CI,
 * which this suite is not part of. This spec is what proves the fix in a real
 * browser against a real server, which no source scan can.
 *
 * READ-ONLY: it types into inputs and never submits, so it creates nothing and
 * needs no write guard. Safe against any target, production included.
 */

import { expect, test } from "@playwright/test";

const APP = "/app";

/** The whole tree unmounted → `#root` is empty. The actual #289 symptom. */
async function appIsMounted(page: import("@playwright/test").Page): Promise<boolean> {
  return (await page.evaluate(() => (document.getElementById("root")?.childElementCount ?? 0) > 0));
}

test.describe("typing in a key/value pair editor does not blank the app (#289)", () => {
  test("Ingest → Metadata → key and value fields", async ({ page }) => {
    const thrown: string[] = [];
    page.on("pageerror", (e) => thrown.push(e.message));

    await page.goto(`${APP}/ingest`);
    await expect(page.getByTestId("page-title")).toBeVisible();

    // The user's exact sequence: paste content first, then add a metadata field.
    await page.locator("textarea").fill("# Render crash regression\n\nBody.\n");
    await page.getByRole("button", { name: /Add field/i }).click();

    const key = page.locator('input[placeholder="key"]').first();
    await key.click();
    await key.pressSequentially("t", { delay: 60 });
    // A single character was enough to crash it, so assert after exactly one.
    expect(thrown, `page threw while typing in the key field: ${thrown.join(" | ")}`).toEqual([]);
    expect(await appIsMounted(page)).toBe(true);
    await expect(key).toHaveValue("t");

    // …and keep typing, because the datalist filtering is what the user was doing.
    await key.pressSequentially("ype", { delay: 40 });
    await expect(key).toHaveValue("type");

    const value = page.locator('input[placeholder="value"]').first();
    await value.click();
    await value.pressSequentially("guide", { delay: 40 });
    await expect(value).toHaveValue("guide");

    expect(thrown, `page threw: ${thrown.join(" | ")}`).toEqual([]);
    expect(await appIsMounted(page)).toBe(true);
  });

  test("Search → Filters → Value field", async ({ page }) => {
    // The same defect on a second screen, which is why the fix is a class guard
    // and not three edits. Nothing in the original report pointed here.
    const thrown: string[] = [];
    page.on("pageerror", (e) => thrown.push(e.message));

    await page.goto(`${APP}/search`);
    await page.getByRole("button", { name: /^Filters/ }).click();
    await page.getByRole("button", { name: /\+ Add filter/ }).click();

    const value = page.locator('input[placeholder="Value"]').first();
    await value.click();
    await value.pressSequentially("decision-log", { delay: 30 });

    expect(thrown, `page threw while typing a filter value: ${thrown.join(" | ")}`).toEqual([]);
    expect(await appIsMounted(page)).toBe(true);
    await expect(value).toHaveValue("decision-log");
  });
});
