/**
 * Tests for `_shared/db-status/`. Mocks the CerefoxDbClient surface so we
 * don't hit a real Supabase from `bun test`.
 */

import { describe, expect, test, mock } from "bun:test";
import type { CerefoxDbClient } from "../db-client/index.ts";
import {
  EXPECTED_FUNCTIONS,
  EXPECTED_TABLES,
  runDbStatusChecks,
  type ProgressEvent,
} from "../db-status/index.ts";

function makeFakeClient(overrides: Partial<CerefoxDbClient> = {}): CerefoxDbClient {
  return {
    raw: {} as never,
    listProjects: mock(async () => []),
    rpc: mock(async () => "0.3.0"),
    tableExists: mock(async () => true),
    functionExists: mock(async () => true),
    rowCount: mock(async () => 0),
    ...overrides,
  };
}

describe("runDbStatusChecks", () => {
  test("returns allOk=true when everything matches", async () => {
    const client = makeFakeClient();
    const report = await runDbStatusChecks(client, { bundledSchemaVersion: "0.3.0" });
    expect(report.allOk).toBe(true);
    expect(report.schemaVersion.mismatch).toBe(false);
    expect(report.tables.every((t) => t.status === "ok")).toBe(true);
    expect(report.functions.every((f) => f.status === "ok")).toBe(true);
  });

  test("reports allOk=false when a table is missing", async () => {
    const client = makeFakeClient({
      tableExists: mock(async (name: string) => name !== "cerefox_chunks"),
    });
    const report = await runDbStatusChecks(client, { bundledSchemaVersion: "0.3.0" });
    expect(report.allOk).toBe(false);
    expect(report.tables.find((t) => t.name === "cerefox_chunks")?.status).toBe("missing");
  });

  test("reports schemaVersion.mismatch=true when bundled != deployed", async () => {
    const client = makeFakeClient({
      rpc: mock(async () => "0.2.0"),
    });
    const report = await runDbStatusChecks(client, { bundledSchemaVersion: "0.3.0" });
    expect(report.schemaVersion.deployed).toBe("0.2.0");
    expect(report.schemaVersion.mismatch).toBe(true);
    expect(report.allOk).toBe(false);
  });

  test("handles legacy deployments where cerefox_schema_version RPC is missing", async () => {
    const client = makeFakeClient({
      rpc: mock(async () => null),
    });
    const report = await runDbStatusChecks(client, { bundledSchemaVersion: "0.3.0" });
    expect(report.schemaVersion.deployed).toBe(null);
    expect(report.schemaVersion.mismatch).toBe(false); // no false alarm
  });

  test("renders functions as 'unknown' (not 'ok' or 'missing') when the introspection helper RPC returns null", async () => {
    // This is the v0.3.1 fix: when cerefox_pg_function_exists isn't deployed,
    // functionExists returns null. The report must NOT misclassify as "missing"
    // (which would be a misleading false negative) and must NOT probe the
    // target RPCs (which is what created the orphan doc in v0.3.0).
    const client = makeFakeClient({
      functionExists: mock(async () => null),
    });
    const report = await runDbStatusChecks(client, { bundledSchemaVersion: "0.3.0" });
    expect(report.functions.every((f) => f.status === "unknown")).toBe(true);
    expect(report.allOk).toBe(false);
    // Each "unknown" row has a detail nudging the user toward db_deploy.py.
    for (const f of report.functions) {
      expect(f.detail).toMatch(/db_deploy/);
    }
  });

  test("invokes onProgress for every probe across all four phases", async () => {
    const events: ProgressEvent[] = [];
    const client = makeFakeClient();
    await runDbStatusChecks(client, {
      bundledSchemaVersion: "0.3.0",
      onProgress: (ev) => events.push(ev),
    });

    const expectedTotal =
      EXPECTED_TABLES.length + EXPECTED_FUNCTIONS.length + 5 /* row count tables */ + 1; /* schema version */
    expect(events.length).toBe(expectedTotal);

    // Phase order: tables → functions → rowCounts → schemaVersion
    const phases = events.map((e) => e.phase);
    expect(phases.slice(0, EXPECTED_TABLES.length).every((p) => p === "tables")).toBe(true);
    expect(phases.at(-1)).toBe("schemaVersion");

    // Indexes are 1-based and ≤ total within each phase.
    for (const ev of events) {
      expect(ev.index).toBeGreaterThanOrEqual(1);
      expect(ev.index).toBeLessThanOrEqual(ev.total);
    }
  });
});
