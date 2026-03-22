import { Code, SegmentedControl, Stack } from "@mantine/core";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import classes from "./MarkdownViewer.module.css";

interface MarkdownViewerProps {
  content: string;
  /** Which tab to show by default: "rendered" or "raw". */
  defaultView?: "rendered" | "raw";
  /** Max height for the content area (overflows with scroll). */
  maxHeight?: number;
  /** Whether to show the Rendered/Raw toggle. Defaults to true. */
  showToggle?: boolean;
}

export function MarkdownViewer({
  content,
  defaultView = "rendered",
  maxHeight = 600,
  showToggle = true,
}: MarkdownViewerProps) {
  const [view, setView] = useState<string>(defaultView);

  return (
    <Stack gap="xs">
      {showToggle && (
        <SegmentedControl
          size="xs"
          value={view}
          onChange={setView}
          data={[
            { label: "Rendered", value: "rendered" },
            { label: "Raw", value: "raw" },
          ]}
          w={200}
        />
      )}
      {view === "rendered" ? (
        <div
          className={classes.markdown}
          style={{ maxHeight, overflow: "auto" }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content || "*(empty)*"}
          </ReactMarkdown>
        </div>
      ) : (
        <Code
          block
          style={{
            whiteSpace: "pre-wrap",
            maxHeight,
            overflow: "auto",
          }}
        >
          {content || "(empty)"}
        </Code>
      )}
    </Stack>
  );
}
