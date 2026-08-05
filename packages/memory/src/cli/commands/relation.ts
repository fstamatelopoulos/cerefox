/**
 * `cerefox relation set|delete|list|neighbors` — the document graph from the CLI
 * (iteration 29).
 *
 * Thin wrappers over the same RPCs the MCP tools call, so the CLI and agents
 * see identical behaviour: the type dictionary (symmetric types, lifecycle
 * side effects) lives in SQL, not here.
 */

import type { Command } from "commander";

import {
  c,
  printJson,
  println,
  resolveAuthor,
  resolveAuthorType,
  userError,
  warn,
} from "../../../../../_shared/cli-core/index.ts";
import { getClient } from "../util/client.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string, field: string): string {
  const v = value.trim();
  if (!UUID_RE.test(v)) {
    throw userError(
      `${field} must be a document UUID (got: ${value}).`,
      "Search for the document first — results show `[id: <uuid>]`.",
    );
  }
  return v;
}

interface RelationRow {
  direction: string;
  rel_type: string;
  other_id: string;
  other_title: string;
  other_lifecycle: string;
}

interface NeighborRow {
  document_id: string;
  title: string;
  lifecycle_status: string;
  depth: number;
  direction: string;
}

export function registerRelationSet(program: Command): void {
  program
    .command("set <source-id> <rel-type> <target-id>")
    .description("Link two documents: <source> --<rel-type>--> <target>.")
    .option("--meta <json>", "JSON metadata for the edge (note, confidence, …).")
    .option("--author <name>", "Who is creating this relation.")
    .option("--json", "Emit machine-readable JSON.")
    .action(
      async (
        sourceId: string,
        relType: string,
        targetId: string,
        options: { meta?: string; author?: string; json?: boolean },
      ) => {
        const source = requireUuid(sourceId, "source-id");
        const target = requireUuid(targetId, "target-id");
        if (!relType.trim()) throw userError("rel-type is required.");

        let metadata: unknown = {};
        if (options.meta) {
          try {
            metadata = JSON.parse(options.meta);
          } catch {
            throw userError(`--meta must be valid JSON (got: ${options.meta})`);
          }
        }

        const author = resolveAuthor(options.author);
        const authorType = resolveAuthorType(undefined);
        if (author === "unknown") {
          warn("No --author / CEREFOX_AUTHOR_NAME set — audit log will record this write as 'unknown'.");
        }
        const client = getClient();
        const data = await client.rpc<Array<{ is_symmetric: boolean }>>(
          "cerefox_set_relation",
          {
            p_source_id: source,
            p_target_id: target,
            p_rel_type: relType.trim(),
            p_author: author,
            p_author_type: authorType,
            p_metadata: metadata,
          },
        );
        const symmetric = Boolean(data?.[0]?.is_symmetric);

        if (options.json) {
          printJson({ source, target, rel_type: relType.trim(), symmetric });
          return;
        }
        println(
          c.green("✓ ") +
            `${source} --${relType.trim()}--> ${target}` +
            (symmetric ? c.dim(" (symmetric — reverse edge written too)") : ""),
        );
        if (relType.trim() === "supersedes") println(c.dim("  Target marked superseded."));
        if (relType.trim() === "contradicts") println(c.dim("  Both documents marked stale."));
      },
    );
}

export function registerRelationDelete(program: Command): void {
  program
    .command("delete <source-id> <rel-type> <target-id>")
    .description("Remove a relation (symmetric types remove both directions).")
    .option("--author <name>", "Who is removing this relation.")
    .action(
      async (
        sourceId: string,
        relType: string,
        targetId: string,
        options: { author?: string },
      ) => {
        const source = requireUuid(sourceId, "source-id");
        const target = requireUuid(targetId, "target-id");
        const author = resolveAuthor(options.author);
        const authorType = resolveAuthorType(undefined);
        if (author === "unknown") {
          warn("No --author / CEREFOX_AUTHOR_NAME set — audit log will record this write as 'unknown'.");
        }
        const client = getClient();
        const removed = await client.rpc<number>("cerefox_delete_relation", {
          p_source_id: source,
          p_target_id: target,
          p_rel_type: relType.trim(),
          p_author: author,
          p_author_type: authorType,
        });
        if (!removed) {
          println(c.dim("(no such relation — nothing removed)"));
          return;
        }
        println(c.green("✓ ") + `Removed ${removed} relation row(s).`);
        println(
          c.dim("  Lifecycle status left as-is — a document may be superseded by something else."),
        );
      },
    );
}

export function registerRelationList(program: Command): void {
  program
    .command("list <document-id>")
    .description("Show every relation touching a document (both directions).")
    .option("--json", "Emit machine-readable JSON.")
    .action(async (documentId: string, options: { json?: boolean }) => {
      const id = requireUuid(documentId, "document-id");
      const client = getClient();
      const rows = (await client.rpc<RelationRow[]>("cerefox_get_relations", {
        p_document_id: id,
      })) ?? [];

      if (options.json) {
        printJson(rows);
        return;
      }
      if (rows.length === 0) {
        println(c.dim("(no relations)"));
        return;
      }
      for (const r of rows) {
        const arrow = r.direction === "outbound" ? "→" : "←";
        const life =
          r.other_lifecycle && r.other_lifecycle !== "active"
            ? c.yellow(` [${r.other_lifecycle}]`)
            : "";
        println(
          `  ${arrow} ${c.bold(r.rel_type)}  ${r.other_title}${life} ${c.dim(`[id: ${r.other_id}]`)}`,
        );
      }
    });
}

export function registerRelationNeighbors(program: Command): void {
  program
    .command("neighbors <document-id> <rel-type>")
    .description("Walk the graph from a document along one relation type.")
    .option("-d, --depth <n>", "Hops to follow (1–5).", "1")
    .option("-l, --limit <n>", "Max documents to return.", "50")
    .option("--json", "Emit machine-readable JSON.")
    .action(
      async (
        documentId: string,
        relType: string,
        options: { depth?: string; limit?: string; json?: boolean },
      ) => {
        const id = requireUuid(documentId, "document-id");
        const depth = Number.parseInt(options.depth ?? "1", 10);
        const limit = Number.parseInt(options.limit ?? "50", 10);
        if (Number.isNaN(depth) || depth < 1 || depth > 5) {
          throw userError("--depth must be between 1 and 5.");
        }
        const client = getClient();
        const rows = (await client.rpc<NeighborRow[]>("cerefox_get_neighbors", {
          p_document_id: id,
          p_rel_type: relType.trim(),
          p_depth: depth,
          p_limit: Number.isNaN(limit) ? 50 : limit,
        })) ?? [];

        if (options.json) {
          printJson(rows);
          return;
        }
        if (rows.length === 0) {
          println(c.dim(`(nothing reachable via "${relType.trim()}")`));
          return;
        }
        for (const r of rows) {
          const life =
            r.lifecycle_status && r.lifecycle_status !== "active"
              ? c.yellow(` [${r.lifecycle_status}]`)
              : "";
          println(
            `  ${c.dim(`depth ${r.depth}`)} ${r.direction === "outbound" ? "→" : "←"} ` +
              `${r.title}${life} ${c.dim(`[id: ${r.document_id}]`)}`,
          );
        }
      },
    );
}

// Kept for symmetry with other command modules; the group is assembled in program.ts.
export function registerRelation(program: Command): void {
  registerRelationSet(program);
  registerRelationDelete(program);
  registerRelationList(program);
  registerRelationNeighbors(program);
}
