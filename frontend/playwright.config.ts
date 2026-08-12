import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Cerefox web UI e2e tests (iter-26 Part 26I).
 *
 * By default Playwright starts its OWN `cerefox web` on port 8123 from
 * `packages/memory/dist`, so a run always tests the build in this repo.
 *
 *   CEREFOX_E2E_PORT=8030   which port to use
 *   CEREFOX_E2E_REUSE=1     test a server already running there, instead of
 *                           starting one (post-deploy smoke test only)
 *
 * Prereqs: `cd frontend && bun run build` (so the SPA exists) and
 * `bunx playwright install chromium` (one-time). Requires CEREFOX_*
 * credentials in ~/.cerefox/.env (the server reads them at boot).
 */
// Two independent decisions, deliberately separated (#155).
//
// WHICH PORT (`CEREFOX_E2E_PORT`) and WHOSE SERVER (`CEREFOX_E2E_REUSE`) used to
// be one setting: the default port was 8000 and `reuseExistingServer` was
// derived from whether a port had been passed. So a developer with a
// `cerefox web` daemon on 8000 — the default — ran the suite against THAT
// server: a different build, against whatever data it was pointed at. The
// assertions then looked for headings the running build did not render, which
// is how #155 came to read as "8 of 13 tests are broken" when the tests were
// fine and the target was wrong.
//
// A machine can easily host several deployments (prod on 8000, staging on 8030,
// a local backend on 8010 — this is the maintainer's actual setup), so the
// default must not be any of them.
//
// The default now starts a server of its own on a port nothing else claims, and
// always exercises packages/memory/dist. Reusing something already running is a
// separate, explicit opt-in, because it changes WHAT IS BEING TESTED from "the
// build in this repo" to "whatever that process happens to be serving" — useful
// as a post-deploy smoke test, wrong as a regression default.
const E2E_PORT = process.env.CEREFOX_E2E_PORT ?? "8123";
const E2E_REUSE = process.env.CEREFOX_E2E_REUSE === "1";

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
    reuseExistingServer: E2E_REUSE,
    timeout: 30_000,
  },
});
