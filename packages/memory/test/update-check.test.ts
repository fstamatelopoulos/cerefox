/**
 * The "newer release available" check (#323): cache, refresh policy, opt-out,
 * and the once-a-day CLI notice. No network: every fetch is a stub, and every
 * cache lives in a temp dir.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CACHE_TTL_MS,
  LATEST_URL,
  NOTIFY_INTERVAL_MS,
  fetchLatestVersion,
  newerRelease,
  readCache,
  recordLatest,
  refreshLatest,
  takeCliNotice,
  updateCheckDisabled,
} from "../src/update-check.ts";

let dir: string;
let path: string;
const NOW = new Date("2026-10-06T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const ON = {} as NodeJS.ProcessEnv; // an environment with nothing opting out

function stubFetch(version: string | null, status = 200) {
  const calls: string[] = [];
  const impl = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(JSON.stringify(version === null ? {} : { version }), { status });
  }) as typeof fetch;
  return { impl, calls };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cfx-update-check-"));
  path = join(dir, "update-check.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("opt-out", () => {
  test("off by our variable, the common convention, or CI", () => {
    expect(updateCheckDisabled({})).toBe(false);
    expect(updateCheckDisabled({ CEREFOX_NO_UPDATE_CHECK: "1" })).toBe(true);
    expect(updateCheckDisabled({ NO_UPDATE_NOTIFIER: "true" })).toBe(true);
    expect(updateCheckDisabled({ CI: "true" })).toBe(true);
  });

  test("explicit false-y values do not opt out", () => {
    expect(updateCheckDisabled({ CEREFOX_NO_UPDATE_CHECK: "0" })).toBe(false);
    expect(updateCheckDisabled({ CI: "false" })).toBe(false);
    expect(updateCheckDisabled({ NO_UPDATE_NOTIFIER: " " })).toBe(false);
  });

  test("an opted-out refresh never touches the network", async () => {
    const f = stubFetch("9.9.9");
    expect(await refreshLatest({ path, now: NOW, fetchImpl: f.impl, env: { CI: "1" } })).toBeNull();
    expect(f.calls).toHaveLength(0);
  });
});

describe("newerRelease", () => {
  test("only strictly newer counts", () => {
    expect(newerRelease("1.18.0", "1.17.4")).toBe("1.18.0");
    expect(newerRelease("1.17.4", "1.17.4")).toBeNull();
    expect(newerRelease("1.17.3", "1.17.4")).toBeNull();
    expect(newerRelease(null, "1.17.4")).toBeNull();
  });

  test("a prerelease ahead of latest is not told to go back", () => {
    expect(newerRelease("1.17.4", "1.18.0-beta.1")).toBeNull();
    expect(newerRelease("1.18.0", "1.18.0-beta.1")).toBe("1.18.0");
  });
});

describe("fetchLatestVersion", () => {
  test("asks the registry's latest dist-tag", async () => {
    const f = stubFetch("1.18.0");
    expect(await fetchLatestVersion({ fetchImpl: f.impl })).toBe("1.18.0");
    expect(f.calls).toEqual([LATEST_URL]);
  });

  test("throws on an error status or a body with no version", async () => {
    await expect(fetchLatestVersion({ fetchImpl: stubFetch("1.18.0", 503).impl })).rejects.toThrow("503");
    await expect(fetchLatestVersion({ fetchImpl: stubFetch(null).impl })).rejects.toThrow("no version");
  });
});

describe("refreshLatest", () => {
  test("fetches and records when there is no cache", async () => {
    const f = stubFetch("1.18.0");
    expect(await refreshLatest({ path, now: NOW, fetchImpl: f.impl, env: ON })).toBe("1.18.0");
    expect(f.calls).toHaveLength(1);
    expect(readCache(path)).toEqual({ latest: "1.18.0", checkedAt: NOW.toISOString() });
  });

  test("a fresh cache answers without the network", async () => {
    writeFileSync(path, JSON.stringify({ latest: "1.18.0", checkedAt: ago(CACHE_TTL_MS - 60_000) }));
    const f = stubFetch("1.19.0");
    expect(await refreshLatest({ path, now: NOW, fetchImpl: f.impl, env: ON })).toBe("1.18.0");
    expect(f.calls).toHaveLength(0);
  });

  test("a stale cache, or force, refetches", async () => {
    writeFileSync(path, JSON.stringify({ latest: "1.18.0", checkedAt: ago(CACHE_TTL_MS + 60_000) }));
    const stale = stubFetch("1.19.0");
    expect(await refreshLatest({ path, now: NOW, fetchImpl: stale.impl, env: ON })).toBe("1.19.0");
    const forced = stubFetch("1.20.0");
    expect(await refreshLatest({ path, now: NOW, fetchImpl: forced.impl, env: ON, force: true })).toBe("1.20.0");
  });

  test("a failed fetch falls back to the cache and never throws", async () => {
    writeFileSync(path, JSON.stringify({ latest: "1.18.0", checkedAt: ago(CACHE_TTL_MS * 3) }));
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await refreshLatest({ path, now: NOW, fetchImpl: failing, env: ON })).toBe("1.18.0");
    rmSync(path);
    expect(await refreshLatest({ path, now: NOW, fetchImpl: failing, env: ON })).toBeNull();
  });

  test("a corrupt cache is treated as no cache", async () => {
    writeFileSync(path, "{not json");
    expect(readCache(path)).toBeNull();
    expect(await refreshLatest({ path, now: NOW, fetchImpl: stubFetch("1.18.0").impl, env: ON })).toBe("1.18.0");
  });
});

describe("takeCliNotice", () => {
  test("silent with no cache, or when up to date", () => {
    expect(takeCliNotice({ path, now: NOW, installed: "1.17.4", env: ON })).toBeNull();
    recordLatest("1.17.4", path, NOW);
    expect(takeCliNotice({ path, now: NOW, installed: "1.17.4", env: ON })).toBeNull();
  });

  test("names the release and the command, then stays quiet for a day", () => {
    recordLatest("1.18.0", path, NOW);
    const line = takeCliNotice({ path, now: NOW, installed: "1.17.4", env: ON });
    expect(line).toContain("Cerefox 1.18.0 is available (you have 1.17.4)");
    expect(line).toContain("cerefox self-update");
    expect(JSON.parse(readFileSync(path, "utf8")).notifiedAt).toBe(NOW.toISOString());

    const soon = new Date(NOW.getTime() + NOTIFY_INTERVAL_MS - 60_000);
    expect(takeCliNotice({ path, now: soon, installed: "1.17.4", env: ON })).toBeNull();
    const later = new Date(NOW.getTime() + NOTIFY_INTERVAL_MS + 60_000);
    expect(takeCliNotice({ path, now: later, installed: "1.17.4", env: ON })).not.toBeNull();
  });

  test("a refresh keeps the once-a-day mark", () => {
    recordLatest("1.18.0", path, NOW);
    takeCliNotice({ path, now: NOW, installed: "1.17.4", env: ON });
    recordLatest("1.18.0", path, new Date(NOW.getTime() + 1000));
    expect(takeCliNotice({ path, now: new Date(NOW.getTime() + 2000), installed: "1.17.4", env: ON })).toBeNull();
  });

  test("opted out: no notice even when one is due", () => {
    recordLatest("1.18.0", path, NOW);
    expect(takeCliNotice({ path, now: NOW, installed: "1.17.4", env: { CEREFOX_NO_UPDATE_CHECK: "1" } })).toBeNull();
  });
});
