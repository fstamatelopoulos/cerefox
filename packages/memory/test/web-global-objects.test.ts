/**
 * Starting the web server must leave the process-wide Request/Response alone.
 *
 * @hono/node-server replaces them with lightweight versions by default. The
 * local embedder downloads its model via transformers.js, which builds its file
 * cache from those globals; with Hono's versions installed the download
 * "completed", cached nothing, and every write failed ("Unable to get model
 * file path or buffer") on a store whose first model download happened inside
 * the web server. Reproduced on every Local image from v1.0.1 to v1.16.0 and on
 * an npm install; proven by toggling this one option. A full reproduction needs
 * a 131 MB download, so this guards the cause instead.
 */

import { expect, test } from "bun:test";

import { buildWebServer } from "../src/web/server.ts";

test("cerefox web does not replace the global Request/Response", async () => {
  const [Req, Res] = [globalThis.Request, globalThis.Response];
  const server = await buildWebServer({ host: "127.0.0.1", port: 0 });
  try {
    expect(globalThis.Response).toBe(Res);
    expect(globalThis.Request).toBe(Req);
  } finally {
    await server.close();
  }
});
