import { useMantineColorScheme } from "@mantine/core";
import { Text } from "@mantine/core";
import * as d3 from "d3";
import { useEffect, useRef } from "react";

interface UsageEntry {
  requestor: string | null;
  doc_title: string | null;
  document_id: string | null;
}

interface HEBChartProps {
  usageLog: UsageEntry[];
  width?: number;
  height?: number;
}

interface Link {
  requestor: string;
  doc: string;
  count: number;
}

export function HEBChart({ usageLog, width = 400, height = 400 }: HEBChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const { colorScheme } = useMantineColorScheme();
  const dark = colorScheme === "dark";

  // Build reader -> document links with counts
  const links: Link[] = [];
  const linkMap = new Map<string, number>();
  for (const entry of usageLog) {
    if (!entry.requestor || !entry.doc_title) continue;
    const key = `${entry.requestor}|||${entry.doc_title}`;
    linkMap.set(key, (linkMap.get(key) ?? 0) + 1);
  }
  for (const [key, count] of linkMap) {
    const [requestor, doc] = key.split("|||");
    links.push({ requestor, doc, count });
  }

  const readers = [...new Set(links.map((l) => l.requestor))];
  const docs = [...new Set(links.map((l) => l.doc))];

  useEffect(() => {
    if (!svgRef.current || links.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const allNodes = [
      ...readers.map((r) => ({ id: r, group: "reader" })),
      ...docs.map((d) => ({ id: d, group: "document" })),
    ];

    const nodeCount = allNodes.length;
    if (nodeCount === 0) return;

    const radius = Math.min(width, height) / 2 - 60;
    const cx = width / 2;
    const cy = height / 2;

    // Position nodes in a circle: readers on left, documents on right
    const readerAngleStep = Math.PI / Math.max(readers.length, 1);
    const docAngleStep = Math.PI / Math.max(docs.length, 1);

    const nodePositions = new Map<string, { x: number; y: number }>();

    readers.forEach((r, i) => {
      const angle = Math.PI / 2 + readerAngleStep * (i + 0.5);
      nodePositions.set(r, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });

    docs.forEach((d, i) => {
      const angle = -Math.PI / 2 + docAngleStep * (i + 0.5);
      nodePositions.set(d, {
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    });

    const textColor = dark ? "#c1c2c5" : "#495057";
    const linkColor = dark ? "rgba(116, 192, 252, 0.3)" : "rgba(28, 126, 214, 0.2)";
    const linkHighlight = dark ? "rgba(116, 192, 252, 0.8)" : "rgba(28, 126, 214, 0.6)";
    const readerColor = dark ? "#74c0fc" : "#1c7ed6";
    const docColor = dark ? "#63e6be" : "#0ca678";

    const maxCount = Math.max(...links.map((l) => l.count), 1);

    // Draw links as curved paths
    const g = svg.append("g");

    g.selectAll("path.link")
      .data(links)
      .enter()
      .append("path")
      .attr("class", "link")
      .attr("d", (d) => {
        const s = nodePositions.get(d.requestor)!;
        const t = nodePositions.get(d.doc)!;
        return `M${s.x},${s.y} Q${cx},${cy} ${t.x},${t.y}`;
      })
      .attr("fill", "none")
      .attr("stroke", linkColor)
      .attr("stroke-width", (d) => 1 + (d.count / maxCount) * 3)
      .on("mouseenter", function () {
        d3.select(this).attr("stroke", linkHighlight).attr("stroke-width", 3);
      })
      .on("mouseleave", function (_, d: Link) {
        d3.select(this).attr("stroke", linkColor).attr("stroke-width", 1 + (d.count / maxCount) * 3);
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
      .attr("fill", (d) => (d.group === "reader" ? readerColor : docColor));

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

  }, [links, readers, docs, width, height, dark]);

  if (links.length === 0) {
    return <Text c="dimmed" size="sm">Need reader + document data to show access patterns.</Text>;
  }

  return (
    <div>
      <svg ref={svgRef} width={width} height={height} />
      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 4 }}>
        <span style={{ fontSize: 11, color: dark ? "#74c0fc" : "#1c7ed6" }}>&#9679; Readers</span>
        <span style={{ fontSize: 11, color: dark ? "#63e6be" : "#0ca678" }}>&#9679; Documents</span>
      </div>
    </div>
  );
}
