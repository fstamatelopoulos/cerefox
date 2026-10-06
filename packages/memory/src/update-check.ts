/**
 * "A newer Cerefox release is available" (#323).
 *
 * One check, against the npm registry's `latest` dist-tag (the same source
 * `cerefox self-update` installs from), cached in the state dir for a day.
 *
 * Who fetches, and why only them: the long-running processes (`cerefox web`,
 * `cerefox mcp`) and the ones where the user is already waiting on the network
 * (`doctor`, `self-update`). Every other command only READS the cache, so the
 * check never adds latency to a command and never leaves a request in flight
 * when a short-lived process exits. The web server and the MCP server between
 * them run often enough to keep the cache fresh for nearly everyone.
 *
 * Everything here fails silent. Offline, a registry error, an unreadable cache:
 * the answer is "nothing to report", never an error, because an update notice
 * that can break a command is worse than none.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { compareSemver } from "../../../_shared/compatibility/index.ts";
import { PKG_VERSION } from "./meta.ts";
import { isContainerised } from "./web/auth.ts";
import { resolveStateDir } from "./web/daemon.ts";

export const LATEST_URL = "https://registry.npmjs.org/@cerefox%2Fmemory/latest";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a fetched answer is trusted before a long-running process refetches. */
export const CACHE_TTL_MS = DAY_MS;
/** How often the CLI may print the notice. Once a day reads as news; every command reads as nagging. */
export const NOTIFY_INTERVAL_MS = DAY_MS;

export interface UpdateCache {
  latest: string;
  checkedAt: string;
  /** Last time the CLI printed the notice. */
  notifiedAt?: string;
}

/**
 * The user opted out. `CEREFOX_NO_UPDATE_CHECK` is ours; `NO_UPDATE_NOTIFIER`
 * is the convention other CLIs honor; and CI is never the place for it.
 */
export function updateCheckDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const on = (v: string | undefined) => {
    const t = (v ?? "").trim().toLowerCase();
    return t !== "" && t !== "0" && t !== "false";
  };
  return on(env.CEREFOX_NO_UPDATE_CHECK) || on(env.NO_UPDATE_NOTIFIER) || on(env.CI);
}

/**
 * Next to `web.pid`, and for the same reason: an explicit `CEREFOX_CONFIG_DIR`
 * (a parallel install, e.g. staging, which may run another version) gets its
 * own answer, and a repo dev-mode `.env` never puts state in a working tree.
 */
export function cachePath(): string {
  return join(resolveStateDir(), "update-check.json");
}

export function readCache(path = cachePath()): UpdateCache | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<UpdateCache>;
    if (typeof parsed.latest !== "string" || typeof parsed.checkedAt !== "string") return null;
    return parsed as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache, path = cachePath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache, null, 2) + "\n");
  } catch {
    // A read-only home or a full disk only costs the notice.
  }
}

/**
 * The registry's current `latest`. Throws on any failure: `self-update` needs
 * to say why it could not upgrade. Everything else goes through
 * `refreshLatest()`, which swallows.
 */
export async function fetchLatestVersion(
  { timeoutMs = 3000, fetchImpl = fetch }: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const resp = await fetchImpl(LATEST_URL, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`npm registry answered ${resp.status} ${resp.statusText}`);
  const body = (await resp.json()) as { version?: unknown };
  if (typeof body.version !== "string" || body.version === "") {
    throw new Error("npm registry response has no version field");
  }
  return body.version;
}

/** Record a version just learned from the registry (keeps `notifiedAt`). */
export function recordLatest(latest: string, path = cachePath(), now = new Date()): void {
  const prev = readCache(path);
  writeCache({ ...prev, latest, checkedAt: now.toISOString() }, path);
}

/**
 * Fetch `latest` unless the cache is still fresh (or `force`), record it, and
 * return it. Never throws: on failure it returns whatever the cache already
 * held, or null.
 */
export async function refreshLatest(
  opts: { force?: boolean; path?: string; now?: Date; fetchImpl?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<string | null> {
  if (updateCheckDisabled(opts.env)) return null;
  const path = opts.path ?? cachePath();
  const now = opts.now ?? new Date();
  const cached = readCache(path);
  const age = cached ? now.getTime() - Date.parse(cached.checkedAt) : Infinity;
  if (cached && !opts.force && age >= 0 && age < CACHE_TTL_MS) return cached.latest;
  try {
    const latest = await fetchLatestVersion({ fetchImpl: opts.fetchImpl });
    recordLatest(latest, path, now);
    return latest;
  } catch {
    return cached?.latest ?? null;
  }
}

/**
 * Refresh now, then once a day, for as long as the process runs. The timer is
 * unref'd so it never keeps a process alive that would otherwise exit.
 */
export function startPeriodicRefresh(): void {
  if (updateCheckDisabled()) return;
  void refreshLatest();
  const timer = setInterval(() => void refreshLatest(), CACHE_TTL_MS);
  timer.unref?.();
}

/** `latest` when it is strictly newer than what is installed, else null. */
export function newerRelease(latest: string | null | undefined, installed = PKG_VERSION): string | null {
  if (!latest) return null;
  // A prerelease or a local build ahead of `latest` is never told to go back.
  return compareSemver(latest, installed) > 0 ? latest : null;
}

/**
 * What to run to upgrade from where this process is running. Inside the
 * Cerefox Local container `self-update` is the wrong advice: the CLI there is
 * part of the image, and the upgrade happens on the host.
 */
export function upgradeCommand(): string {
  return isContainerised() ? "cerefox-local upgrade" : "cerefox self-update";
}

export const releaseNotesUrl = (version: string) =>
  `https://github.com/fstamatelopoulos/cerefox/releases/tag/v${version}`;

/**
 * The one line the CLI prints, or null when there is nothing to say or it was
 * said less than a day ago. Reads the cache only — no network. Marks the cache
 * when it returns a line, so the caller must actually print it.
 */
export function takeCliNotice(
  opts: { path?: string; now?: Date; installed?: string; env?: NodeJS.ProcessEnv } = {},
): string | null {
  if (updateCheckDisabled(opts.env)) return null;
  const path = opts.path ?? cachePath();
  const now = opts.now ?? new Date();
  const cached = readCache(path);
  const newer = newerRelease(cached?.latest, opts.installed);
  if (!cached || !newer) return null;
  if (cached.notifiedAt) {
    const since = now.getTime() - Date.parse(cached.notifiedAt);
    if (since >= 0 && since < NOTIFY_INTERVAL_MS) return null;
  }
  writeCache({ ...cached, notifiedAt: now.toISOString() }, path);
  return `Cerefox ${newer} is available (you have ${opts.installed ?? PKG_VERSION}). Run \`${upgradeCommand()}\`.`;
}
