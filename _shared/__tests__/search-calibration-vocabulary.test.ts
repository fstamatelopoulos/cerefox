/**
 * Integrity of the search-calibration vocabulary (iteration 48). The benchmark's
 * numbers are only as good as its labels, so the cheap lexical facts the labels
 * rely on are checked here rather than trusted.
 */

import { describe, expect, test } from "bun:test";

import corpus from "../search-benchmark/vocabulary/corpus.json";
import queries from "../search-benchmark/vocabulary/queries.json";

interface Query { id: string; category: string; text: string; relevant: Record<string, number>; group?: string | null }

const CATEGORIES = [
  "exact_title", "distinctive_keyword", "multi_word_topic", "paraphrase", "abbreviation", "short_name",
  "misspelling", "word_order", "inflection", "question", "identifier", "long_query", "negative",
];
const docs = new Map(corpus.map((d) => [d.key, d]));
const qs = queries as Query[];

describe("corpus", () => {
  test("keys and titles are unique; content starts with its title", () => {
    expect(docs.size).toBe(corpus.length);
    expect(new Set(corpus.map((d) => d.title.toLowerCase())).size).toBe(corpus.length);
    for (const d of corpus) expect(d.content.startsWith(`# ${d.title}\n`)).toBe(true);
  });
});

describe("queries", () => {
  test("ids and texts are unique; categories are known and all used", () => {
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
    expect(new Set(qs.map((q) => q.text.trim().toLowerCase())).size).toBe(qs.length);
    expect([...new Set(qs.map((q) => q.category))].sort()).toEqual([...CATEGORIES].sort());
  });

  test("labels point at real documents with grade 1 or 2", () => {
    for (const q of qs) {
      for (const [k, g] of Object.entries(q.relevant)) {
        expect(docs.has(k)).toBe(true);
        expect([1, 2]).toContain(g);
      }
    }
  });

  test("every answerable query has a grade-2 document; negatives have no labels", () => {
    for (const q of qs) {
      if (q.category === "negative") expect(Object.keys(q.relevant)).toEqual([]);
      else expect(Object.values(q.relevant)).toContain(2);
    }
  });

  test("each variant group has 2+ queries sharing a grade-2 document", () => {
    const groups = new Map<string, Query[]>();
    for (const q of qs) if (q.group) groups.set(q.group, [...(groups.get(q.group) ?? []), q]);
    for (const [, members] of groups) {
      expect(members.length).toBeGreaterThanOrEqual(2);
      const shared = Object.keys(members[0]!.relevant).filter((k) => members.every((m) => m.relevant[k] === 2));
      expect(shared.length).toBeGreaterThan(0);
    }
  });

  test("exact titles are verbatim; keywords and identifiers occur in their documents", () => {
    for (const q of qs) {
      const twos = Object.keys(q.relevant).filter((k) => q.relevant[k] === 2);
      if (q.category === "exact_title") expect(twos.some((k) => docs.get(k)!.title === q.text)).toBe(true);
      if (q.category === "distinctive_keyword") {
        for (const k of twos) expect(docs.get(k)!.content.toLowerCase()).toContain(q.text.toLowerCase());
      }
      if (q.category === "identifier") {
        const ident = q.text.startsWith("HTTP") ? q.text.split(" ")[1]! : q.text.split(" ")[0]!;
        for (const k of Object.keys(q.relevant)) expect(docs.get(k)!.content).toContain(ident);
      }
    }
  });

  test("long queries are long", () => {
    for (const q of qs.filter((x) => x.category === "long_query")) expect(q.text.split(/\s+/).length).toBeGreaterThanOrEqual(15);
  });

  test("a paraphrase shares no content word with its target (else it measures keywords)", () => {
    const FUNCTION_WORDS = new Set(["before", "after", "with", "from", "into", "about", "rules"]);
    for (const q of qs.filter((x) => x.category === "paraphrase")) {
      for (const k of Object.keys(q.relevant).filter((key) => q.relevant[key] === 2)) {
        const words = new Set(docs.get(k)!.content.toLowerCase().match(/[a-z]+/g));
        const shared = (q.text.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 4 && !FUNCTION_WORDS.has(w) && words.has(w));
        expect({ id: q.id, shared }).toEqual({ id: q.id, shared: [] });
      }
    }
  });

  test("negatives are not fully matched by any document", () => {
    for (const q of qs.filter((x) => x.category === "negative")) {
      const terms = q.text.toLowerCase().match(/[a-z0-9-]+/g) ?? [];
      for (const d of corpus) {
        const text = d.content.toLowerCase();
        expect({ id: q.id, doc: d.key, all: terms.every((t) => text.includes(t)) }).toEqual({ id: q.id, doc: d.key, all: false });
      }
    }
  });
});
