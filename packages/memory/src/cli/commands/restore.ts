/**
 * `cerefox restore <snapshot-dir-or-file>` — restore from a JSON snapshot.
 *
 * Takes either a backup directory (uses the most recent file by mtime)
 * or a specific backup file. Documents whose `content_hash` already
 * exists in the DB are skipped (idempotent).
 *
 * v0.5 implementation deliberately stays simple: it inserts document
 * rows + chunk rows directly via the Data API (matching the Python
 * backup format that includes pre-computed embeddings). No chunking,
 * no re-embedding — backups round-trip 1:1.
 */

import type { Command } from "commander";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  c,
  println,
  printTable,
  systemError,
  userError,
  warn,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

interface RestoreOptions {
  dryRun?: boolean;
  projectName?: string;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function resolveBackupFile(target: string): string {
  const path = resolve(expandHome(target));
  if (!existsSync(path)) {
    throw userError(`Backup path not found: ${target}`);
  }
  const stat = statSync(path);
  if (stat.isFile()) return path;
  // Directory — pick the most recent .json file.
  const candidates = readdirSync(path)
    .filter((n) => n.endsWith(".json") && n.startsWith("cerefox-"))
    .map((n) => ({ name: n, mtime: statSync(join(path, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (candidates.length === 0) {
    throw userError(`No cerefox-*.json files in ${path}`);
  }
  return join(path, candidates[0].name);
}

async function action(target: string, options: RestoreOptions): Promise<void> {
  const file = resolveBackupFile(target);

  let payload;
  try {
    payload = JSON.parse(readFileSync(file, "utf8")) as {
      cerefox_version?: string;
      // 2 = includes projects + memberships (#166). Absent/1 = documents and
      // chunks only; those snapshots still restore, just without memberships.
      backup_format?: number;
      schema_version?: string;
      document_count?: number;
      chunk_count?: number;
      projects?: Array<{ id: string; name: string; description?: string | null }>;
      memberships?: Array<{ document_id: string; project_id: string }>;
      documents: Array<{
        id: string;
        title: string;
        content_hash: string;
        chunks: Array<Record<string, unknown>>;
        [k: string]: unknown;
      }>;
    };
  } catch (err) {
    throw userError(`Could not parse backup file ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!payload.documents || !Array.isArray(payload.documents)) {
    throw userError(`Backup file is missing "documents" array: ${file}`);
  }

  println(c.bold(`Restoring from ${file}`));
  const hasMemberships = Array.isArray(payload.memberships);
  println(
    c.dim(
      `  cerefox_version: ${payload.cerefox_version ?? "?"} · ` +
        `schema: ${payload.schema_version ?? "?"} · ` +
        `documents in file: ${payload.documents.length} · chunks in file: ${payload.chunk_count ?? "?"}`,
    ),
  );
  // Say plainly what will and will not be recreated — the previous silence
  // here is what let membership loss go unnoticed (#166).
  if (hasMemberships) {
    println(
      c.dim(
        `  projects: ${payload.projects?.length ?? 0} · memberships: ${payload.memberships?.length ?? 0}`,
      ),
    );
  } else {
    warn(
      "This backup predates project-membership capture (format 1) — documents " +
        "will be restored WITHOUT their project assignments.",
    );
  }
  println("");

  const client = getClient();

  let restored = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: Array<{ title: string; error: string }> = [];

  for (const doc of payload.documents) {
    // Skip if a doc with the same content_hash already exists.
    const { data: existing } = await client.raw
      .from("cerefox_documents")
      .select("id")
      .eq("content_hash", doc.content_hash)
      .maybeSingle();

    if (existing) {
      skipped++;
      continue;
    }

    if (options.dryRun) {
      restored++;
      continue;
    }

    // Insert the document row.
    const docInsert = { ...doc };
    delete (docInsert as { chunks?: unknown }).chunks;
    const { error: docErr } = await client.raw
      .from("cerefox_documents")
      .insert(docInsert);
    if (docErr) {
      errors++;
      errorDetails.push({ title: doc.title, error: `doc insert: ${docErr.message}` });
      continue;
    }

    // Insert chunk rows.
    if (doc.chunks.length > 0) {
      const { error: chunkErr } = await client.raw
        .from("cerefox_chunks")
        .insert(doc.chunks);
      if (chunkErr) {
        errors++;
        errorDetails.push({ title: doc.title, error: `chunks insert: ${chunkErr.message}` });
        continue;
      }
    }

    restored++;
  }

  // ── Projects + memberships (#166) ────────────────────────────────────────
  // After documents exist, so foreign keys resolve. Both steps are idempotent
  // (upsert / ignore-duplicates) because restore is safe to re-run, and both
  // are skipped for format-1 snapshots that carry neither.
  let projectsRestored = 0;
  let membershipsRestored = 0;
  if (!options.dryRun && hasMemberships) {
    const projects = payload.projects ?? [];
    if (projects.length > 0) {
      // Keep existing rows authoritative: a project that already exists keeps
      // its current name/description rather than being overwritten.
      const { error: projErr } = await client.raw
        .from("cerefox_projects")
        .upsert(projects, { onConflict: "id", ignoreDuplicates: true });
      if (projErr) {
        errors++;
        errorDetails.push({ title: "(projects)", error: projErr.message });
      } else {
        projectsRestored = projects.length;
      }
    }

    // Only memberships whose document actually landed — a skipped duplicate or
    // a failed insert must not leave a dangling edge.
    const presentDocIds = new Set<string>();
    {
      const ids = (payload.documents ?? []).map((d) => d.id);
      for (let i = 0; i < ids.length; i += 200) {
        const { data } = await client.raw
          .from("cerefox_documents")
          .select("id")
          .in("id", ids.slice(i, i + 200));
        for (const row of (data ?? []) as Array<{ id: string }>) presentDocIds.add(row.id);
      }
    }
    const links = (payload.memberships ?? []).filter((m) => presentDocIds.has(m.document_id));
    for (let i = 0; i < links.length; i += 500) {
      const { error: linkErr } = await client.raw
        .from("cerefox_document_projects")
        .upsert(links.slice(i, i + 500), {
          onConflict: "document_id,project_id",
          ignoreDuplicates: true,
        });
      if (linkErr) {
        errors++;
        errorDetails.push({ title: "(memberships)", error: linkErr.message });
        break;
      }
      membershipsRestored += links.slice(i, i + 500).length;
    }
  }

  println("");
  println(
    (options.dryRun ? c.yellow("(dry-run) ") : "") +
      c.bold(`Summary: ${restored} restored · ${skipped} skipped · ${errors} errors`),
  );
  if (hasMemberships && !options.dryRun) {
    println(
      c.dim(`  projects: ${projectsRestored} · memberships: ${membershipsRestored}`),
    );
  }

  if (errors > 0) {
    println("");
    printTable(errorDetails);
    throw systemError(`Restore completed with ${errors} error(s).`);
  }
}

export function registerRestore(program: Command): void {
  program
    .command("restore")
    .description("Restore a JSON-snapshot backup into the knowledge base.")
    .argument("<snapshot>", "Backup file (or directory; most recent is picked) produced by `cerefox backup`.")
    .option("--dry-run", "Print what would be restored without writing.")
    .option(
      "-p, --project-name <name>",
      "Reserved for future use; currently ignored. Project memberships are restored from the backup itself (format 2+).",
    )
    .action(action);
}
