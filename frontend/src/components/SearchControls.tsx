import { ActionIcon, Select, TextInput } from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconCheck,
  IconChevronDown,
  IconFileText,
  IconFolder,
  IconSearch,
  IconSparkles,
  IconStack2,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useState } from "react";

import type { SearchMode } from "../api/types";
import { useMetadataKeys, useProjects } from "../hooks/useProjects";
import ui from "../styles/redesign.module.css";
import styles from "../pages/SearchPage.module.css";

const MODES: { v: SearchMode; label: string; icon: typeof IconSearch; desc: string }[] = [
  { v: "docs", label: "Documents", icon: IconFileText, desc: "Full documents, ranked" },
  { v: "hybrid", label: "Hybrid", icon: IconStack2, desc: "BM25 + embeddings" },
  { v: "fts", label: "Keyword", icon: IconSearch, desc: "Exact full-text" },
  { v: "semantic", label: "Semantic", icon: IconSparkles, desc: "Meaning-based" },
];

const COUNT_OPTIONS = [5, 10, 20];

interface MetadataFilterPair {
  key: string;
  value: string;
}

interface SearchControlsProps {
  query: string;
  mode: SearchMode;
  projectId: string;
  count: number;
  reviewStatus: string;
  metadataFilter: Record<string, string>;
  onSearch: (params: {
    q: string;
    mode: SearchMode;
    projectId: string;
    count: number;
    reviewStatus: string;
    metadataFilter: Record<string, string>;
  }) => void;
}

export function SearchControls({
  query,
  mode,
  projectId,
  count,
  reviewStatus,
  metadataFilter,
  onSearch,
}: SearchControlsProps) {
  const [localQuery, setLocalQuery] = useState(query);
  const [localMode, setLocalMode] = useState<SearchMode>(mode);
  const [localProjectId, setLocalProjectId] = useState(projectId);
  const [localCount, setLocalCount] = useState(count);
  const [localReviewStatus, setLocalReviewStatus] = useState(reviewStatus);
  const [filterPairs, setFilterPairs] = useState<MetadataFilterPair[]>(() =>
    Object.entries(metadataFilter).map(([key, value]) => ({ key, value })),
  );
  const [filtersOpen, setFiltersOpen] = useState(filterPairs.length > 0);

  const { data: projects } = useProjects();
  const { data: metadataKeys } = useMetadataKeys();

  const buildMf = useCallback(() => {
    const mf: Record<string, string> = {};
    for (const pair of filterPairs) {
      if (pair.key.trim() && pair.value.trim()) mf[pair.key.trim()] = pair.value.trim();
    }
    return mf;
  }, [filterPairs]);

  const apply = useCallback(
    (overrides: Partial<{ q: string; mode: SearchMode; projectId: string; count: number; reviewStatus: string }>) => {
      onSearch({
        q: localQuery,
        mode: localMode,
        projectId: localProjectId,
        count: localCount,
        reviewStatus: localReviewStatus,
        metadataFilter: buildMf(),
        ...overrides,
      });
    },
    [localQuery, localMode, localProjectId, localCount, localReviewStatus, buildMf, onSearch],
  );

  const changeMode = (m: SearchMode) => {
    setLocalMode(m);
    apply({ mode: m });
  };
  const changeProject = (id: string) => {
    setLocalProjectId(id);
    apply({ projectId: id });
  };
  const changeCount = (n: number) => {
    setLocalCount(n);
    apply({ count: n });
  };
  const togglePending = () => {
    const next = localReviewStatus === "pending_review" ? "" : "pending_review";
    setLocalReviewStatus(next);
    apply({ reviewStatus: next });
  };

  const keyOptions =
    metadataKeys?.map((mk) => ({ value: mk.key, label: `${mk.key} (${mk.doc_count})` })) ?? [];

  return (
    <div className={`${ui.card} ${styles.searchBar} ${ui.rise}`}>
      <form
        className={styles.searchInputRow}
        onSubmit={(e) => {
          e.preventDefault();
          apply({});
        }}
      >
        <IconSearch size={20} />
        <input
          className={styles.searchInput}
          value={localQuery}
          onChange={(e) => setLocalQuery(e.currentTarget.value)}
          placeholder="Search your knowledge base…"
        />
        {localQuery && (
          <button
            type="button"
            className={ui.iconBtn}
            style={{ width: 30, height: 30 }}
            aria-label="Clear"
            onClick={() => {
              setLocalQuery("");
            }}
          >
            <IconX size={16} />
          </button>
        )}
        <button type="submit" className={`${ui.btn} ${ui.btnPrimary}`}>
          Search
        </button>
      </form>

      <div className={ui.divider} />

      <div className={styles.searchControls}>
        <div className={ui.seg}>
          {MODES.map((m) => {
            const Ico = m.icon;
            return (
              <button
                key={m.v}
                type="button"
                title={m.desc}
                className={`${ui.segBtn} ${localMode === m.v ? ui.segBtnOn : ""}`}
                onClick={() => changeMode(m.v)}
              >
                <Ico size={14} />
                {m.label}
              </button>
            );
          })}
        </div>

        <div className={styles.controlsRight}>
          <span className={ui.selectWrap}>
            <IconFolder size={14} />
            <select
              className={ui.selectEl}
              value={localProjectId}
              onChange={(e) => changeProject(e.currentTarget.value)}
            >
              <option value="">All projects ({projects?.length ?? 0})</option>
              {projects?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <IconChevronDown size={14} />
          </span>

          <span className={ui.selectWrap}>
            <select
              className={ui.selectEl}
              value={String(localCount)}
              onChange={(e) => changeCount(Number(e.currentTarget.value))}
            >
              {COUNT_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n} results
                </option>
              ))}
            </select>
            <IconChevronDown size={14} />
          </span>

          <button
            type="button"
            className={`${ui.chip} ${localReviewStatus === "pending_review" ? ui.chipOn : ""}`}
            onClick={togglePending}
          >
            <IconCheck size={13} />
            Pending review
          </button>

          <button
            type="button"
            className={`${ui.chip} ${filtersOpen ? ui.chipOn : ""}`}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <IconAdjustmentsHorizontal size={13} />
            Filters{filterPairs.length > 0 ? ` (${filterPairs.length})` : ""}
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className={styles.filterRow}>
          {filterPairs.map((pair, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Select
                placeholder="Key"
                data={keyOptions}
                value={pair.key || null}
                onChange={(v) =>
                  setFilterPairs((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, key: v || "" } : p)),
                  )
                }
                searchable
                size="xs"
                w={190}
              />
              <TextInput
                placeholder="Value"
                value={pair.value}
                onChange={(e) =>
                  setFilterPairs((prev) =>
                    prev.map((p, i) => (i === idx ? { ...p, value: e.currentTarget.value } : p)),
                  )
                }
                size="xs"
                w={190}
              />
              <ActionIcon
                variant="subtle"
                color="red"
                size="sm"
                onClick={() => setFilterPairs((prev) => prev.filter((_, i) => i !== idx))}
              >
                <IconX size={14} />
              </ActionIcon>
            </div>
          ))}
          <button
            type="button"
            className={`${ui.btn} ${ui.btnSubtle}`}
            onClick={() => setFilterPairs((prev) => [...prev, { key: "", value: "" }])}
          >
            + Add filter
          </button>
          <button type="button" className={`${ui.btn} ${ui.btnGhost}`} onClick={() => apply({})}>
            Apply filters
          </button>
        </div>
      )}
    </div>
  );
}
