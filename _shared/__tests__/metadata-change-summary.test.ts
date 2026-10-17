/** The audit-log metadata diff (#333). */
import { describe, expect, test } from "bun:test";
import { metadataChangeSummary } from "../mcp-tools/audit-ops.ts";

describe("metadataChangeSummary", () => {
  test("set and removed keys, in one line", () => {
    expect(metadataChangeSummary({ a: "1", gone: "x" }, { a: "2", b: "3" })).toBe(
      "set a=2, b=3; removed gone",
    );
  });

  test("a removed key named like an Object.prototype member is still reported", () => {
    expect(metadataChangeSummary({ constructor: "x", toString: "y" }, {})).toBe(
      "removed constructor, toString",
    );
  });

  test("no change, or no history (older entries), is null", () => {
    expect(metadataChangeSummary({ a: "1" }, { a: "1" })).toBeNull();
    expect(metadataChangeSummary(null, null)).toBeNull();
  });

  test("non-string values render as JSON", () => {
    expect(metadataChangeSummary({}, { n: 2, l: ["a"] })).toBe('set n=2, l=["a"]');
  });
});
