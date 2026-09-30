/**
 * The "update_if_exists flag was overridden" note on an update by document_id.
 *
 * It names a flag the caller SET to false and that document_id then overrode.
 * It used to fire whenever the flag was not true, including when it was never
 * sent, so every update by id (the recommended workflow) carried a warning.
 * The database bridge and updateDocument are stubbed: this is about which
 * input produces the note, not about the write.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";

import { IngestionPipeline } from "../../src/ingestion/pipeline.ts";

const DOC = "11111111-1111-1111-1111-111111111111";
const restores: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  while (restores.length) restores.pop()!.mockRestore();
});

async function noteFor(updateExisting: boolean | undefined): Promise<string | undefined> {
  const pipeline = new IngestionPipeline({ supabase: {} as never, openAiApiKey: "sk-test" });
  restores.push(
    spyOn(pipeline.db, "getDocumentById").mockResolvedValue({ id: DOC, title: "T" } as never),
    spyOn(pipeline, "updateDocument").mockResolvedValue({ documentId: DOC, title: "T", action: "updated" } as never),
  );
  const result = await pipeline.ingestText({
    text: "body",
    title: "T",
    documentId: DOC,
    lastWriteWins: true,
    ...(updateExisting === undefined ? {} : { updateExisting }),
  });
  return result.note;
}

describe("update by document_id: the override note", () => {
  test("absent when update_if_exists was not sent", async () => {
    expect(await noteFor(undefined)).toBeUndefined();
  });
  test("absent when update_if_exists was true", async () => {
    expect(await noteFor(true)).toBeUndefined();
  });
  test("present when the caller explicitly sent false", async () => {
    expect(await noteFor(false)).toContain("update_if_exists flag was overridden");
  });
});
