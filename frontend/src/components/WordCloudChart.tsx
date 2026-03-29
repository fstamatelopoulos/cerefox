import { useMantineColorScheme } from "@mantine/core";
import WordCloud from "react-d3-cloud";
import { useCallback } from "react";

interface WordCloudData {
  text: string;
  value: number;
}

interface WordCloudChartProps {
  data: WordCloudData[];
  width?: number;
  height?: number;
}

export function WordCloudChart({ data, width = 400, height = 250 }: WordCloudChartProps) {
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  // Scale font size based on value range
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const minVal = Math.min(...data.map((d) => d.value), 0);
  const range = maxVal - minVal || 1;

  const fontSize = useCallback(
    (word: WordCloudData) => {
      const normalized = (word.value - minVal) / range;
      return Math.round(16 + normalized * 48); // 16px to 64px
    },
    [minVal, range],
  );

  const COLORS = dark
    ? ["#74c0fc", "#63e6be", "#ffa94d", "#da77f2", "#66d9e8", "#ff8787", "#a9e34b"]
    : ["#1c7ed6", "#0ca678", "#e67700", "#9c36b5", "#0c8599", "#e03131", "#5c940d"];

  const fill = useCallback(
    (_word: WordCloudData, i: number) => COLORS[i % COLORS.length],
    [COLORS],
  );

  return (
    <WordCloud
      data={data}
      width={width}
      height={height}
      fontSize={fontSize}
      fill={fill}
      rotate={0}
      padding={3}
      font="Inter, sans-serif"
    />
  );
}
