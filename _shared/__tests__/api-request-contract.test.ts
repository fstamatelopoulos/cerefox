/**
 * Every input an `/api/v1` handler reads is documented, and nothing is
 * documented that no handler reads (#296).
 *
 * The first published OpenAPI document listed path parameters only. Every
 * query parameter, the delete route's hash header and the identity headers
 * were missing, so a caller doing what the document said met refusals it could
 * not explain. And the `/ingest` body described six fields the route ignored,
 * which is worse: `update_if_exists` was silently dropped, so a caller asking
 * for an update got a second document.
 *
 * Both directions matter, and both are checked here, against the inputs the
 * generator DERIVES from the handler source (`deriveInputs`), not against a
 * list someone maintains.
 */

import { describe, expect, test } from "bun:test";

import {
  FORM_BODIES,
  HEADER_DOCS,
  QUERY_DOCS,
  RESPONSE_HEADER_DOCS,
  ROUTE_SCHEMAS,
  deriveInputs,
  normalise,
  registeredRoutes,
  routeInputs,
  toJsonSchema,
} from "../openapi/index.ts";

const IDENTITY = ["author", "requestor", "author_type"];
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

const routes = registeredRoutes().filter((r) => r.source !== "");
const withInputs = routes.map((r) => ({ key: normalise(r.method, r.path), route: r, inputs: routeInputs(r) }));

