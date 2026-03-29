import { useMantineColorScheme } from "@mantine/core";
import { Text } from "@mantine/core";
import * as d3 from "d3";
import { useEffect, useRef } from "react";

interface UsageEntry {
  requestor: string | null;
  operation: string;
}

interface HEBOperationChartProps {
  usageLog: UsageEntry[];
  width?: number;
  height?: number;
}

interface Link {
  requestor: string;
  operation: string;
  count: number;
}

export function HEBOperationChart({ usageLog, width = 400, height = 400 }: HEBOperationChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  // Build requestor -> operation links with counts
  const links: Link[] = [];
  const linkMap = new Map<string, number>();
  for (const entry of usageLog) {
    if (!entry.requestor) continue;
    const key = `${entry.requestor}|||${entry.operation}`;
    linkMap.set(key, (linkMap.get(key) ?? 0) + 1);
  }
  for (const [key, count] of linkMap) {
    const [requestor, operation] = key.split("|||");
    links.push({ requestor, operation, count });
  }

  const requestors = [...new Set(links.map((l) => l.requestor))];
  const operations = [...new Set(links.map((l) => l.operation))];

  useEffect(() => {
    if (!svgRef.current || links.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const allNodes = [
      ...requestors.map((r) => ({ id: r, group: "requestor" })),
      ...operations.map((o) => ({ id: o, group: "operation" })),
    ];

    if (allNodes.length === 0) return;

    const radius = Math.min(width, height) / 2 - 60;
    const cx = width / 2;
    const cy = height / 2;

    // Position nodes in a circle: requestors on left, operations on right
    const reqAngleStep = Math.PI / Math.max(requestors.length, 1);
    const opAngleStep = Math.PI / Math.max(operations.length, 1);

    const nodePositions = new Map<string, { x: number; y: number }>();

    requestors.forEach((r, i) => {
      const angle = Math.PI / 2 + reqAngleStep * (i + 0.5);
      nodePositions.set(r, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });

    operations.forEach((o, i) => {
      const angle = -Math.PI / 2 + opAngleStep * (i + 0.5);
      nodePositions.set(o, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });

    const textColor = dark ? "#c1c2c5" : "#495057";
    const linkColor = dark ? "rgba(255, 169, 77, 0.3)" : "rgba(232, 89, 12, 0.2)";
    const linkHighlight = dark ? "rgba(255, 169, 77, 0.8)" : "rgba(232, 89, 12, 0.6)";
    const reqColor = dark ? "#74c0fc" : "#1c7ed6";
    const opColor = dark ? "#ffa94d" : "#e8590c";

    const maxCount = Math.max(...links.map((l) => l.count), 1);

    const g = svg.append("g");

    // Draw links as curved paths
    g.selectAll("path.link")
      .data(links)
      .enter()
      .append("path")
      .attr("class", "link")
      .attr("d", (d) => {
        const s = nodePositions.get(d.requestor)!;
        const t = nodePositions.get(d.operation)!;
        return `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`;
      })
      .attr("fill", "none")
      .attr("stroke", linkColor)
      .attr("stroke-width", (d) => 1 + (d.count / maxCount) * 4)
      .on("mouseenter", function () {
        d3.select(this).attr("stroke", linkHighlight).attr("stroke-width", 4);
      })
      .on("mouseleave", function (_, d: Link) {
        d3.select(this).attr("stroke", linkColor).attr("stroke-width", 1 + (d.count / maxCount) * 4);
      });

    // Draw nodes
    g.selectAll("circle.node")
      .data(allNodes)
      .enter()
      .append("circle")
      .attr("class", "node")
      .attr("cx", (d) => nodePositions.get(d.id)!.x)
      .attr("cy", (d) => nodePositions.get(d.id)!.y)
      .attr("r", 5)
      .attr("fill", (d) => (d.group === "requestor" ? reqColor : opColor));

    // Draw labels
    g.selectAll("text.label")
      .data(allNodes)
      .enter()
      .append("text")
      .attr("class", "label")
      .attr("x", (d) => {
        const pos = nodePositions.get(d.id)!;
        return pos.x < cx ? pos.x - 10 : pos.x + 10;
      })
      .attr("y", (d) => nodePositions.get(d.id)!.y)
      .attr("text-anchor", (d) => {
        const pos = nodePositions.get(d.id)!;
        return pos.x < cx ? "end" : "start";
      })
      .attr("dominant-baseline", "middle")
      .attr("fill", textColor)
      .attr("font-size", "11px")
      .text((d) => d.id.length > 35 ? d.id.slice(0, 33) + "..." : d.id);

  }, [links, requestors, operations, width, height, dark]);

  if (links.length === 0) {
    return <Text c="dimmed" size="sm">Need requestor + operation data to show patterns.</Text>;
  }

  return (
    <div>
      <svg ref={svgRef} width={width} height={height} />
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 4 }}>
        <span style={{ fontSize: 11, color: dark ? "#74c0fc" : "#1c7ed6" }}>&#9679; Requestors</span>
        <span style={{ fontSize: 11, color: dark ? "#ffa94d" : "#e8590c" }}>&#9679; Operations</span>
      </div>
    </div>
  );
}
