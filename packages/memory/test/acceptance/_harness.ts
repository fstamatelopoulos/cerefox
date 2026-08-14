/**
 * A committed acceptance harness, with cleanup built in.
 *
 * Every release so far has been validated by a throwaway script written that
 * session — `prod-round2.ts`, `stg140.js`, `cli140.sh`. Each was meant to be
 * temporary and none had teardown, so each left documents behind: four on
 * staging after v1.4.0, and twice in production before the write-guard existed.
 * The recurring cost is not a missing feature but a harness that gets
 * re-invented, with cleanup as the part that gets dropped.
 *
 * So it lives here, and the teardown is the harness's job rather than the
 * caller's.
 *
 * ## Cleanup contract
 *
 * Deleting fixtures goes **through** the safety gate, not around it:
 *
 * 1. `document delete` — a soft delete, which is all the CLI can do.
 * 2. `cerefox_purge_document` — which refuses anything not already soft-deleted
 *    (`WHERE id = … AND deleted_at IS NOT NULL`). A mis-scoped id can therefore
 *    only ever hit something already in the trash.
 * 3. Delete the now-orphaned audit rows for those same ids. The RPC preserves
 *    them by design — right for a real purge, whose record should outlive the
 *    document, and litter for a fixture that lived four seconds.
 *
 * The existing suites instead do raw four-table deletes, which is faster and
 * removes audit rows in one pass, but skips the gate entirely — nothing stops a
 * bad id list. This route was chosen because the gate exists specifically to
 * defend against an agent deleting the wrong thing.
 *
 * Only ids this run created are touched. Never a title-prefix sweep: that would
 * catch a concurrent run's fixtures, or anything a human happened to title
 * similarly.
 */

import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";

import { mayWriteToLiveTarget } from "../_live-target-guard.ts";
import { createClient } from "../../../../_shared/db-client/index.ts";
import { loadSettings } from "../../../../_shared/config/index.ts";

const PKG_ROOT = join(import.meta.dir, "..", "..");
export const BIN = join(PKG_ROOT, "dist", "bin", "cerefox.js");

/** Prefix for everything this harness creates, so leftovers are identifiable. */
export const PREFIX = "[E2E acceptance]";

export interface CliResult {
  out: string;
  code: number;
}

export class Acceptance {
  private readonly created: string[] = [];
  /** Distinguishes this run's fixtures from a concurrent run's. */
  private readonly runId = Math.random().toString(36).slice(2, 8);
  private seq = 0;
  private mcpProc: ChildProcessWithoutNullStreams | null = null;
  private buf = "";
  private nextId = 100;
  private readonly pending = new Map<number, (m: Record<string, unknown>) => void>();

  /** Run the built CLI. */
  cli(args: string[]): CliResult {
    const r = spawnSync("node", [BIN, ...args], { encoding: "utf8", maxBuffer: 40e6 });
    return { out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status ?? 1 };
  }

  /**
   * Refuse to touch an unlabelled target.
   *
   * The suite that drives this harness already checks, but a harness that can
   * create documents should not depend on every caller remembering to. Guarded
   * by construction is the whole point — the coverage test flagged this file
   * for exactly that reason, and exempting it would have been the wrong fix.
   */
  private assertSafeTarget(): void {
    if (!mayWriteToLiveTarget()) {
      throw new Error(
        "Acceptance harness refuses an unlabelled (production) target. " +
          "Set CEREFOX_CONFIG_DIR to a labelled environment, or " +
          "CEREFOX_ALLOW_PROD_WRITE_TESTS=1 if you truly mean production.",
      );
    }
  }

