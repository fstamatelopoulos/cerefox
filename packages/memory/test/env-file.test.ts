/**
 * Unit tests for the `.env` upsert utility used by `cerefox token` — preserve
 * every other line, change only the one key, back up first.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readEnvVar, upsertEnvVar } from "../src/cli/util/env-file.ts";

let dir: string;
let envPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cerefox-envfile-"));
  envPath = join(dir, ".env");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("upsertEnvVar", () => {
  test("creates the file (mode 0600) when absent", () => {
    const r = upsertEnvVar(envPath, "CEREFOX_ACCESS_TOKEN", "cfx_pat_abc");
    expect(r.action).toBe("created");
    expect(readFileSync(envPath, "utf8")).toBe("CEREFOX_ACCESS_TOKEN=cfx_pat_abc\n");
    expect(r.backupPath).toBeUndefined();
  });

  test("appends when the key is absent, preserving other lines", () => {
    writeFileSync(envPath, "CEREFOX_SUPABASE_URL=https://x.supabase.co\nOPENAI_API_KEY=sk-1\n");
    const r = upsertEnvVar(envPath, "CEREFOX_ACCESS_TOKEN", "cfx_pat_new");
    expect(r.action).toBe("added");
    const body = readFileSync(envPath, "utf8");
    expect(body).toContain("CEREFOX_SUPABASE_URL=https://x.supabase.co");
    expect(body).toContain("OPENAI_API_KEY=sk-1");
    expect(body).toContain("CEREFOX_ACCESS_TOKEN=cfx_pat_new");
  });

  test("replaces an existing key in place, leaving neighbours untouched", () => {
    writeFileSync(
      envPath,
      "A=1\nCEREFOX_ACCESS_TOKEN=cfx_pat_old\nB=2\n",
    );
    const r = upsertEnvVar(envPath, "CEREFOX_ACCESS_TOKEN", "cfx_pat_rotated");
    expect(r.action).toBe("updated");
    expect(readFileSync(envPath, "utf8")).toBe("A=1\nCEREFOX_ACCESS_TOKEN=cfx_pat_rotated\nB=2\n");
  });

  test("backs up the existing file by default; honours noBackup", () => {
    writeFileSync(envPath, "A=1\n");
    const r1 = upsertEnvVar(envPath, "K", "v");
    expect(r1.backupPath).toBe(`${envPath}.pre-cerefox.bak`);
    expect(existsSync(r1.backupPath!)).toBe(true);
    expect(readFileSync(r1.backupPath!, "utf8")).toBe("A=1\n");

    const r2 = upsertEnvVar(envPath, "K2", "v2", { noBackup: true });
    expect(r2.backupPath).toBeUndefined();
  });

  test("does not match a commented-out key (appends a live one)", () => {
    writeFileSync(envPath, "# CEREFOX_ACCESS_TOKEN=old-commented\n");
    upsertEnvVar(envPath, "CEREFOX_ACCESS_TOKEN", "cfx_pat_live", { noBackup: true });
    const body = readFileSync(envPath, "utf8");
    expect(body).toContain("# CEREFOX_ACCESS_TOKEN=old-commented");
    expect(body).toContain("CEREFOX_ACCESS_TOKEN=cfx_pat_live");
  });

  test("appends a trailing newline when the file lacks one", () => {
    writeFileSync(envPath, "A=1"); // no trailing \n
    upsertEnvVar(envPath, "K", "v", { noBackup: true });
    expect(readFileSync(envPath, "utf8")).toBe("A=1\n\nK=v\n");
  });

  test("a comment becomes a blank-line-separated section header on append", () => {
    writeFileSync(envPath, "# Logging\nCEREFOX_LOG_LEVEL=info\n");
    upsertEnvVar(envPath, "CEREFOX_ACCESS_TOKEN", "cfx_pat_x", {
      noBackup: true,
      comment: "── Cerefox access token ──",
    });
    expect(readFileSync(envPath, "utf8")).toBe(
      "# Logging\nCEREFOX_LOG_LEVEL=info\n\n# ── Cerefox access token ──\nCEREFOX_ACCESS_TOKEN=cfx_pat_x\n",
    );
  });

  test("a comment prefixes a freshly created file", () => {
    upsertEnvVar(envPath, "CEREFOX_ACCESS_TOKEN", "cfx_pat_x", { comment: "hdr" });
    expect(readFileSync(envPath, "utf8")).toBe("# hdr\nCEREFOX_ACCESS_TOKEN=cfx_pat_x\n");
  });

  test("update-in-place ignores the comment (rotate doesn't re-add a header)", () => {
    writeFileSync(envPath, "# ── Cerefox access token ──\nCEREFOX_ACCESS_TOKEN=cfx_pat_old\n");
    upsertEnvVar(envPath, "CEREFOX_ACCESS_TOKEN", "cfx_pat_new", {
      noBackup: true,
      comment: "── Cerefox access token ──",
    });
    // value replaced in place; no duplicate header, no extra blank line
    expect(readFileSync(envPath, "utf8")).toBe(
      "# ── Cerefox access token ──\nCEREFOX_ACCESS_TOKEN=cfx_pat_new\n",
    );
  });
});

describe("readEnvVar", () => {
  test("reads an uncommented value; null for missing key/file", () => {
    writeFileSync(envPath, "CEREFOX_ACCESS_TOKEN=cfx_pat_xyz\n# OTHER=nope\n");
    expect(readEnvVar(envPath, "CEREFOX_ACCESS_TOKEN")).toBe("cfx_pat_xyz");
    expect(readEnvVar(envPath, "OTHER")).toBeNull();
    expect(readEnvVar(join(dir, "nope.env"), "X")).toBeNull();
  });

  test("round-trips with upsert (rotate reads back the value it wrote)", () => {
    upsertEnvVar(envPath, "CEREFOX_ACCESS_TOKEN", "cfx_pat_1", { noBackup: true });
    expect(readEnvVar(envPath, "CEREFOX_ACCESS_TOKEN")).toBe("cfx_pat_1");
    upsertEnvVar(envPath, "CEREFOX_ACCESS_TOKEN", "cfx_pat_2", { noBackup: true });
    expect(readEnvVar(envPath, "CEREFOX_ACCESS_TOKEN")).toBe("cfx_pat_2");
  });
});
