import { describe, expect, test } from "bun:test";
import {
  duplicateContentDocumentId,
  legacyContentUniqueError,
} from "../mcp-tools/_utils.ts";

// #334 review: a create that loses the duplicate race is RAISED by the RPC
// (so a 1.18 client cannot mistake the winner for its own create), and a
// current client meeting a pre-0.20.0 server sees its old store-wide
// constraint. Both arrive as plain PostgREST messages.
describe("duplicate-content error mapping", () => {
  const id = "0b4f3c2a-1d2e-4f5a-9b8c-7d6e5f4a3b2c";

  test("extracts the existing document id from CEREFOX_DUPLICATE_CONTENT", () => {
    expect(
      duplicateContentDocumentId(
        `CEREFOX_DUPLICATE_CONTENT: document ${id} already has this content; nothing was written`,
      ),
    ).toBe(id);
  });

  test("ignores other errors, including other 23505s", () => {
    expect(duplicateContentDocumentId(`CEREFOX_DELETED: document ${id} is soft-deleted`)).toBeNull();
    expect(
      duplicateContentDocumentId('duplicate key value violates unique constraint "cerefox_projects_name_key"'),
    ).toBeNull();
  });

  test("maps the old server's constraint to a server-deploy instruction", () => {
    const err = legacyContentUniqueError(
      'duplicate key value violates unique constraint "cerefox_documents_hash_unique"',
    );
    expect(err?.message).toContain("cerefox server deploy");
    expect(err?.message).toContain("0.20.0");
  });

  test("leaves unrelated constraint errors alone", () => {
    expect(
      legacyContentUniqueError('duplicate key value violates unique constraint "cerefox_projects_name_key"'),
    ).toBeNull();
  });
});
