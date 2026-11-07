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
import { basename, join, resolve } from "node:path";

import {
  c,
  println,
  printTable,
  resolveAuthor,
  systemError,
  userError,
  warn,
} from "../../../../../_shared/cli-core/index.ts";
import { fetchAllPages } from "../../../../../_shared/db-client/paginate.ts";
import { getClient } from "../util/client.ts";
import { progName } from "../util/prog-name.ts";
import { authorOption } from "../util/identity-flags.ts";

interface RestoreOptions {
  author?: string;
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
      /** Environment that produced the snapshot (format 4+); null/absent on a normal install. */
      env_label?: string | null;
      schema_version?: string;
      document_count?: number;
      chunk_count?: number;
      projects?: Array<{ id: string; name: string; description?: string | null }>;
      memberships?: Array<{ document_id: string; project_id: string }>;
      relations?: Array<{ source_id: string; target_id: string; rel_type: string }>;
      documents: Array<{
        id: string;
        title: string;
        content_hash: string;
        /** Non-null on soft-deleted documents; replayed verbatim (format 4+). */
        deleted_at?: string | null;
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

  // Cross-environment restores are legitimate (seeding staging from production
  // is the main reason staging exists) but the reverse is a mistake you only
  // make once. Since `CEREFOX_BACKUP_DIR` does not follow `CEREFOX_CONFIG_DIR`,
  // snapshots from both environments can sit in one directory — so say out loud
  // when the file and the target disagree instead of restoring silently.
  {
    const fileEnv = (payload.env_label ?? "").trim();
    const targetEnv = (process.env.CEREFOX_ENV_LABEL ?? "").trim();
    if (fileEnv !== targetEnv) {
      warn(
        `This snapshot came from ${fileEnv ? `the "${fileEnv}" environment` : "an unlabeled (production) environment"}, ` +
          `but you are restoring into ${targetEnv ? `"${targetEnv}"` : "an unlabeled (production) environment"}.`,
      );
    }
  }

  // Trashed documents (format 4+) are restored *as trash*: the row carries its
  // original `deleted_at`, and every read/search RPC filters on that column, so
  // nothing the operator deleted comes back visible. Announced up front so a
  // restore never quietly reinstates deleted content.
  const trashedInFile = payload.documents.filter((d) => d.deleted_at != null).length;
  if (trashedInFile > 0) {
    println(
      c.dim(
        `  trashed documents in file: ${trashedInFile} — restored as trash ` +
          `(still deleted; recover with \`${progName()} document restore\`)`,
      ),
    );
  }
  println("");

  const client = getClient();
  const author = resolveAuthor(options.author);
  const backupName = basename(file);

  let restored = 0;
  let skipped = 0;
  let errors = 0;
  const errorDetails: Array<{ title: string; error: string }> = [];

  // ── Projects (#166), before documents so memberships resolve ─────────────
  // Each project actually created gets a 'backup-restore' audit entry; one
  // whose id already exists keeps its current name and description.
  let projectsRestored = 0;
  const projectIdMap = new Map<string, string>();
  if (!options.dryRun && hasMemberships && (payload.projects?.length ?? 0) > 0) {
    const { data, error: projErr } = await client.raw.rpc("cerefox_restore_backup_projects", {
      p_projects: payload.projects,
      p_author: author,
      p_backup: backupName,
    });
    if (projErr) {
      errors++;
      errorDetails.push({ title: "(projects)", error: projErr.message });
    } else {
      const r = (data ?? {}) as { created?: number; id_map?: Record<string, string> };
      projectsRestored = r.created ?? 0;
      // A backup project whose name already exists here under another id is
      // not created; its memberships go to the existing project instead.
      for (const [from, to] of Object.entries(r.id_map ?? {})) projectIdMap.set(from, to);
      if (projectIdMap.size > 0) {
        warn(
          `${projectIdMap.size} project(s) in the backup share a name with an existing project; ` +
            "their memberships were added to the existing one.",
        );
      }
    }
  }
  const membershipsByDoc = new Map<string, string[]>();
  for (const m of payload.memberships ?? []) {
    const list = membershipsByDoc.get(m.document_id) ?? [];
    list.push(m.project_id);
    // Resolved against projectIdMap at use time (it is filled just above
    // when projects restore, and stays empty on a dry run).
    membershipsByDoc.set(m.document_id, list);
  }
  let membershipsRestored = 0;
  let membershipsDropped = 0;
  const restoredIds = new Set<string>();

  // Ids this backup restores. Content is not unique (#332), so two documents
  // in one backup can share a body; the hash arm below must not let the first
  // one's arrival skip the second.
  const payloadIds = new Set(payload.documents.map((d) => d.id));

  for (const doc of payload.documents) {
    // Skip if this document is already present — by id *or* by content hash.
    //
    // Matching on content_hash alone was not enough to make restore
    // re-runnable, which is the property its help text promises. A document
    // edited between two snapshots keeps its id but changes its hash, so the
    // hash probe missed it and the insert then died on the primary key:
    //   duplicate key value violates unique constraint "cerefox_documents_pkey"
    // Three documents hit exactly that restoring a fresh production snapshot
    // over a slightly older copy.
    //
    // Skipping (rather than overwriting) keeps restore additive and
    // non-destructive: re-running it can never replace content in the target
    // with an older revision. Recovering a *specific* superseded document is a
    // deliberate act — restore that snapshot into an empty store, or use
    // `document version` — not something a bulk re-run should do silently.
    //
    // The hash arm follows the create-time rule (#332): it counts only a LIVE
    // document from outside this backup, and only for a live backup document.
    // An id match always counts, trashed or not (it is the primary key).
    //
    // Two lookups, each exact: one shared .or() query capped at N rows could
    // drop the very row that decides it (#334 review). The hash lookup pages
    // past rows that belong to this backup, so the server's row cap cannot
    // hide a match from outside it.
    const { data: byId } = await client.raw
      .from("cerefox_documents")
      .select("id")
      .eq("id", doc.id)
      .limit(1);
    let existing = (byId ?? []).length > 0;
    if (!existing && !doc.deleted_at && doc.content_hash) {
      const PAGE = 500;
      for (let from = 0; !existing; from += PAGE) {
        const { data: byHash } = await client.raw
          .from("cerefox_documents")
          .select("id")
          .eq("content_hash", doc.content_hash)
          .is("deleted_at", null)
          .order("id")
          .range(from, from + PAGE - 1);
        const rows = (byHash ?? []) as Array<{ id: string }>;
        existing = rows.some((m) => !payloadIds.has(m.id));
        if (rows.length < PAGE) break;
      }
    }

    if (existing) {
      skipped++;
      continue;
    }

    if (options.dryRun) {
      restored++;
      continue;
    }

    // The document row, its chunks, its memberships and a 'backup-restore'
    // audit entry commit together (0.22.0): a failure leaves nothing behind,
    // where two separate inserts could land a document without its chunks.
    const docRow = { ...doc };
    delete (docRow as { chunks?: unknown }).chunks;
    const projectIds = (membershipsByDoc.get(doc.id) ?? []).map((id) => projectIdMap.get(id) ?? id);
    const { data: landed, error: docErr } = await client.raw.rpc("cerefox_restore_backup_document", {
      p_document: docRow,
      p_chunks: doc.chunks,
      p_project_ids: projectIds,
      p_author: author,
      p_backup: backupName,
    });
    if (docErr) {
      errors++;
      errorDetails.push({ title: doc.title, error: `restore: ${docErr.message}` });
      continue;
    }
    const outcome = (landed ?? {}) as { restored?: boolean; linked?: number; missing_projects?: string[] };
    if (outcome.restored === false) {
      skipped++;
      continue;
    }
    membershipsRestored += outcome.linked ?? 0;
    if ((outcome.missing_projects?.length ?? 0) > 0) {
      membershipsDropped += outcome.missing_projects!.length;
    }
    restoredIds.add(doc.id);
    restored++;
  }

  // ── Memberships of documents that were already here, then relations ────
  // A document skipped because its id already exists still gets the
  // memberships the backup records, added (never removed) through the audited
  // membership RPC; it writes an entry only when something was missing.
  let relationsRestored = 0;
  if (!options.dryRun && hasMemberships) {
    const backupIds = (payload.documents ?? []).map((d) => d.id);
    const presentDocIds = new Set<string>();
    for (let i = 0; i < backupIds.length; i += 200) {
      const { data } = await client.raw
        .from("cerefox_documents")
        .select("id")
        .in("id", backupIds.slice(i, i + 200));
      for (const row of (data ?? []) as Array<{ id: string }>) presentDocIds.add(row.id);
    }
    // Projects on this store now (after the project restore above): a
    // membership to any other project cannot be added, and is reported.
    const knownProjects = new Set<string>();
    // Paged: an unbounded select caps at the Data API row limit (#131).
    for (const row of await fetchAllPages<{ id: string }>((from, to) =>
      client.raw.from("cerefox_projects").select("id").order("id").range(from, to),
    )) {
      knownProjects.add(row.id);
    }
    for (const [docId, backupProjectIds] of membershipsByDoc) {
      if (!presentDocIds.has(docId) || restoredIds.has(docId)) continue;
      const mapped = backupProjectIds.map((id) => projectIdMap.get(id) ?? id);
      const projectIds = mapped.filter((id) => knownProjects.has(id));
      membershipsDropped += mapped.length - projectIds.length;
      if (projectIds.length === 0) continue;
      const { data, error: linkErr } = await client.raw.rpc("cerefox_apply_document_projects", {
        p_document_id: docId,
        p_project_ids: projectIds,
        p_mode: "add",
        p_author: author,
        p_author_type: "user",
      });
      if (linkErr) {
        // One document's failure (say, a project missing from the backup)
        // must not stop the memberships of every document after it.
        errors++;
        errorDetails.push({ title: `(memberships of ${docId})`, error: linkErr.message });
        continue;
      }
      membershipsRestored += (data as Array<{ added_count: number }> | null)?.[0]?.added_count ?? 0;
    }

    // Relations (iteration 29). Only edges whose BOTH endpoints are present.
    // The RPC keeps each edge's original author and metadata, and audits each
    // edge it creates.
    const relations = (payload.relations ?? []).filter(
      (r) => presentDocIds.has(r.source_id) && presentDocIds.has(r.target_id),
    );
    if (relations.length > 0) {
      const { data, error: relErr } = await client.raw.rpc("cerefox_restore_backup_relations", {
        p_relations: relations,
        p_author: author,
        p_backup: backupName,
      });
      if (relErr) {
        errorDetails.push({ title: "(relations)", error: relErr.message });
        errors++;
      } else {
        relationsRestored = (data as number | null) ?? 0;
      }
      const dropped = (payload.relations?.length ?? 0) - relations.length;
      if (dropped > 0) {
        warn(`${dropped} relation(s) skipped — one or both documents were not restored.`);
      }
    }
  }

  if (membershipsDropped > 0) {
    warn(
      `${membershipsDropped} membership(s) not restored: their project is neither in the backup ` +
        "nor on this store.",
    );
  }

  println("");
  println(
    (options.dryRun ? c.yellow("(dry-run) ") : "") +
      c.bold(`Summary: ${restored} restored · ${skipped} skipped · ${errors} errors`),
  );
  if (hasMemberships && !options.dryRun) {
    println(
      c.dim(
        `  projects: ${projectsRestored} · memberships: ${membershipsRestored}` +
          (relationsRestored > 0 ? ` · relations: ${relationsRestored}` : ""),
      ),
    );
  }
  if (trashedInFile > 0) {
    println(c.dim(`  ${trashedInFile} of those are trashed and stay trashed.`));
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
    .argument("<snapshot>", `Backup file (or directory; most recent is picked) produced by \`${progName()} backup\`.`)
    .option("--dry-run", "Print what would be restored without writing.")
    .addOption(authorOption("write"))
    .option(
      "-p, --project-name <name>",
      "Reserved for future use; currently ignored. Project memberships are restored from the backup itself (format 2+).",
    )
    .action(action);
}
