/**
 * Keys a real response carries that its zod schema does not document.
 *
 * `safeParse` strips unknown keys and succeeds, so a schema that OMITS a field
 * the server sends passes every parse. That is how `GET /documents/{id}` went
 * out documented without `content_hash` — the one field a caller needs to
 * satisfy the concurrency contract (#296). This walks the schema and the value
 * together and names every key the document does not mention.
 */

type Def = {
  type: string;
  shape?: Record<string, unknown>;
  innerType?: unknown;
  element?: unknown;
  options?: unknown[];
};
const defOf = (s: unknown): Def => (s as { _zod: { def: Def } })._zod.def;

export function undocumentedKeys(schema: unknown, value: unknown, path = ""): string[] {
  let def = defOf(schema);
  while (["optional", "nullable", "default", "prefault", "readonly"].includes(def.type)) {
    def = defOf(def.innerType);
  }
  if (def.type === "union") {
    // The branch that documents the most of this value is the one it is.
    const tries = (def.options ?? []).map((o) => undocumentedKeys(o, value, path));
    return tries.sort((a, b) => a.length - b.length)[0] ?? [];
  }
  if (def.type === "array" && Array.isArray(value)) {
    return value.flatMap((v, i) => undocumentedKeys(def.element, v, `${path}[${i}]`));
  }
  if (def.type !== "object" || value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const shape = def.shape ?? {};
  const out: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in shape)) out.push(p);
    else out.push(...undocumentedKeys(shape[k], v, p));
  }
  return out;
}
