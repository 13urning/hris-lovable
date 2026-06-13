// Shared CSV export helpers used by the admin report tables.
// Keeps every "Export CSV" button consistent: same escaping, same UTF-8 BOM
// (so Excel opens accented names correctly), same download mechanism.

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function triggerCSVDownload(content: string, filename: string) {
  // Prepend a BOM so Excel detects UTF-8 and renders non-ASCII characters.
  const blob = new Blob(["﻿" + content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Column<T> = {
  header: string;
  /** Cell value for a row. Returned value is stringified + escaped. */
  value: (row: T) => unknown;
};

/**
 * Build a CSV from a column spec and rows, then trigger a download.
 * The filename is suffixed with today's date: `name-YYYY-MM-DD.csv`.
 */
export function exportRowsToCSV<T>(
  rows: T[],
  columns: Column<T>[],
  filenamePrefix: string,
) {
  const lines = [columns.map((c) => csvEscape(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(c.value(row))).join(","));
  }
  const stamp = new Date().toISOString().slice(0, 10);
  triggerCSVDownload(lines.join("\r\n"), `${filenamePrefix}-${stamp}.csv`);
}

export type CSVColumn<T> = Column<T>;
