/**
 * Ingestion 503 stubs (Part 24H — 3 endpoints):
 *
 *   POST /api/v1/ingest
 *   POST /api/v1/ingest/file
 *   POST /api/v1/documents/{document_id}/upload
 *
 * Locked decision (plan.md § Iteration 24): these three endpoints
 * return 503 in v0.6 because they need the v0.7 in-process ingestion
 * pipeline (chunker + embedder + version-snapshot orchestration). The
 * frontend's Mantine toast (Part 24J) detects the 503 and surfaces the
 * "Ingestion lands in v0.7 — use `cerefox ingest file.md` from the
 * CLI for now" message; the CLI path hits the cerefox-ingest Edge
 * Function and works fully.
 *
 * Python source for the shapes these handlers replace:
 *   - api_ingest_paste     (routes_api.py:1030)
 *   - api_ingest_file      (routes_api.py:1074)
 *   - api_upload_content   (routes_api.py:994)
 *
 * The 503 body shape matches the contract /edit's content-change
 * branch already uses in Part 24E, so the frontend can share one
 * detector function.
 */

import { Hono } from "hono";

const V07_MIGRATION_URL =
  "https://github.com/fstamatelopoulos/cerefox/blob/main/docs/guides/migration-v0.5.md#v06";

const STUB_BODY = {
  success: false,
  error: "Ingestion lands in v0.7",
  see: V07_MIGRATION_URL,
  note:
    "Web-UI ingestion (paste / upload / replace) requires the in-process pipeline that ships in v0.7. " +
    "Working alternatives today: `cerefox ingest <file>` from the CLI (hits the Edge Function), or " +
    "`uv run cerefox web` to use the Python web server.",
} as const;

export function registerIngestStubRoutes(app: Hono): void {
  app.post("/api/v1/ingest", (c) => c.json(STUB_BODY, 503));
  app.post("/api/v1/ingest/file", (c) => c.json(STUB_BODY, 503));
  app.post("/api/v1/documents/:document_id/upload", (c) => c.json(STUB_BODY, 503));
}
