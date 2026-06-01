import { Code, SegmentedControl, Stack } from "@mantine/core";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MarkdownLink } from "./MarkdownLink";
import classes from "./MarkdownViewer.module.css";

interface MarkdownViewerProps {
  content: string;
  /** Which tab to show by default: "rendered" or "raw". */
  defaultView?: "rendered" | "raw";
  /** Max height for the content area (overflows with scroll). */
  maxHeight?: number | string;
  /** Whether to show the Rendered/Raw toggle. Defaults to true. */
  showToggle?: boolean;
  /**
   * UUID of the document being rendered, if known. When set, relative
   * markdown links inside the content are intercepted and resolved to
   * other Cerefox documents via the /api/v1/resolve-link endpoint, and
   * the source doc is excluded so a doc linking to itself is not a hit.
   * Omit (or pass undefined) to render links as plain anchors.
   */
  documentId?: string;
}

export function MarkdownViewer({
  content,
  defaultView = "rendered",
  maxHeight = 600,
  showToggle = true,
  documentId,
}: MarkdownViewerProps) {
  const [view, setView] = useState<string>(defaultView);

  // Memoise the components map so React doesn't re-mount link nodes on each
  // render. The closure over documentId is stable per parent render.
  const mdComponents = useMemo(
    () => ({
      a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <MarkdownLink {...props} fromDocId={documentId} />
      ),
    }),
    [documentId],
  );

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
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
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
