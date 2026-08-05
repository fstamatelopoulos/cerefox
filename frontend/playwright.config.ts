import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Cerefox web UI e2e tests (iter-26 Part 26I).
 *
 * Targets the in-process `cerefox web` server at http://127.0.0.1:8000.
 * `webServer` auto-starts the built bin (and waits for /app/) when no
 * server is already running; `reuseExistingServer` lets a foreground or
 * daemon `cerefox web` you started yourself be reused.
 *
 * Prereqs: `cd frontend && bun run build` (so the SPA exists) and
 * `bunx playwright install chromium` (one-time). Requires CEREFOX_*
 * credentials in ~/.cerefox/.env (the server reads them at boot).
 */
// Port override (CEREFOX_E2E_PORT): the default 8000 collides with a
// developer's own `cerefox web` daemon, and `reuseExistingServer` would then
// silently test THAT server instead of the build under test — a false pass
// (hit while validating the Mantine 9 upgrade). Passing an explicit port also
// forces Playwright to start its own server, so the run always exercises
// packages/memory/dist.
const E2E_PORT = process.env.CEREFOX_E2E_PORT ?? "8000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node ../packages/memory/dist/bin/cerefox.js web --port ${E2E_PORT}`,
    url: `http://127.0.0.1:${E2E_PORT}/api/v1/version`,
    reuseExistingServer: !process.env.CEREFOX_E2E_PORT,
    timeout: 30_000,
  },
});
