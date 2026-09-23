// Shared contract for the admin "All Requests" page: one row shape across the
// four request tables (leave_requests, ot_approval_requests ×2 request types,
// attendance_disputes). Pure types + helpers only — the server function lives in
// all-requests-functions.ts so this module can be imported by the page and by
// tests without pulling in the DB pool.

import { isRealDate } from "@/lib/date-validation";

export type RequestKind = "leave" | "ot_budget" | "ot_actual" | "dispute";

export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export const REQUEST_KINDS: readonly RequestKind[] = ["leave", "ot_budget", "ot_actual", "dispute"];

export const REQUEST_STATUSES: readonly RequestStatus[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
];

// Filed-date window, Philippine calendar dates, both ends inclusive. Type,
// status and employee search are applied client-side so the per-status counts
// stay instant and consistent with the visible list.
export type AllRequestsInput = {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
};

// Columns that don't apply to a given kind are null.
export type AllRequestRow = {
  kind: RequestKind;
  id: string;
  employee_name: string | null;
  employee_code: string | null;
  department: string | null;
  status: RequestStatus;
  created_at: string; // ISO timestamp (UTC)

  // leave
  leave_type: string | null;
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null; // YYYY-MM-DD
  half_day: boolean | null;
  half_day_period: "AM" | "PM" | null;

  // ot_budget + ot_actual
  requested_hours: number | null;
  target_month: string | null; // YYYY-MM (ot_budget)

  // ot_actual + dispute
  work_date: string | null; // YYYY-MM-DD

  // ot_actual
  time_from: string | null; // HH:MM
  time_to: string | null; // HH:MM

  // dispute — snapshot at filing vs. what the employee asked for
  original_time_in: string | null;
  original_time_out: string | null;
  original_shift_label: string | null;
  requested_time_in: string | null;
  requested_time_out: string | null;
  requested_shift_label: string | null;

  // Requester's own words: leave.reason / OT justification / dispute.reason.
  requester_text: string | null;
  // One surviving note per request — each approver overwrites it.
  review_notes: string | null;
  reviewed_at: string | null; // ISO timestamp (UTC)
  // Stored for leave and dispute only; ot_approval_requests has no reviewer
  // column, so this is always null for OT.
  reviewed_by_name: string | null;
  // Pending rows only: the approver the request is waiting on.
  current_approver_name: string | null;
  current_approver_index: number; // 0-based position in the chain
  chain_length: number;
};

export type AllRequestsResult = {
  rows: AllRequestRow[];
  // True when the window held more rows than ALL_REQUESTS_ROW_LIMIT; the page
  // asks the admin to narrow the range rather than silently showing a subset.
  truncated: boolean;
  limit: number;
};

export const ALL_REQUESTS_ROW_LIMIT = 5000;
export const ALL_REQUESTS_MAX_RANGE_DAYS = 366;

// Pure validator shared by the server function and its tests. Mirrors the
// shape/date/range checks in generateActivityReport (report-functions.ts) —
// same error codes, same ~1-year cap — but lives here so it stays importable
// from a client-bundled module (no DB, no server-fn imports allowed in this
// file). Throws a stable error code string; the caller/tests key off it.
export function validateAllRequestsInput(data: unknown): AllRequestsInput {
  // Shape guard — this backs a POST endpoint, not just the admin page.
  if (
    typeof data !== "object" ||
    data === null ||
    typeof (data as { startDate?: unknown }).startDate !== "string" ||
    typeof (data as { endDate?: unknown }).endDate !== "string"
  ) {
    throw new Error("INVALID_INPUT");
  }

  const { startDate, endDate } = data as { startDate: string; endDate: string };
  if (!isRealDate(startDate) || !isRealDate(endDate)) throw new Error("INVALID_DATE");
  if (endDate < startDate) throw new Error("INVALID_RANGE");
  // ~1 year cap keeps the response bounded even for an org-wide query.
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
  if (days > ALL_REQUESTS_MAX_RANGE_DAYS) throw new Error("RANGE_TOO_LARGE");

  return { startDate, endDate };
}
