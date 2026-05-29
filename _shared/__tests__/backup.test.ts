/**
 * Unit tests for the TS backup port (iter-26 Part 26K).
 *
 * Covers the payload shape, filename/timestamp, version validation, and a
 * round-trip (create → restore) through an in-memory mock BackupDb — the
 * R13 acceptance proxy without a live Supabase. The live DB round-trip is
 * confirmed in the staging walk.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  type BackupDb,
  BACKUP_VERSION,
  backupFilename,
  backupTimestamp,
  buildBackupPayload,
  createBackup,
  listBackups,
  parseBackupFile,
  restoreBackup,
} from "../backup/index.js";

/** In-memory BackupDb: a doc store keyed by content_hash + chunks by doc id. */
function makeMockDb(seed: {
  docs: Array<Record<string, unknown>>;
  chunks: Record<string, Array<Record<string, unknown>>>;
}): BackupDb & { inserted: Record<string, unknown>[]; insertedChunks: Record<string, unknown>[] } {
  const byHash = new Map<string, Record<string, unknown>>();
  for (const d of seed.docs) byHash.set(d.content_hash as string, d);
  const inserted: Record<string, unknown>[] = [];
  const insertedChunks: Record<string, unknown>[] = [];
  let idCounter = 1000;
  return {
    inserted,
    insertedChunks,
    async listAllDocuments() {
      return seed.docs;
    },
    async listChunksForDocument(documentId: string) {
      return seed.chunks[documentId] ?? [];
    },
    async getDocumentByHash(contentHash: string) {
      return byHash.get(contentHash) ?? null;
    },
    async insertDocument(doc) {
      const id = `new-${idCounter++}`;
      inserted.push({ ...doc, id });
      return { id };
    },
    async insertChunks(chunks) {
      insertedChunks.push(...chunks);
    },
  };
}

describe("backup timestamp + filename", () => {
  test("timestamp is compact UTC (no separators, trailing Z)", () => {
    const ts = backupTimestamp(new Date("2026-03-07T12:00:00.000Z"));
    expect(ts).toBe("20260307T120000Z");
  });
  test("filename includes the label when present", () => {
    expect(backupFilename("20260307T120000Z")).toBe("cerefox-20260307T120000Z.json");
    expect(backupFilename("20260307T120000Z", "pre-migration")).toBe(
      "cerefox-20260307T120000Z-pre-migration.json",
    );
  });
});

describe("buildBackupPayload", () => {
  test("snapshots docs + their chunks with correct counts", async () => {
    const db = makeMockDb({
      docs: [
        { id: "d1", title: "A", content_hash: "h1" },
        { id: "d2", title: "B", content_hash: "h2" },
      ],
      chunks: {
        d1: [{ id: "c1", document_id: "d1", chunk_index: 0, content: "x" }],
        d2: [
          { id: "c2", document_id: "d2", chunk_index: 0, content: "y" },
          { id: "c3", document_id: "d2", chunk_index: 1, content: "z" },
        ],
      },
    });
    const payload = await buildBackupPayload(db);
    expect(payload.version).toBe(BACKUP_VERSION);
    expect(payload.document_count).toBe(2);
    expect(payload.chunk_count).toBe(3);
    expect(payload.documents[0].chunks).toHaveLength(1);
    expect(payload.documents[1].chunks).toHaveLength(2);
  });
});

describe("create → file → parse → restore round trip", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cerefox-backup-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("createBackup writes a parseable file + listBackups finds it", async () => {
    const db = makeMockDb({
      docs: [{ id: "d1", title: "A", content_hash: "h1" }],
      chunks: { d1: [{ id: "c1", document_id: "d1", chunk_index: 0, content: "x" }] },
    });
    const info = await createBackup(db, dir, { label: "test" });
    expect(existsSync(info.path)).toBe(true);
    expect(info.documentCount).toBe(1);
    expect(info.chunkCount).toBe(1);

    const parsed = parseBackupFile(info.path);
    expect(parsed.version).toBe(BACKUP_VERSION);
    expect(parsed.documents[0].title).toBe("A");

    const listed = listBackups(dir);
    expect(listed.length).toBe(1);
    expect(listed[0].filename).toContain("cerefox-");
  });

  test("restore skips docs whose content_hash already exists (idempotent)", async () => {
    const db = makeMockDb({
      docs: [{ id: "d1", title: "A", content_hash: "h1" }],
      chunks: { d1: [{ id: "c1", document_id: "d1", chunk_index: 0, content: "x" }] },
    });
    const info = await createBackup(db, dir, { label: "idem" });
    // Restore into the SAME db → h1 already present → skipped.
    const stats = await restoreBackup(db, info.path);
    expect(stats.skipped).toBe(1);
    expect(stats.restored).toBe(0);
    expect(db.inserted).toHaveLength(0);
  });

  test("restore into an empty db inserts docs + chunks, stripping server fields", async () => {
    const source = makeMockDb({
      docs: [{ id: "d1", title: "A", content_hash: "h1", created_at: "x", updated_at: "y" }],
      chunks: {
        d1: [{ id: "c1", document_id: "d1", chunk_index: 0, content: "x", created_at: "z" }],
      },
    });
    const info = await createBackup(source, dir, { label: "fresh" });

    const target = makeMockDb({ docs: [], chunks: {} }); // empty
    const stats = await restoreBackup(target, info.path);
    expect(stats.restored).toBe(1);
    expect(stats.skipped).toBe(0);
    expect(target.inserted).toHaveLength(1);
    // Server-generated timestamps stripped from the insert payload.
    // (The mock re-attaches a fresh `id` after insert, so we don't assert
    // on `id` absence here — created_at/updated_at are the real test.)
    expect(target.inserted[0]).not.toHaveProperty("created_at");
    expect(target.inserted[0]).not.toHaveProperty("updated_at");
    expect(target.inserted[0].title).toBe("A");
    // Chunk reparented to the new doc id, server fields stripped.
    expect(target.insertedChunks).toHaveLength(1);
    expect(target.insertedChunks[0].document_id).toBe(target.inserted[0].id);
    expect(target.insertedChunks[0]).not.toHaveProperty("id");
  });

  test("dry-run validates without inserting", async () => {
    const source = makeMockDb({
      docs: [{ id: "d1", title: "A", content_hash: "h1" }],
      chunks: { d1: [] },
    });
    const info = await createBackup(source, dir, { label: "dry" });
    const target = makeMockDb({ docs: [], chunks: {} });
    const stats = await restoreBackup(target, info.path, { dryRun: true });
    expect(stats.restored).toBe(1); // counted
    expect(target.inserted).toHaveLength(0); // but not written
  });
});

describe("parseBackupFile validation", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "cerefox-backup-bad-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("rejects an unsupported version", () => {
    const bad = join(dir, "cerefox-bad.json");
    require("node:fs").writeFileSync(bad, JSON.stringify({ version: 999, documents: [] }));
    expect(() => parseBackupFile(bad)).toThrow(/Unsupported backup version/);
  });

  test("throws on a missing file", () => {
    expect(() => parseBackupFile(join(dir, "nope.json"))).toThrow(/not found/);
  });
});
