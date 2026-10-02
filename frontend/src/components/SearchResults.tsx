import { Alert, Loader } from "@mantine/core";
import {
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconFileText,
  IconSearch,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { ChunkSearchResult, DocSearchResult, SearchMode, SearchResponse } from "../api/types";
import { isDocResult } from "../api/types";
import { ScoreRing } from "./ScoreRing";
import { displayScore, isRelativeScale, scoreTone } from "../lib/scoreBands";
import ui from "../styles/redesign.module.css";
import styles from "../pages/SearchPage.module.css";

const PROJECT_COLORS = ["--primary", "--violet", "--blue", "--green", "--yellow", "--red"];
function colorForProject(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `var(${PROJECT_COLORS[h % PROJECT_COLORS.length]})`;
}

// A search has two independent axes — what is returned and how it was ranked
// — and the controls already present them separately ("Documents"/"Chunks" +
// a ranker). The results summary used to flatten them into one word, so
// documents mode read "ranked by documents relevance": grammatically odd and
// category-confused (the other three values are ranking methods). Keep both.
const MODE_SHAPE: Record<SearchMode, string> = {
  docs: "documents",
  hybrid: "chunks",
  fts: "chunks",
  semantic: "chunks",
};
const MODE_RANKER: Record<SearchMode, string> = {
  docs: "hybrid", // docs mode is always hybrid-ranked, then assembled per document
  hybrid: "hybrid",
  fts: "keyword",
  semantic: "semantic",
};

interface SearchResultsProps {
  data: SearchResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  hasQuery: boolean;
}

export function SearchResults({ data, isLoading, error, hasQuery }: SearchResultsProps) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);
  const copyRef = (id: string, text: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 1200);
  };

  if (!hasQuery) {
    return (
      <div className={`${ui.card} ${styles.emptyState}`} style={{ marginTop: 22 }}>
        <IconSearch size={28} />
        <p style={{ marginTop: 10 }}>Enter a query or pick a project to browse your memory.</p>
      </div>
    );
  }
  if (isLoading) {
    return (
      <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 40 }}>
        <Loader size="sm" />
        <span className={ui.dim}>Searching…</span>
      </div>
    );
  }
  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} title="Search failed" color="red" mt="md">
        {error.message}
      </Alert>
    );
  }
  if (!data || data.results.length === 0) {
    return (
      <div className={`${ui.card} ${styles.emptyState}`} style={{ marginTop: 22 }}>
        <IconSearch size={28} />
        <p style={{ marginTop: 10 }}>No results. Try widening your search or switching mode.</p>
      </div>
    );
  }

  const kb = (data.response_bytes / 1024).toFixed(1);

  // Since schema 0.18.0 docs/hybrid/semantic scores are 0 to 1, shown as they are
  // and colored against the scores of results that turned out right (v1.17.3,
  // lib/scoreBands.ts). Keyword mode (raw ranks) and pre-0.18 servers (scores
  // above 1) are still shown relative to the list's best.
  const rawScores = data.results.map((r) =>
    isDocResult(r) ? (r as DocSearchResult).best_score : (r as ChunkSearchResult).score,
  );
  const maxScore = Math.max(0, ...rawScores);
  const relative = isRelativeScale(data.mode, maxScore);

  // 28I: every-row below_confidence means nothing cleared the relevance
  // threshold and the server returned best-effort candidates instead of empty.
  const belowConfidence =
    data.results.length > 0 &&
    data.results.every(
      (r) => (r as DocSearchResult | ChunkSearchResult).below_confidence === true,
    );

  return (
    <>
      {belowConfidence && (
        <div className={styles.resultMeta} style={{ color: "var(--warning, #b58900)" }}>
          ⚠ No results cleared the confidence threshold — showing the closest{" "}
          {data.results.length} candidate{data.results.length !== 1 ? "s" : ""}; judge
          relevance by their scores.
        </div>
      )}
      <div className={styles.resultMeta}>
        <span>
          <b className={ui.mono} style={{ color: "var(--text)" }}>
            {data.total_found}
          </b>{" "}
          result{data.total_found !== 1 ? "s" : ""} ·{" "}
          <span className={ui.mono} style={{ color: "var(--primary)" }}>
            {MODE_SHAPE[data.mode]}
          </span>{" "}
          ranked by{" "}
          <span className={ui.mono} style={{ color: "var(--primary)" }}>
            {MODE_RANKER[data.mode]}
          </span>{" "}
          relevance
        </span>
        <span className={`${ui.faint} ${ui.mono}`} style={{ fontSize: 12 }}>
          {data.truncated ? "truncated · " : ""}
          {kb} KB
        </span>
      </div>

      <div className={styles.results}>
        {data.results.map((r) => {
          const isDoc = isDocResult(r);
          const id = isDoc ? (r as DocSearchResult).document_id : (r as ChunkSearchResult).chunk_id;
          const docId = r.document_id;
          const score = isDoc ? (r as DocSearchResult).best_score : (r as ChunkSearchResult).score;
          const title = r.doc_title || "Untitled";
          const headingPath = isDoc
            ? (r as DocSearchResult).best_chunk_heading_path
            : (r as ChunkSearchResult).heading_path;
          const snippet = isDoc
            ? (r as DocSearchResult).full_content
            : (r as ChunkSearchResult).content;
          const projectNames = r.doc_project_names ?? [];
          const open = expanded === id;

          return (
            <article
              key={id}
              className={`${ui.card} ${styles.resultCard} ${open ? styles.resultCardOpen : ""} ${ui.rise}`}
            >
              <div className={styles.resultHead} onClick={() => setExpanded(open ? null : id)}>
                <ScoreRing
                  score={displayScore(score, maxScore, relative)}
                  tone={scoreTone(relative ? displayScore(score, maxScore, true) : score, {
                    embedder: data.embedder,
                    relative,
                    belowConfidence: (r as DocSearchResult | ChunkSearchResult).below_confidence === true,
                  })}
                />
                <div className={styles.resultTitleWrap}>
                  <div className={ui.row} style={{ gap: 8, marginBottom: 5 }}>
                    <h3 className={styles.resultTitle}>
                      <span
                        className={ui.link}
                        style={{ cursor: "pointer" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/document/${docId}`);
                        }}
                      >
                        {title}
                      </span>
                    </h3>
                    {isDoc ? (
                      (r as DocSearchResult).is_partial ? (
                        <span className={`${ui.badge} ${ui.bYellow}`}>excerpt</span>
                      ) : (
                        <span className={`${ui.badge} ${ui.bGreen}`}>full</span>
                      )
                    ) : (
                      <span className={`${ui.badge} ${ui.bNeutral}`}>chunk</span>
                    )}
                  </div>
                  {headingPath.length > 0 && (
                    <div className={styles.breadcrumb}>
                      {headingPath.map((h, j) => (
                        <span key={j}>
                          {j > 0 && <IconChevronRight size={11} />}
                          <span>{h}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className={styles.resultMetaR}>
                  {projectNames.map((pn) => (
                    <span key={pn} className={`${ui.badge} ${ui.bNeutral}`}>
                      <span
                        className={styles.dot}
                        style={{ background: colorForProject(pn), width: 6, height: 6 }}
                      />
                      {pn}
                    </span>
                  ))}
                  <span className={`${styles.chev} ${open ? styles.chevOpen : ""}`}>
                    <IconChevronDown size={16} />
                  </span>
                </div>
              </div>

              <div className={`${styles.resultSnippet} ${open ? styles.resultSnippetOpen : ""}`}>
                {snippet.slice(0, open ? 4000 : 600)}
              </div>

              {open && (
                <div className={styles.resultExpand}>
                  <div className={styles.resultStats}>
                    {isDoc ? (
                      <>
                        <span>{(r as DocSearchResult).chunk_count} chunks</span>
                        <span>·</span>
                        <span>{(r as DocSearchResult).total_chars.toLocaleString()} chars</span>
                        {(r as DocSearchResult).doc_updated_at && (
                          <>
                            <span>·</span>
                            <span>
                              updated{" "}
                              {new Date(
                                (r as DocSearchResult).doc_updated_at as string,
                              ).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <span>chunk #{(r as ChunkSearchResult).chunk_index}</span>
                        <span>·</span>
                        <span>{(r as ChunkSearchResult).content.length.toLocaleString()} chars</span>
                      </>
                    )}
                  </div>
                  <div className={ui.row} style={{ gap: 8 }}>
                    <button
                      type="button"
                      className={`${ui.btn} ${ui.btnGhost}`}
                      onClick={() => navigate(`/document/${docId}`)}
                    >
                      <IconFileText size={14} />
                      Open document
                    </button>
                    <button
                      type="button"
                      className={`${ui.btn} ${ui.btnSubtle}`}
                      style={{ marginLeft: "auto" }}
                      title={copiedId === id ? "Copied!" : "Copy CLI command to clipboard"}
                      onClick={() => copyRef(id, `cerefox document get ${docId}`)}
                    >
                      <IconTerminal2 size={14} />
                      <span className={ui.mono} style={{ fontSize: 12 }}>
                        cerefox document get {docId.slice(0, 8)}…
                      </span>
                      {copiedId === id ? (
                        <IconCheck size={13} style={{ color: "var(--green)" }} />
                      ) : (
                        <IconCopy size={13} />
                      )}
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
