/**
 * File-system backup + restore for Cerefox documents (iter-26 Part 26K).
 *
 * TS port of `src/cerefox/backup/fs_backup.py`. Each backup is a single
 * JSON file: a full snapshot of all documents and their current chunks,
 * written atomically (temp + rename). The on-disk format is **identical**
 * to the Python version (`version: 1`) so backups round-trip across both.
 *
 *   { version: 1, created_at, document_count, chunk_count,
 *     documents: [ { ...doc columns..., chunks: [ {...}, ... ] }, ... ] }
 *
 * Node/Bun only (node:fs) — not a Deno surface.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const BACKUP_VERSION = 1;

export interface BackupInfo {
  path: string;
  documentCount: number;
  chunkCount: number;
  sizeBytes: number;
  createdAt: string;
}

export interface RestoreStats {
  restored: number;
  skipped: number;
  errors: number;
}

export interface BackupListEntry {
  filename: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

/**
 * Minimal DB surface the backup needs. Implemented over the Supabase
 * client by `scripts/backup_create.ts` / `backup_restore.ts`.
 */
export interface BackupDb {
  listAllDocuments(): Promise<Record<string, unknown>[]>;
  listChunksForDocument(documentId: string): Promise<Record<string, unknown>[]>;
  getDocumentByHash(contentHash: string): Promise<Record<string, unknown> | null>;
  insertDocument(doc: Record<string, unknown>): Promise<{ id: string }>;
  insertChunks(chunks: Record<string, unknown>[]): Promise<void>;
}

interface BackupPayload {
  version: number;
  created_at: string;
  document_count: number;
  chunk_count: number;
  documents: Array<Record<string, unknown> & { chunks: Record<string, unknown>[] }>;
}

/** UTC timestamp filename component: 20260307T120000Z. */
export function backupTimestamp(d: Date = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function backupFilename(ts: string, label?: string): string {
  return `cerefox-${ts}${label ? `-${label}` : ""}.json`;
}

/** Atomic write: temp file in the same dir, then rename over the dest. */
function atomicWriteJson(dest: string, payload: unknown): void {
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  renameSync(tmp, dest);
}

/** Build the backup payload from the DB (no file I/O — testable). */
export async function buildBackupPayload(db: BackupDb): Promise<BackupPayload> {
  const documents = await db.listAllDocuments();
  let chunkCount = 0;
  const enriched: BackupPayload["documents"] = [];
  for (const doc of documents) {
    const chunks = await db.listChunksForDocument(doc.id as string);
    chunkCount += chunks.length;
    enriched.push({ ...doc, chunks });
  }
  return {
    version: BACKUP_VERSION,
    created_at: new Date().toISOString(),
    document_count: documents.length,
    chunk_count: chunkCount,
    documents: enriched,
  };
}

export async function createBackup(
  db: BackupDb,
  backupDir = "./backups",
  opts: { label?: string } = {},
): Promise<BackupInfo> {
  mkdirSync(backupDir, { recursive: true });
  const ts = backupTimestamp();
  const dest = join(backupDir, backupFilename(ts, opts.label));
  const payload = await buildBackupPayload(db);
  atomicWriteJson(dest, payload);
  const sizeBytes = statSync(dest).size;
  return {
    path: dest,
    documentCount: payload.document_count,
    chunkCount: payload.chunk_count,
    sizeBytes,
    createdAt: payload.created_at,
  };
}

/** Parse + validate a backup file's version. Throws on bad version. */
export function parseBackupFile(backupPath: string): BackupPayload {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }
  const payload = JSON.parse(readFileSync(backupPath, "utf8")) as BackupPayload;
  if (payload.version !== BACKUP_VERSION) {
    throw new Error(
      `Unsupported backup version: ${payload.version} (expected ${BACKUP_VERSION})`,
    );
  }
  return payload;
}

const SERVER_DOC_FIELDS = new Set(["id", "created_at", "updated_at"]);
const SERVER_CHUNK_FIELDS = new Set(["id", "created_at", "updated_at", "document_id"]);

function omit(obj: Record<string, unknown>, drop: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!drop.has(k)) out[k] = v;
  return out;
}

/**
 * Restore documents + chunks from a backup file. Idempotent: documents
 * whose content_hash already exists are skipped. Mirrors the Python
 * restore semantics exactly so cross-language round-trips work.
 */
export async function restoreBackup(
  db: BackupDb,
  backupPath: string,
  opts: { dryRun?: boolean } = {},
): Promise<RestoreStats> {
  const payload = parseBackupFile(backupPath);
  const stats: RestoreStats = { restored: 0, skipped: 0, errors: 0 };

  for (const rawDoc of payload.documents) {
    const { chunks = [], ...doc } = rawDoc;
    const contentHash = doc.content_hash as string | undefined;
    try {
      const existing = contentHash ? await db.getDocumentByHash(contentHash) : null;
      if (existing) {
        stats.skipped++;
        continue;
      }
      if (!opts.dryRun) {
        const inserted = await db.insertDocument(omit(doc, SERVER_DOC_FIELDS));
        const newId = inserted.id;
        const chunkRows = chunks.map((ch) => ({
          ...omit(ch, SERVER_CHUNK_FIELDS),
          document_id: newId,
        }));
        if (chunkRows.length > 0) await db.insertChunks(chunkRows);
      }
      stats.restored++;
    } catch {
      stats.errors++;
    }
  }
  return stats;
}

export function listBackups(backupDir = "./backups"): BackupListEntry[] {
  if (!existsSync(backupDir)) return [];
  const out: BackupListEntry[] = [];
  for (const name of readdirSync(backupDir).sort()) {
    if (!name.startsWith("cerefox-") || !name.endsWith(".json")) continue;
    try {
      const p = join(backupDir, name);
      const st = statSync(p);
      out.push({
        filename: name,
        path: p,
        sizeBytes: st.size,
        modifiedAt: new Date(st.mtimeMs).toISOString(),
      });
    } catch {
      // race: file vanished
    }
  }
  return out;
}
