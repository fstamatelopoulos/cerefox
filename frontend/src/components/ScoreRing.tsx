import type { ScoreTone } from "../lib/scoreBands";

const TONE_COLOR: Record<ScoreTone, string> = {
  strong: "var(--green)",
  typical: "var(--yellow)",
  weak: "var(--text-faint)",
  dim: "var(--text-faint)",
};

/**
 * Search score ring (SVG donut). The number is the score x 100; the color comes
 * from `scoreTone` (lib/scoreBands.ts), which compares it with the scores of
 * results that turned out right. A dimmed ring marks a below-confidence result.
 */
export function ScoreRing({ score, tone, size = 38 }: { score: number; tone: ScoreTone; size?: number }) {
  const clamped = Math.max(0, Math.min(1, score));
  const pct = Math.round(clamped * 100);
  const r = (size - 5) / 2;
  const circ = 2 * Math.PI * r;
  const col = TONE_COLOR[tone];
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0, opacity: tone === "dim" ? 0.55 : 1 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={2.5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={col}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - clamped)}
          style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.7,.3,1)" }}
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          fontFamily: "var(--font-mono)",
          fontSize: size > 34 ? 11 : 9.5,
          fontWeight: 600,
          color: col,
        }}
      >
        {pct}
      </span>
    </div>
  );
}
