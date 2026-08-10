/**
 * `document ingest` must not relabel a document's provenance just because the
 * user did not pass `--source` (#193).
 *
 * #191 fixed the RPC for callers that OMIT the parameter: `p_source` defaults
 * to NULL and the update branch coalesces, so the stored value survives. The
 * CLI never omitted it — commander declared `--source` with a default of "cli"
 * and the handler always sent it, so every re-ingest silently rewrote the
 * origin of a document that came from somewhere else.
 *
 * The gap was therefore ABOVE the RPC, which is why this is tested at the
 * option layer rather than against the database: an RPC-level test passed the
 * whole time the bug was live.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(import.meta.dir, "..", "src", "cli", "commands", "ingest.ts"),
  "utf8",
);

describe("--source default (#193)", () => {
  test("commander declares no default value for --source", () => {
    // The third argument to .option() is the default. Its presence is the bug:
    // with it, `options.source` is never undefined, so "the user omitted it"
    // becomes unrepresentable.
    const decl = SRC.slice(SRC.indexOf('"--source <label>"'));
    const call = decl.slice(0, decl.indexOf(")"));
    expect(call).not.toContain('"cli"');
  });

  test("the handler distinguishes update intent from create", () => {
    // On update, omitting --source must send null so the RPC keeps the stored
    // value. On create there is nothing to keep, and "cli" is the honest label
    // — null would fall through to the RPC's 'agent' default and mislabel it.
    expect(SRC).toContain("isUpdateIntent");
    expect(SRC).toMatch(/options\.source \?\? \(isUpdateIntent \? null : "cli"\)/);
  });

  test("no call site re-introduces a fallback that erases the null", () => {
    // `options.source ?? "cli"` at the call site would undo the fix silently.
    expect(SRC).not.toMatch(/source:\s*options\.source\s*\?\?\s*"cli"/);
  });

  test("the create path surfaces content_hash (#189 on the CLI)", () => {
    // The MCP tool returned the hash on create from v1.3.0; the CLI did not,
    // so a user who created a document had no token for its first edit.
    expect(SRC).toContain("result.contentHash");
  });
});
