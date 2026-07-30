import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertHR } from "@/lib/auth-middleware";
import { csvEscape } from "@/lib/csv-export";

// System/service account always excluded from attendance monitoring, matched by
// email (its row id differs across environments). Kept in sync with
// admin-dashboard-functions and dtr-functions.
const MONITORING_EXCLUDED_EMAIL = "localadmin@hris.local";

export type ReportRecordType = "attendance" | "leave" | "overtime";

export type ActivityReportResult = {
  csv: string;
  filename: string;
  counts: Record<ReportRecordType, number>;
};

// One unified column set across the three record types; irrelevant columns are
// blank for a given record_type so the file filters cleanly in a spreadsheet.
//
// REMARKS COLUMNS. `reason_or_notes` is kept EXACTLY as it was — it is the
// original column and saved spreadsheets key on it — but it is ambiguous: it
// carries the REQUESTER's text on a leave row and the APPROVER's on an OT row,
// so each type was silently missing half its commentary. The two explicit
// columns below carry both halves for every type, and are appended at the end so
// no existing column position shifts.
//
// The database keeps ONE `review_notes` per request, overwritten by each
// approver (`COALESCE($new, review_notes)`), so on a multi-step chain only the
// last approver who actually typed something survives. `approver_remarks` is
// therefore the surviving note, not a full per-step history — that history was
// never recorded and no export can reconstruct it.
const REPORT_HEADERS = [
  "record_type",
  "employee_code",
  "employee_name",
  "company",
  "department",
  "email",
  "date",
  "end_date",
  "time_in",
  "time_out",
  "hours_worked",
  "late_minutes",
  "undertime_minutes",
  "is_absent",
  "leave_type",
  "leave_days",
  "half_day_period",
  "ot_requested_hours",
  "ot_request_type",
  "ot_target_month",
  "overtime_hours",
  "status",
  "reason_or_notes",
  "requested_at_ph",
  "requester_remarks",
  "approver_remarks",
  "reviewed_by_name",
  "reviewed_at_ph",
] as const;

// Exported for the header-contract test: the column set is an interface other
// people's spreadsheets bind to, so a reordering or rename should fail a test
// rather than a finance report.
export const REPORT_COLUMNS: readonly string[] = REPORT_HEADERS;

