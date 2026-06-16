export const APPROVAL_STATUSES = [
  "draft",
  "submitted",
  "pending_approval",
  "approved",
  "rejected",
  "needs_correction",
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const STATUS_LABEL: Record<ApprovalStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  needs_correction: "Needs Correction",
};

export const STATUS_TONE: Record<ApprovalStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-accent/15 text-accent",
  pending_approval: "bg-warning/20 text-warning-foreground",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  needs_correction: "bg-warning/20 text-warning-foreground",
};

// Shift schedule options offered at clock-in. "OB" = Official Business Trip
// (off-site work): the clock-in geofence is skipped and the day is not late-flagged.
export const SHIFT_OPTIONS = [
  { value: "6-3", label: "6:00 AM – 3:00 PM" },
  { value: "7-4", label: "7:00 AM – 4:00 PM" },
  { value: "8-5", label: "8:00 AM – 5:00 PM" },
  { value: "9-6", label: "9:00 AM – 6:00 PM" },
  { value: "OB", label: "Official Business Trip" },
] as const;

export type ShiftValue = (typeof SHIFT_OPTIONS)[number]["value"];

// Friendly label for a stored shift code (e.g. "8-5" → "8:00 AM – 5:00 PM",
// "OB" → "Official Business Trip"). Falls back to the raw code if unknown.
export function shiftDisplay(label: string | null | undefined): string {
  if (!label) return "—";
  return SHIFT_OPTIONS.find((s) => s.value === label)?.label ?? label;
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Local calendar date as YYYY-MM-DD. Must use local time (not toISOString,
// which is UTC) so the business date matches the local time-of-day recorded at
// clock-in. Otherwise a clock-in before UTC midnight (e.g. before 08:00 in
// GMT+8) is stored under the previous day and can't be clocked out later.
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
