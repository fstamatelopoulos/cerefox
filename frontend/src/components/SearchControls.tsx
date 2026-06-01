import { ActionIcon, Select, TextInput } from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconCheck,
  IconChevronDown,
  IconFileText,
  IconFolder,
  IconList,
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

type Granularity = "documents" | "chunks";
type Ranker = "hybrid" | "fts" | "semantic";

// Granularity and ranker are separate concerns. The API encodes them in one
// SearchMode: "docs" = whole documents (hybrid-ranked, one entry per doc);
// the other three return matching chunks with the chosen ranker.
const RANKERS: { v: Ranker; label: string; icon: typeof IconSearch; desc: string }[] = [
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
  const [localGranularity, setLocalGranularity] = useState<Granularity>(
    mode === "docs" ? "documents" : "chunks",
  );
  const [localRanker, setLocalRanker] = useState<Ranker>(mode === "docs" ? "hybrid" : mode);
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
      const mode: SearchMode = localGranularity === "documents" ? "docs" : localRanker;
      onSearch({
        q: localQuery,
        mode,
        projectId: localProjectId,
        count: localCount,
        reviewStatus: localReviewStatus,
        metadataFilter: buildMf(),
        ...overrides,
      });
    },
    [localQuery, localGranularity, localRanker, localProjectId, localCount, localReviewStatus, buildMf, onSearch],
  );

  const changeGranularity = (g: Granularity) => {
    setLocalGranularity(g);
    apply({ mode: g === "documents" ? "docs" : localRanker });
  };
  const changeRanker = (r: Ranker) => {
    setLocalRanker(r);
    setLocalGranularity("chunks");
    apply({ mode: r });
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
          <button
            type="button"
            title="Whole documents — one entry per document, hybrid-ranked"
            className={`${ui.segBtn} ${localGranularity === "documents" ? ui.segBtnOn : ""}`}
            onClick={() => changeGranularity("documents")}
          >
            <IconFileText size={14} />
            Documents
          </button>
          <button
            type="button"
            title="Matching chunks — pick a ranker"
            className={`${ui.segBtn} ${localGranularity === "chunks" ? ui.segBtnOn : ""}`}
            onClick={() => changeGranularity("chunks")}
          >
            <IconList size={14} />
            Chunks
          </button>
        </div>

        {localGranularity === "chunks" ? (
          <span className={ui.selectWrap} title="Ranking method">
            <select
              className={ui.selectEl}
              value={localRanker}
              onChange={(e) => changeRanker(e.currentTarget.value as Ranker)}
            >
              {RANKERS.map((m) => (
                <option key={m.v} value={m.v}>
                  {m.label}
                </option>
              ))}
            </select>
            <IconChevronDown size={14} />
          </span>
        ) : (
          <span className={`${ui.faint} ${ui.mono}`} style={{ fontSize: 11.5 }}>
            whole documents · hybrid-ranked
          </span>
        )}

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
