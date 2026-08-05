#!/usr/bin/env bun
/**
 * cerefox_export.ts — dump every Cerefox document to a folder of markdown
 * files (iter-26 Part 26M).
 *
 * A simple one-way export for easy local backups / browsing. NOT a
 * round-trip format — use `scripts/backup_create.ts` +
 * `scripts/backup_restore.ts` (JSON) when you need to restore.
 *
 * Usage:
 *   bun scripts/cerefox_export.ts <target-folder>
 *   bun scripts/cerefox_export.ts <target-folder> --project "My Project"
 *   bun scripts/cerefox_export.ts <target-folder> --force   # allow non-empty target
 *
 * Layout:
 *   <target>/<project-slug>/<title-slug>.md   — one folder per project
 *   <target>/<title-slug>.md                  — documents with no project
 *   Documents in multiple projects are written once per project (copies),
 *   to keep the logic simple.
 *
 * Content only — markdown reconstructed via the `cerefox_get_document` RPC.
 * No metadata sidecar.
 *
 * Requires CEREFOX_SUPABASE_URL + CEREFOX_SUPABASE_KEY in your .env.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { loadSettings } from "../_shared/config/index.js";
import { createClient } from "../_shared/db-client/index.js";
import { fetchAllPages } from "../_shared/db-client/paginate.js";
import {
  EXIT_OK,
  EXIT_USER_ERROR,
  EXIT_SYSTEM_ERROR,
  c,
  println,
  errorln,
} from "../_shared/cli-core/index.js";

interface Args {
  target?: string;
  project?: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") {
      const v = argv[++i];
      if (!v) {
        errorln("--project requires a name argument");
        process.exit(EXIT_USER_ERROR);
      }
      out.project = v;
    } else if (a === "--force") {
      out.force = true;
    } else if (a === "--help" || a === "-h") {
      println("Usage: bun scripts/cerefox_export.ts <target-folder> [--project <name>] [--force]");
      println("");
      println("  <target-folder>   Required. Where to write the exported .md files.");
      println("  --project <name>  Export only documents in this project.");
      println("  --force           Allow exporting into a non-empty target folder.");
      process.exit(EXIT_OK);
    } else if (a.startsWith("-")) {
      errorln(`Unknown arg: ${a}`);
      process.exit(EXIT_USER_ERROR);
    } else if (!out.target) {
      out.target = a;
    } else {
      errorln(`Unexpected argument: ${a}`);
      process.exit(EXIT_USER_ERROR);
    }
  }
  return out;
}

/** Slugify a title/name into a filesystem-safe segment (max 80 chars). */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks (é → e)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "untitled";
}

/** Pick a non-colliding `<slug>.md` (or `<slug>-2.md`, …) within `used`. */
export function uniqueFilename(slug: string, used: Set<string>): string {
  let name = `${slug}.md`;
  let n = 2;
  while (used.has(name)) {
    name = `${slug}-${n}.md`;
    n++;
  }
  used.add(name);
  return name;
}