// Header row + one line per record, CRLF-terminated. Split out of the handler so
// the escaping can actually be tested — the remarks columns are free text and
// routinely contain the commas, quotes and newlines that break a naive CSV.
export function buildReportCsv(rows: Record<string, unknown>[]): string {
  const lines = [REPORT_HEADERS.join(",")];
  for (const r of rows) lines.push(REPORT_HEADERS.map((h) => csvEscape(r[h])).join(","));
  return lines.join("\r\n") + "\r\n";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Shape AND calendar validity — "2026-13-45" matches the regex but must not
// reach the ::date casts (Postgres would throw a raw datetime error).
export function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const VALID_TYPES: readonly ReportRecordType[] = ["attendance", "leave", "overtime"];

// Attendance is selected by work_date; leave and OT requests are selected by
// when they were FILED (created_at, Philippine time) — "what was requested in
// this period", not "leaves that fall in this period".
export const generateActivityReport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { startDate: string; endDate: string; types: ReportRecordType[] }) => {
    // Shape guard — this is a public POST endpoint, not just the reports page.
    if (
      typeof data?.startDate !== "string" ||
      typeof data?.endDate !== "string" ||
      !Array.isArray(data?.types)
    )
      throw new Error("INVALID_INPUT");
    return data;
  })
  .handler(async ({ data, context }): Promise<ActivityReportResult> => {
    assertHR(context.user);

    const { startDate, endDate } = data;
    if (!isRealDate(startDate) || !isRealDate(endDate)) throw new Error("INVALID_DATE");
    if (endDate < startDate) throw new Error("INVALID_RANGE");
    // ~1 year cap keeps the response a modest string even org-wide.
    const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
    if (days > 366) throw new Error("RANGE_TOO_LARGE");
    const types = new Set(data.types.filter((t) => VALID_TYPES.includes(t)));
    if (types.size === 0) throw new Error("NO_TYPES");

    const { pool } = await import("@/lib/db.server");
    // $1 = start date, $2 = end date (inclusive), $3 = excluded system email.
    const params = [startDate, endDate, MONITORING_EXCLUDED_EMAIL];

    const [attendance, leaves, ot] = await Promise.all([
      types.has("attendance")
        ? pool.query(
            `SELECT 'attendance' AS record_type, p.employee_code, p.full_name AS employee_name,
                    p.company, p.department, COALESCE(u.email, p.email) AS email,
                    to_char(d.work_date, 'YYYY-MM-DD') AS date, NULL AS end_date,
                    to_char(d.time_in, 'HH24:MI') AS time_in, to_char(d.time_out, 'HH24:MI') AS time_out,
                    d.hours_worked, d.late_minutes, d.undertime_minutes, d.is_absent,
                    CASE WHEN d.is_leave THEN d.leave_type END AS leave_type,
                    NULL::numeric AS leave_days, NULL AS half_day_period,
                    NULL::numeric AS ot_requested_hours, NULL AS ot_request_type, NULL AS ot_target_month,
                    d.overtime_hours, d.approval_status::text AS status,
                    d.notes AS reason_or_notes,
                    to_char(d.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS requested_at_ph,
                    -- A DTR carries one free-text note and no reviewer of its
                    -- own (approval_status mirrors the cutoff submission), so
                    -- the approver/reviewer columns stay blank for attendance.
                    d.notes AS requester_remarks,
                    NULL AS approver_remarks,
                    NULL AS reviewed_by_name,
                    NULL AS reviewed_at_ph
               FROM daily_time_reports d
               JOIN users u ON u.id = d.employee_id
               LEFT JOIN profiles p ON p.id = d.employee_id
              WHERE d.work_date >= $1::date AND d.work_date <= $2::date
                AND COALESCE(u.email, p.email) IS DISTINCT FROM $3
                AND p.exclude_from_attendance IS NOT TRUE
              ORDER BY d.work_date, p.full_name`,
            params,
          )
        : null,
      types.has("leave")
        ? pool.query(
            `SELECT 'leave' AS record_type, p.employee_code, p.full_name AS employee_name,
                    p.company, p.department, COALESCE(u.email, p.email) AS email,
                    to_char(lr.start_date, 'YYYY-MM-DD') AS date,
                    to_char(lr.end_date, 'YYYY-MM-DD') AS end_date,
                    NULL AS time_in, NULL AS time_out, NULL::numeric AS hours_worked,
                    NULL::int AS late_minutes, NULL::int AS undertime_minutes, NULL::boolean AS is_absent,
                    lr.leave_type,
                    CASE WHEN lr.half_day THEN 0.5
                         ELSE (lr.end_date - lr.start_date + 1)::numeric END AS leave_days,
                    lr.half_day_period,
                    NULL::numeric AS ot_requested_hours, NULL AS ot_request_type, NULL AS ot_target_month,
                    NULL::numeric AS overtime_hours, lr.status::text AS status,
                    lr.reason AS reason_or_notes,
                    to_char(lr.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS requested_at_ph,
                    lr.reason AS requester_remarks,
                    lr.review_notes AS approver_remarks,
                    rp.full_name AS reviewed_by_name,
                    to_char(lr.reviewed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS reviewed_at_ph
               FROM leave_requests lr
               JOIN users u ON u.id = lr.employee_id
               LEFT JOIN profiles p ON p.id = lr.employee_id
               -- Deciding approver. LEFT JOIN so a still-pending request (no
               -- reviewed_by yet) keeps its row instead of dropping out.
               LEFT JOIN profiles rp ON rp.id = lr.reviewed_by
              WHERE lr.created_at >= $1::timestamp AT TIME ZONE 'Asia/Manila'
                AND lr.created_at < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'
                AND COALESCE(u.email, p.email) IS DISTINCT FROM $3
                AND p.exclude_from_attendance IS NOT TRUE
              ORDER BY lr.created_at, p.full_name`,
            params,
          )
        : null,
      types.has("overtime")
        ? pool.query(
            `SELECT 'overtime' AS record_type, p.employee_code, p.full_name AS employee_name,
                    p.company, p.department, COALESCE(u.email, p.email) AS email,
                    to_char(r.work_date, 'YYYY-MM-DD') AS date, NULL AS end_date,
                    NULL AS time_in, NULL AS time_out, NULL::numeric AS hours_worked,
                    NULL::int AS late_minutes, NULL::int AS undertime_minutes, NULL::boolean AS is_absent,
                    NULL AS leave_type, NULL::numeric AS leave_days, NULL AS half_day_period,
                    r.requested_hours AS ot_requested_hours, r.request_type AS ot_request_type,
                    to_char(r.target_month, 'YYYY-MM') AS ot_target_month,
                    NULL::numeric AS overtime_hours, r.status,
                    r.review_notes AS reason_or_notes,
                    to_char(r.created_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS requested_at_ph,
                    -- The filing form requires a justification, so this is the
                    -- OT requester's own words — never exported until now.
                    r.justification AS requester_remarks,
                    r.review_notes AS approver_remarks,
                    -- ot_approval_requests has no reviewed_by column, so the OT
                    -- reviewer's NAME is genuinely unavailable; the timestamp is.
                    NULL AS reviewed_by_name,
                    to_char(r.reviewed_at AT TIME ZONE 'Asia/Manila', 'YYYY-MM-DD HH24:MI') AS reviewed_at_ph
               FROM ot_approval_requests r
               JOIN profiles p ON p.id = r.employee_id
               LEFT JOIN users u ON u.id = r.employee_id
              WHERE r.created_at >= $1::timestamp AT TIME ZONE 'Asia/Manila'
                AND r.created_at < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'
                AND COALESCE(u.email, p.email) IS DISTINCT FROM $3
                AND p.exclude_from_attendance IS NOT TRUE
              ORDER BY r.created_at, p.full_name`,
            params,
          )
        : null,
    ]);

    const rows = [
      ...(attendance?.rows ?? []),
      ...(leaves?.rows ?? []),
      ...(ot?.rows ?? []),
    ] as Record<string, unknown>[];

    return {
      csv: buildReportCsv(rows),
      filename: `hris-report_${startDate}_to_${endDate}.csv`,
      counts: {
        attendance: attendance?.rowCount ?? 0,
        leave: leaves?.rowCount ?? 0,
        overtime: ot?.rowCount ?? 0,
      },
    };
  });