/** Does the handler read identity from its body/form, not only headers? */
const identityInBody = (src: string) => /resolveCallerIdentity\(\s*c\s*,\s*(body|form)\b/.test(src);

describe("the derivation itself", () => {
  test("fires on each shape it exists to catch", () => {
    // A guard that cannot fail is not a guard. Synthetic handler source with one
    // of everything; if a regex rots, this is where it shows.
    const src = `
      app.post("/api/v1/x", async (c) => {
        const a = c.req.query("zzz");
        const h = c.req.header("X-Some-Header");
        const body = await c.req.json();
        if (!SYNTH_FIELDS.has("k")) return c.json({ detail: "no" }, 418);
        const who = resolveCallerIdentity(c, body);
        use(body.qqq);
        c.header("X-Thing", "1");
        throw new HttpError(503, "down");
      });`;
    const file = `export const SYNTH_FIELDS = new Set(["qqq", "rrr"]);\n${src}`;
    const d = deriveInputs(src, file);
    expect(d.query).toEqual(["zzz"]);
    expect(d.headers).toEqual(["x-some-header"]);
    expect(d.bodyFields).toEqual(["qqq"]);
    expect(d.jsonBody).toBe(true);
    expect(d.identity).toBe(true);
    expect(d.statuses).toEqual(["418", "503"]);
    expect(d.responseHeaders).toEqual(["X-Thing"]);
    expect(d.allowList).toEqual(["qqq", "rrr"]);
    expect(deriveInputs(`const f = await c.req.parseBody(); use(form.file);`).formFields).toEqual(["file"]);
  });

  test("still matches a plausible amount of the real API", () => {
    // The other half of "a guard that cannot fail": if the handler style drifts
    // (say, `c.req.queries()`), the derivation silently finds nothing and every
    // both-directions check below passes vacuously.
    expect(routes.length).toBeGreaterThanOrEqual(38);
    expect(withInputs.reduce((n, r) => n + r.inputs.query.length, 0)).toBeGreaterThanOrEqual(35);
    expect(withInputs.filter((r) => r.inputs.identity).length).toBeGreaterThanOrEqual(15);
    expect(withInputs.filter((r) => r.inputs.statuses.length > 0).length).toBeGreaterThanOrEqual(25);
    expect(withInputs.filter((r) => r.inputs.jsonBody).length).toBeGreaterThanOrEqual(8);
    expect(withInputs.filter((r) => r.inputs.allowList).length).toBeGreaterThanOrEqual(2);
  });
});

describe("query and header parameters", () => {
  test("every query parameter a handler reads is documented, and nothing else", () => {
    const wrong: string[] = [];
    for (const { key, inputs } of withInputs) {
      const read = sorted(inputs.query);
      const documented = sorted(Object.keys(QUERY_DOCS[key] ?? {}));
      if (read.join() !== documented.join()) wrong.push(`${key}: reads [${read}] documents [${documented}]`);
    }
    expect(wrong).toEqual([]);
  });

  test("QUERY_DOCS names no route that does not exist", () => {
    const live = new Set(withInputs.map((r) => r.key));
    expect(Object.keys(QUERY_DOCS).filter((k) => !live.has(k))).toEqual([]);
  });

  test("every non-identity request header is documented, and every documented one is read", () => {
    const read = sorted(withInputs.flatMap((r) => r.inputs.headers));
    expect(read).toEqual(sorted(Object.keys(HEADER_DOCS)));
  });

  test("every response header a handler sets is documented", () => {
    const set = sorted(withInputs.flatMap((r) => r.inputs.responseHeaders));
    expect(set).toEqual(sorted(Object.keys(RESPONSE_HEADER_DOCS)));
  });
});

describe("request bodies", () => {
  const props = (key: string) =>
    Object.keys(
      (toJsonSchema(ROUTE_SCHEMAS[key]!.request!, "input") as { properties?: Record<string, unknown> }).properties ??
        {},
    );

  test("a route reads a JSON body if and only if it documents one", () => {
    const reads = sorted(withInputs.filter((r) => r.inputs.jsonBody).map((r) => r.key));
    const documents = sorted(Object.entries(ROUTE_SCHEMAS).filter(([, m]) => m.request).map(([k]) => k));
    expect(documents).toEqual(reads);
  });

  test("each JSON body documents exactly the fields its handler accepts", () => {
    const wrong: string[] = [];
    for (const { key, route, inputs } of withInputs.filter((r) => r.inputs.jsonBody)) {
      const accepted = sorted(
        inputs.allowList ?? [...inputs.bodyFields, ...(identityInBody(route.source) ? IDENTITY : [])],
      );
      const documented = sorted(props(key));
      if (accepted.join() !== documented.join()) {
        wrong.push(`${key}: accepts [${accepted}] documents [${documented}]`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("a runtime allow-list covers every field the handler actually reads", () => {
    // The allow-list is what the route enforces; if the handler grew a read the
    // list lacks, every caller sending that field would be refused.
    const wrong: string[] = [];
    for (const { key, route, inputs } of withInputs.filter((r) => r.inputs.allowList)) {
      const reads = [...inputs.bodyFields, ...(identityInBody(route.source) ? IDENTITY : [])];
      const missing = reads.filter((f) => !inputs.allowList!.includes(f));
      if (missing.length) wrong.push(`${key}: reads but refuses [${missing}]`);
    }
    expect(wrong).toEqual([]);
  });

  test("a route with a runtime allow-list documents additionalProperties: false", () => {
    for (const { key } of withInputs.filter((r) => r.inputs.allowList)) {
      const schema = toJsonSchema(ROUTE_SCHEMAS[key]!.request!, "input") as { additionalProperties?: unknown };
      expect({ key, additionalProperties: schema.additionalProperties }).toEqual({ key, additionalProperties: false });
    }
  });

  test("each multipart body documents exactly the form fields its handler reads", () => {
    const reads = sorted(withInputs.filter((r) => r.inputs.formBody).map((r) => r.key));
    expect(sorted(Object.keys(FORM_BODIES))).toEqual(reads);
    const wrong: string[] = [];
    for (const { key, route, inputs } of withInputs.filter((r) => r.inputs.formBody)) {
      const accepted = sorted([...inputs.formFields, ...(identityInBody(route.source) ? IDENTITY : [])]);
      const documented = sorted(Object.keys(FORM_BODIES[key]!.properties));
      if (accepted.join() !== documented.join()) wrong.push(`${key}: reads [${accepted}] documents [${documented}]`);
    }
    expect(wrong).toEqual([]);
  });
});
