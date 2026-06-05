/**
 * loadPipelineSettings() applies the .env chunking/version overrides (restored
 * after the Python→TS migration) over the built-in defaults.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import {
  DEFAULT_PIPELINE_SETTINGS,
  loadPipelineSettings,
} from "../src/ingestion/types.ts";

const TOUCHED = [
  "CEREFOX_MAX_CHUNK_CHARS",
  "CEREFOX_MIN_CHUNK_CHARS",
  "CEREFOX_VERSION_RETENTION_HOURS",
  "CEREFOX_VERSION_CLEANUP_ENABLED",
];
function clear() {
  for (const k of TOUCHED) delete process.env[k];
}
beforeEach(clear);
afterEach(clear);

describe("loadPipelineSettings", () => {
  it("returns the defaults when nothing is set", () => {
    expect(loadPipelineSettings()).toEqual(DEFAULT_PIPELINE_SETTINGS);
  });

  it("applies valid env overrides", () => {
    process.env.CEREFOX_MAX_CHUNK_CHARS = "2500";
    process.env.CEREFOX_VERSION_RETENTION_HOURS = "72";
    process.env.CEREFOX_VERSION_CLEANUP_ENABLED = "false";
    const s = loadPipelineSettings();
    expect(s.maxChunkChars).toBe(2500);
    expect(s.versionRetentionHours).toBe(72);
    expect(s.versionCleanupEnabled).toBe(false);
    expect(s.minChunkChars).toBe(DEFAULT_PIPELINE_SETTINGS.minChunkChars);
  });

  it("ignores invalid numeric values, keeping defaults", () => {
    process.env.CEREFOX_MAX_CHUNK_CHARS = "0";
    process.env.CEREFOX_VERSION_RETENTION_HOURS = "nope";
    const s = loadPipelineSettings();
    expect(s.maxChunkChars).toBe(DEFAULT_PIPELINE_SETTINGS.maxChunkChars);
    expect(s.versionRetentionHours).toBe(DEFAULT_PIPELINE_SETTINGS.versionRetentionHours);
  });

  it("accepts 0 for retention hours (valid) but not for chunk size", () => {
    process.env.CEREFOX_VERSION_RETENTION_HOURS = "0";
    process.env.CEREFOX_MIN_CHUNK_CHARS = "0";
    const s = loadPipelineSettings();
    expect(s.versionRetentionHours).toBe(0);
    expect(s.minChunkChars).toBe(0);
  });
});
