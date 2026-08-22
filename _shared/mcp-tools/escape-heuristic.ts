/**
 * Escaped-content heuristic (#222, v1.10.1) — a dependency-free leaf module.
 *
 * Agents authoring long multi-line bodies inline in a tool call occasionally
 * JSON-escape a stretch one level too many, so the stored content carries the
 * literal two-character sequences `\n` and `\"` where newlines and quotes
 * were meant. Cerefox stores bytes faithfully (verified at the byte level),
 * so the ONLY defensible response is a WARNING, never normalization:
 * auto-converting would corrupt content that legitimately discusses escape
 * sequences and would mask the emitting client's bug.
 *
 * The trigger is a RATIO, not an absolute count — calibrated on real data:
 * legitimately-escaping documents (guides discussing `\n`) sit far below 1%
 * literals-to-real-newlines, while observed corruption ran 50–70%. Threshold:
 * at least 3 literal sequences AND literals ≥ 25% of real newlines.
 */

export interface EscapeSuspicion {
  literalNewlines: number;
  literalQuotes: number;
  realNewlines: number;
}

export function measureEscapes(content: string): EscapeSuspicion {
  return {
    literalNewlines: (content.match(/\\n/g) ?? []).length,
    literalQuotes: (content.match(/\\"/g) ?? []).length,
    realNewlines: (content.match(/\n/g) ?? []).length,
  };
}

/**
 * The non-blocking note to append to a write response, or "" when the
 * content looks fine — an empty string appends as nothing and stays falsy,
 * so callers concatenate directly with no `?? ""` dance (review round 1:
 * forgetting it would interpolate the literal string "null"). A signal in
 * the write's response, never a refusal — the iteration-33 posture.
 *
 * The remedy clause is channel-aware: the MCP tail names MCP tools; the CLI
 * tail must not tell a user who just ingested a file to "prefer ingesting
 * from a file".
 */
export function escapedContentNote(content: string, channel: "mcp" | "cli" = "mcp"): string {
  const m = measureEscapes(content);
  const literals = m.literalNewlines + m.literalQuotes;
  if (literals < 3 || literals * 4 < m.realNewlines) return "";
  const parts = [
    m.literalNewlines > 0 ? `${m.literalNewlines} literal \\n` : null,
    m.literalQuotes > 0 ? `${m.literalQuotes} literal \\"` : null,
  ].filter(Boolean);
  const remedy =
    channel === "cli"
      ? `fix the escaping in the source and re-ingest.`
      : `re-send with actual characters. For long content, prefer ` +
        `ingesting from a file or building the document incrementally with ` +
        `cerefox_insert/cerefox_edit.`;
  return (
    ` Note: content contains ${parts.join(" and ")} sequence(s) against ` +
    `${m.realNewlines} real newline(s) — if line breaks or quotes were ` +
    `intended, ` + remedy
  );
}
