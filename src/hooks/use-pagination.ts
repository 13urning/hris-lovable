import { useEffect, useMemo, useState } from "react";

// Client-side pagination over an in-memory array. Clamps the page when the list
// shrinks (e.g. after filtering) and resets to page 1 when page size changes.
export function usePagination<T>(items: T[], initialPageSize = 25) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);

  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setPage(1);
  };

  const start = (page - 1) * pageSize;
  const pageItems = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize]);

  return { page, setPage, pageSize, setPageSize, pageCount, pageItems, total, start };
}
