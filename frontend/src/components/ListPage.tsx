import { IconSearch } from "@tabler/icons-react";
import { type ReactNode, useMemo, useState } from "react";

import { useRowsPerPage } from "../hooks/useRowsPerPage";
import { PaginationFoot } from "./PaginationFoot";
import ui from "../styles/redesign.module.css";
import styles from "./ListPage.module.css";

export interface ListColumn<T> {
  key: string;
  label: string;
  width?: number;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
}

interface ListPageProps<T> {
  eyebrow: string;
  title: string;
  subtitle?: string;
  /** Right side of the page head — primary action and/or CLI hint. */
  headerRight?: ReactNode;
  /** Page-specific toolbar controls (selects, date inputs) rendered after the search box. */
  toolbarExtra?: ReactNode;
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  /** When provided, rows are client-filtered by this text against the search value. */
  searchText?: (row: T) => string;
  columns: ListColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClick?: (row: T) => void;
  actions?: (row: T) => ReactNode;
  loading?: boolean;
  emptyText?: string;
}

export function ListPage<T>({
  eyebrow,
  title,
  subtitle,
  headerRight,
  toolbarExtra,
  searchValue,
  onSearchChange,
  searchPlaceholder = "Filter…",
  searchText,
  columns,
  rows,
  rowKey,
  rowClick,
  actions,
  loading = false,
  emptyText = "No matching rows.",
}: ListPageProps<T>) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useRowsPerPage();

  const filtered = useMemo(() => {
    const q = searchValue.trim().toLowerCase();
    if (!q || !searchText) return rows;
    return rows.filter((r) => searchText(r).toLowerCase().includes(q));
  }, [rows, searchValue, searchText]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages - 1);
  const paged = filtered.slice(cur * pageSize, cur * pageSize + pageSize);
  const hasActions = !!actions;
  const colSpan = columns.length + (hasActions ? 1 : 0);

  return (
    <div className={styles.wrap}>
      <div className={ui.pageHead}>
        <div>
          <p className={ui.eyebrow}>{eyebrow}</p>
          <h1 className={ui.pageTitle}>{title}</h1>
          {subtitle && <p className={ui.pageSub}>{subtitle}</p>}
        </div>
        {headerRight}
      </div>

      <div className={styles.toolbar}>
        <span className={styles.search}>
          <IconSearch size={16} />
          <input
            value={searchValue}
            onChange={(e) => {
              onSearchChange(e.currentTarget.value);
              setPage(0);
            }}
            placeholder={searchPlaceholder}
          />
        </span>
        {toolbarExtra}
        <span className={styles.count}>
          {total} {total === 1 ? "row" : "rows"}
        </span>
      </div>

      <div className={`${ui.card} ${ui.rise}`} style={{ overflow: "hidden" }}>
        <table className={styles.tbl}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width, textAlign: c.align ?? "left" }}>
                  {c.label}
                </th>
              ))}
              {hasActions && <th style={{ width: 1 }} />}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colSpan} className={styles.emptyRow}>
                  Loading…
                </td>
              </tr>
            ) : paged.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className={styles.emptyRow}>
                  {emptyText}
                </td>
              </tr>
            ) : (
              paged.map((r) => (
                <tr
                  key={rowKey(r)}
                  style={rowClick ? { cursor: "pointer" } : undefined}
                  onClick={rowClick ? () => rowClick(r) : undefined}
                >
                  {columns.map((c) => (
                    <td key={c.key} style={{ textAlign: c.align ?? "left" }}>
                      {c.render(r)}
                    </td>
                  ))}
                  {hasActions && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className={styles.actions}>{actions!(r)}</div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
        <PaginationFoot
          page={cur + 1}
          pageCount={pages}
          total={total}
          pageSize={pageSize}
          onPage={(p) => setPage(p - 1)}
          onPageSize={(n) => {
            setPageSize(n);
            setPage(0);
          }}
        />
      </div>
    </div>
  );
}
