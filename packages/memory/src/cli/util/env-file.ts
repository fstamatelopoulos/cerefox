/**
 * Minimal `.env` upsert — preserve every other line, replace or append one KEY.
 *
 * Used by `cerefox token` to write `CEREFOX_ACCESS_TOKEN` into the canonical
 * `.env` (resolved via `_shared/config` `resolveEnvFile`). Deliberately tiny and
 * dependency-free: it never loads dotenv (no `process.env` side effects) and
 * touches only the one key.
 */

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface UpsertResult {
  path: string;
  action: "created" | "updated" | "added";
  backupPath?: string;
}

/**
 * Upsert `KEY=value`. If the file exists with an uncommented `KEY=` line, replace
 * it in place; otherwise append. All other lines are preserved. Creates the file
 * (mode 0600) if absent. Backs up an existing file first unless `noBackup`.
 */
export function upsertEnvVar(
  path: string,
  key: string,
  value: string,
  opts: { noBackup?: boolean } = {},
): UpsertResult {
  const line = `${key}=${value}`;

  if (!existsSync(path)) {
    writeFileSync(path, `${line}\n`, { mode: 0o600 });
    return { path, action: "created" };
  }

  const original = readFileSync(path, "utf8");
  let backupPath: string | undefined;
  if (!opts.noBackup) {
    backupPath = `${path}.pre-cerefox.bak`;
    copyFileSync(path, backupPath);
  }

  const re = new RegExp(`^(\\s*)${escapeRegExp(key)}=.*$`, "m");
  let next: string;
  let action: "updated" | "added";
  if (re.test(original)) {
    next = original.replace(re, `$1${line}`);
    action = "updated";
  } else {
    next = original.endsWith("\n") ? `${original}${line}\n` : `${original}\n${line}\n`;
    action = "added";
  }
  writeFileSync(path, next);
  return { path, action, backupPath };
}

/** Read one uncommented `KEY=`'s value from a `.env`. `null` if the file or key is absent. */
export function readEnvVar(path: string, key: string): string | null {
  if (!existsSync(path)) return null;
  const m = readFileSync(path, "utf8").match(
    new RegExp(`^\\s*${escapeRegExp(key)}=(.*)$`, "m"),
  );
  return m ? m[1].trim() : null;
}

/**
 * If `path` sits inside a git work tree and is NOT gitignored, return a warning
 * string (the file is about to hold a secret and could be committed). Returns
 * `null` when the file is safe: outside any repo (e.g. `~/.cerefox/.env`), already
 * ignored, or git is unavailable. Best-effort — never throws.
 */
export function envGitignoreWarning(path: string): string | null {
  try {
    const dir = dirname(path);
    const inTree = spawnSync("git", ["-C", dir, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
    });
    if (inTree.status !== 0 || inTree.stdout.trim() !== "true") return null; // not in a repo
    const ignored = spawnSync("git", ["-C", dir, "check-ignore", "-q", path]);
    if (ignored.status === 0) return null; // gitignored — safe
    return (
      `${path} is inside a git repo and is NOT gitignored — add it to .gitignore ` +
      `before committing (it now holds a secret access token).`
    );
  } catch {
    return null;
  }
}
