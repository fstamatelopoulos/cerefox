import { Group, Text } from "@mantine/core";
import { diffLines } from "diff";
import { useMemo } from "react";

import styles from "./DiffViewer.module.css";

interface DiffViewerProps {
  oldContent: string;
  newContent: string;
  oldLabel?: string;
  newLabel?: string;
}

export function DiffViewer({
  oldContent,
  newContent,
}: DiffViewerProps) {
  const changes = useMemo(
    () => diffLines(oldContent, newContent),
    [oldContent, newContent],
  );

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const c of changes) {
      const lines = (c.value.match(/\n/g) || []).length;
      if (c.added) added += lines || 1;
      if (c.removed) removed += lines || 1;
    }
    return { added, removed };
  }, [changes]);

  return (
    <div>
      <Group gap="sm" mb="xs">
        <Text size="xs" c="green" fw={600}>+{stats.added} added</Text>
        <Text size="xs" c="red" fw={600}>-{stats.removed} removed</Text>
      </Group>

      <pre className={styles.diffPre}>
        {changes.map((change, i) => {
          const cls = change.added
            ? styles.added
            : change.removed
              ? styles.removed
              : styles.context;
          return (
            <span key={i} className={cls}>
              {change.value}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