interface DocRow {
  id: string;
  title: string;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target) {
    errorln("A target folder is required.");
    errorln("Usage: bun scripts/cerefox_export.ts <target-folder> [--project <name>] [--force]");
    process.exit(EXIT_USER_ERROR);
  }

  const settings = loadSettings();
  if (!settings.supabaseUrl || !settings.supabaseKey) {
    errorln("❌  CEREFOX_SUPABASE_URL and CEREFOX_SUPABASE_KEY must be set.");
    errorln("    See docs/guides/setup-supabase.md.");
    process.exit(EXIT_SYSTEM_ERROR);
  }

  // Refuse to write into a non-empty target unless --force.
  if (existsSync(args.target)) {
    const entries = readdirSync(args.target);
    if (entries.length > 0 && !args.force) {
      errorln(`Target "${args.target}" is not empty. Pass --force to export into it anyway.`);
      process.exit(EXIT_USER_ERROR);
    }
  } else {
    mkdirSync(args.target, { recursive: true });
  }

  const client = createClient(settings);

  // Resolve --project name → id (and validate).
  let projectFilterId: string | null = null;
  if (args.project) {
    const { data, error } = await client.raw
      .from("cerefox_projects")
      .select("id")
      .eq("name", args.project)
      .maybeSingle();
    if (error) {
      errorln(`Project lookup failed: ${error.message}`);
      process.exit(EXIT_SYSTEM_ERROR);
    }
    if (!data) {
      errorln(`Project "${args.project}" not found.`);
      process.exit(EXIT_USER_ERROR);
    }
    projectFilterId = (data as { id: string }).id;
  }

  // Build project-id → name map for folder naming.
  const { data: projectRows, error: projErr } = await client.raw
    .from("cerefox_projects")
    .select("id, name");
  if (projErr) {
    errorln(`Could not list projects: ${projErr.message}`);
    process.exit(EXIT_SYSTEM_ERROR);
  }
  const projectName = new Map<string, string>();
  for (const p of (projectRows ?? []) as Array<{ id: string; name: string }>) {
    projectName.set(p.id, p.name);
  }

  // Fetch the live (non-deleted) documents to export. Paginated, and project
  // scoping is a server-side inner join rather than a prefetched id list
  // (#134): the old shape silently truncated the export at the PostgREST row
  // cap (1000) and inflated the request URL with every membership id.
  //
  // Widened to `string`: postgrest-js's select-string parser doesn't model the
  // `!inner` embed hint at the type level, though it is valid at runtime.
  const selectCols: string = projectFilterId
    ? "id, title, cerefox_document_projects!inner(project_id)"
    : "id, title";
  let docRows: DocRow[];
  try {
    docRows = await fetchAllPages<DocRow>((from, to) => {
      let q = client.raw
        .from("cerefox_documents")
        .select(selectCols)
        .is("deleted_at", null);
      if (projectFilterId) {
        q = q.eq("cerefox_document_projects.project_id", projectFilterId);
      }
      return q.order("id", { ascending: true }).range(from, to);
    });
  } catch (err) {
    errorln(`Could not list documents: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(EXIT_SYSTEM_ERROR);
  }
  if (projectFilterId && docRows.length === 0) {
    println(`No documents in project "${args.project}". Nothing to export.`);
    process.exit(EXIT_OK);
  }
  if (docRows.length === 0) {
    println("No documents to export.");
    process.exit(EXIT_OK);
  }

  // Per-folder filename-collision trackers.
  const usedNames = new Map<string, Set<string>>();
  const usedFor = (folder: string): Set<string> => {
    let s = usedNames.get(folder);
    if (!s) {
      s = new Set<string>();
      usedNames.set(folder, s);
    }
    return s;
  };

  println(c.bold(`Exporting ${docRows.length} document(s) to ${args.target}…`));
  let written = 0;
  let failed = 0;

  for (const doc of docRows) {
    // Reconstruct content via the RPC (no content column on documents).
    const { data: rpcData, error: rpcErr } = await client.raw.rpc("cerefox_get_document", {
      p_document_id: doc.id,
      p_version_id: null,
    });
    if (rpcErr) {
      errorln(`  ✗ ${doc.title}: ${rpcErr.message}`);
      failed++;
      continue;
    }
    const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    const content = (row as { full_content?: string } | null)?.full_content ?? "";

    // Which folders does this doc land in? (one per project, or root.)
    const { data: memberships } = await client.raw
      .from("cerefox_document_projects")
      .select("project_id")
      .eq("document_id", doc.id);
    const projectIds = projectFilterId
      ? [projectFilterId]
      : (memberships ?? []).map((m) => (m as { project_id: string }).project_id);

    const folders: string[] =
      projectIds.length > 0
        ? projectIds.map((pid) => join(args.target!, slugify(projectName.get(pid) ?? "unknown-project")))
        : [args.target!]; // orphan → root

    const titleSlug = slugify(doc.title);
    for (const folder of folders) {
      mkdirSync(folder, { recursive: true });
      const filename = uniqueFilename(titleSlug, usedFor(folder));
      writeFileSync(join(folder, filename), content, "utf8");
      written++;
    }
  }

  println("");
  println(c.green(`✓  Wrote ${written} file(s)${failed > 0 ? c.yellow(` (${failed} failed)`) : ""}.`));
  process.exit(failed > 0 ? EXIT_SYSTEM_ERROR : EXIT_OK);
}

// Only run when executed directly (`bun scripts/cerefox_export.ts …`), not
// when imported by a unit test for `slugify` / `uniqueFilename`.
if (import.meta.main) {
  main().catch((err) => {
    errorln(err instanceof Error ? err.message : String(err));
    process.exit(EXIT_SYSTEM_ERROR);
  });
}
