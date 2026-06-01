import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronsLeft,
  IconChevronsRight,
} from "@tabler/icons-react";

import { ROWS_PER_PAGE_OPTIONS } from "../hooks/useRowsPerPage";
import ui from "../styles/redesign.module.css";
import lp from "./ListPage.module.css";

/**
 * Shared list pagination footer: "N–M of T" range, a rows-per-page dropdown,
 * and first/prev/next/last controls. Page numbers are 1-based.
 */
export function PaginationFoot({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  onPageSize,
  loading = false,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  loading?: boolean;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, (page - 1) * pageSize + pageSize);
  const atStart = page <= 1;
  const atEnd = page >= pageCount;

  return (
    <div className={lp.foot}>
      <span className={lp.faint}>
        {total === 0 ? "0" : `${start}–${end}`} of {total}
        {loading ? " · loading…" : ""}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className={lp.faint} style={{ fontSize: 11.5 }}>
          Rows
        </span>
        <span className={ui.selectWrap} style={{ height: 28 }}>
          <select
            className={ui.selectEl}
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.currentTarget.value))}
            aria-label="Rows per page"
          >
            {ROWS_PER_PAGE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button type="button" className={lp.pgBtn} disabled={atStart} onClick={() => onPage(1)} aria-label="First page">
            <IconChevronsLeft size={14} />
          </button>
          <button type="button" className={lp.pgBtn} disabled={atStart} onClick={() => onPage(page - 1)} aria-label="Previous page">
            <IconChevronLeft size={14} />
          </button>
          <span className={lp.faint}>
            page {page} / {pageCount}
          </span>
          <button type="button" className={lp.pgBtn} disabled={atEnd} onClick={() => onPage(page + 1)} aria-label="Next page">
            <IconChevronRight size={14} />
          </button>
          <button type="button" className={lp.pgBtn} disabled={atEnd} onClick={() => onPage(pageCount)} aria-label="Last page">
            <IconChevronsRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
