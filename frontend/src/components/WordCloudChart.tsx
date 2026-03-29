import { useMantineColorScheme } from "@mantine/core";
import { Text } from "@mantine/core";

interface WordCloudData {
  text: string;
  value: number;
}

interface WordCloudChartProps {
  data: WordCloudData[];
}

/**
 * Simple word cloud using CSS positioning. Avoids react-d3-cloud which
 * doesn't support React 19. Words are positioned in a centered flex layout
 * with font size proportional to the value.
 */
export function WordCloudChart({ data }: WordCloudChartProps) {
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  if (data.length === 0) {
    return <Text c="dimmed" size="sm">No reader data available.</Text>;
  }

  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const minVal = Math.min(...data.map((d) => d.value), 0);
  const range = maxVal - minVal || 1;

  const COLORS = dark
    ? ["#74c0fc", "#63e6be", "#ffa94d", "#da77f2", "#66d9e8", "#ff8787", "#a9e34b"]
    : ["#1c7ed6", "#0ca678", "#e67700", "#9c36b5", "#0c8599", "#e03131", "#5c940d"];

  // Sort by value descending so largest words are in the center
  const sorted = [...data].sort((a, b) => b.value - a.value);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: 8,
        padding: 16,
        minHeight: 150,
      }}
    >
      {sorted.map((word, i) => {
        const normalized = (word.value - minVal) / range;
        const fontSize = Math.round(14 + normalized * 40); // 14px to 54px
        const color = COLORS[i % COLORS.length];
        return (
          <span
            key={word.text}
            style={{
              fontSize,
              fontWeight: normalized > 0.5 ? 700 : 500,
              color,
              lineHeight: 1.2,
              cursor: "default",
            }}
            title={`${word.text}: ${word.value} calls`}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
}