  /** Start the local MCP stdio server this package ships. */
  async startMcp(): Promise<void> {
    this.assertSafeTarget();
    this.mcpProc = spawn("node", [BIN, "mcp"], { stdio: ["pipe", "pipe", "ignore"] });
    this.mcpProc.stdout.on("data", (d: Buffer) => {
      this.buf += d.toString();
      let i: number;
      while ((i = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + 1);
        if (!line.trim()) continue;
        let m: Record<string, unknown>;
        try {
          m = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const resolve = this.pending.get(m.id as number);
        if (resolve) {
          this.pending.delete(m.id as number);
          resolve(m);
        }
      }
    });
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "acceptance", version: "1" },
    });
  }

  private rpc(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.mcpProc!.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  /** Call an MCP tool. Returns the text payload and whether it was an error. */
  async mcp(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    const m = await this.rpc("tools/call", {
      name,
      arguments: { requestor: "acceptance", ...args },
    });
    const result = m.result as { isError?: boolean; content?: Array<{ text?: string }> } | undefined;
    return { isError: result?.isError ?? false, text: result?.content?.[0]?.text ?? JSON.stringify(m) };
  }

  /**
   * Create a fixture document and register it for teardown.
   *
   * The content gets a per-fixture nonce appended. Cerefox refuses a write
   * whose content_hash already exists — correct, and it means two fixtures
   * sharing a template silently fail to seed, which reads as a feature failure
   * several assertions later. Deduplication is the store's job; giving each
   * fixture distinct content is the harness's.
   */
  async seed(name: string, content: string): Promise<{ id: string; hash: string }> {
    this.assertSafeTarget();
    this.seq += 1;
    const unique = `${content}\n<!-- acceptance fixture ${name} #${this.seq} ${this.runId} -->\n`;
    const r = await this.mcp("cerefox_ingest", {
      title: `${PREFIX} ${name} ${this.runId}`,
      content: unique,
      author: "acceptance",
    });
    const id = /id: ([0-9a-f-]{36})/.exec(r.text)?.[1];
    const hash = /content_hash: ([0-9a-f]{64})/.exec(r.text)?.[1];
    if (!id || !hash) throw new Error(`seed "${name}" failed: ${r.text.slice(0, 300)}`);
    // Register BEFORE any assertion can throw, so a failing test still cleans up.
    this.created.push(id);
    return { id, hash };
  }

  /** Register a document created OUTSIDE seed() (e.g. via a direct
   *  cerefox_ingest in a test) for the same teardown. */
  track(id: string): void {
    this.created.push(id);
  }

  /** Ids this run created, for assertions about cleanup. */
  get ids(): readonly string[] {
    return this.created;
  }

  /**
   * Remove every fixture this run created. Safe to call twice, and safe to call
   * when nothing was created.
   */
  async teardown(): Promise<{ purged: number; failed: string[] }> {
    this.mcpProc?.kill();
    this.mcpProc = null;
    if (this.created.length === 0) return { purged: 0, failed: [] };

    const failed: string[] = [];
    let purged = 0;
    try {
      const client = createClient(loadSettings());
      const raw = client.raw as unknown as {
        rpc: (n: string, a: Record<string, unknown>) => Promise<{ error: unknown }>;
        from: (t: string) => { delete: () => { in: (c: string, v: string[]) => Promise<unknown> } };
      };
      for (const id of this.created) {
        // Each fixture is isolated: one failure must not abandon the rest.
        // A shared try/catch left a single document behind when the loop threw
        // partway, and the surviving fixture is the one nobody notices.
        try {
          // 1. Soft delete, via the same RPC `document delete` calls. Spawning
          //    the CLI once per fixture is a process launch each and timed the
          //    teardown hook out at eight documents; the RPC is the identical
          //    operation without the overhead. Its error matters: an undeleted
          //    doc makes the purge below refuse, so surface the real failure.
          const del = await raw.rpc("cerefox_delete_document", {
            p_document_id: id,
            p_author: "acceptance",
            p_author_type: "agent",
          });
          if ((del as { error?: unknown }).error) {
            failed.push(id);
            continue;
          }
          // 2. Purge through the gate, which refuses anything not soft-deleted.
          //    ALL THREE args, always: long-lived databases carry an orphaned
          //    1-arg overload of this RPC from the pre-author era (CREATE OR
          //    REPLACE never dropped it), and a 1-arg call is ambiguous there
          //    (PGRST203) — which is how the first prod run left 13 fixtures
          //    behind. The named 3-arg call resolves uniquely everywhere.
          const { error } = await raw.rpc("cerefox_purge_document", {
            p_document_id: id,
            p_author: "acceptance",
            p_author_type: "agent",
          });
          if (error) failed.push(id);
          else purged++;
        } catch {
          failed.push(id);
        }
      }
      // 3. The audit rows the RPC deliberately keeps are litter for a fixture.
      //    Attempted regardless of individual purge failures. TWO passes: the
      //    purge CASCADE nulls audit.document_id (ON DELETE SET NULL), so the
      //    id-based delete misses rows for already-purged docs — the orphaned
      //    acceptance-authored rows are swept separately (64 accumulated in
      //    prod before this second pass existed).
      try {
        await raw.from("cerefox_audit_log").delete().in("document_id", this.created);
        await (raw.from("cerefox_audit_log").delete() as unknown as {
          is: (c: string, v: null) => { eq: (c: string, v: string) => Promise<unknown> };
        })
          .is("document_id", null)
          .eq("author", "acceptance");
      } catch {
        // Non-fatal: the documents are gone, which is what matters.
      }
    } catch {
      // Could not even build a client — report everything as unpurged rather
      // than throwing, since a teardown that throws masks the test's own
      // failure, which is the more useful signal.
      return { purged, failed: this.created.filter((id) => !failed.includes(id)) };
    }
    return { purged, failed };
  }
}
