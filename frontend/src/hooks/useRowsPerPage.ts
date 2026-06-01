import { useState } from "react";

/**
 * Global "rows per page" preference, shared across all list views and
 * persisted in localStorage so it sticks across sessions and pages.
 */
const STORAGE_KEY = "cerefox:rowsPerPage";
export const ROWS_PER_PAGE_OPTIONS = [10, 25, 50, 100];
const DEFAULT = 10;

function read(): number {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    if (ROWS_PER_PAGE_OPTIONS.includes(v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT;
}

export function useRowsPerPage(): [number, (n: number) => void] {
  const [size, setSizeState] = useState<number>(read);
  const setSize = (n: number) => {
    setSizeState(n);
    try {
      localStorage.setItem(STORAGE_KEY, String(n));
    } catch {
      /* ignore */
    }
  };
  return [size, setSize];
}
