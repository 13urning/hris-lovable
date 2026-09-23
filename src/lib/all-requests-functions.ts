import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertAdmin } from "@/lib/auth-middleware";
import {
  validateAllRequestsInput,
  ALL_REQUESTS_ROW_LIMIT,
  type AllRequestRow,
  type AllRequestsResult,
} from "@/lib/all-requests";

// Admin-only "everything filed" view: every leave request, OT budget request,
// OT actual-hours filing, and attendance dispute, filed by ANY employee within
// a filed-date window — one unified row per request, newest first.
//
// Deliberately NOT filtered by the exclude_from_attendance / localadmin@hris.local
// monitoring exclusions that generateActivityReport (report-functions.ts)
// applies — this is an audit view of "everything filed", so a request from an
// employee who is otherwise excluded from attendance monitoring must still show
// up here.
export const fetchAllRequests = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<AllRequestsResult> => {
    // isHR is true for admins too (see AuthUserContext in auth-middleware.ts),
    // so assertHR would let a plain HR user through. This view is admin-only —
    // must be assertAdmin. Checked before validation so a non-admin never
    // learns anything about why their input would or wouldn't be valid.
    assertAdmin(context.user);

    const { startDate, endDate } = validateAllRequestsInput(data);

    const { pool } = await import("@/lib/db.server");
    // $1 = start date, $2 = end date (inclusive, PH calendar day), $3 = fetch one
    // row past the limit so we can tell the admin the window was truncated
    // without a separate COUNT(*) query.
    const params = [startDate, endDate, ALL_REQUESTS_ROW_LIMIT + 1];

    const { rows } = await pool.query<AllRequestRow>(
      `SELECT * FROM (
         SELECT
           'leave' AS kind,
           lr.id,
           p.full_name AS employee_name, p.employee_code, p.department,
           lr.status::text AS status, lr.created_at,
           lr.leave_type,
           to_char(lr.start_date, 'YYYY-MM-DD') AS start_date,
           to_char(lr.end_date, 'YYYY-MM-DD') AS end_date,
           lr.half_day, lr.half_day_period,
           NULL::numeric AS requested_hours, NULL::text AS target_month,
           NULL::text AS work_date,
           NULL::text AS time_from, NULL::text AS time_to,
           NULL::text AS original_time_in, NULL::text AS original_time_out,
           NULL::text AS original_shift_label,
           NULL::text AS requested_time_in, NULL::text AS requested_time_out,
           NULL::text AS requested_shift_label,
           lr.reason AS requester_text, lr.review_notes, lr.reviewed_at,
           rp.full_name AS reviewed_by_name,
           CASE WHEN lr.status = 'pending' THEN cap.full_name END AS current_approver_name,
           lr.current_approver_index,
           COALESCE(array_length(lr.approver_chain, 1), 0) AS chain_length
         FROM leave_requests lr
         LEFT JOIN profiles p ON p.id = lr.employee_id
         -- Deciding approver. LEFT JOIN so a still-pending request (no
         -- reviewed_by yet) keeps its row instead of dropping out.
         LEFT JOIN profiles rp ON rp.id = lr.reviewed_by
         -- Postgres arrays are 1-based; current_approver_index is 0-based.
         LEFT JOIN profiles cap ON cap.id = lr.approver_chain[lr.current_approver_index + 1]
         WHERE lr.created_at >= $1::timestamp AT TIME ZONE 'Asia/Manila'
           AND lr.created_at < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'

         UNION ALL

         SELECT
           CASE WHEN r.request_type = 'pre_approved' THEN 'ot_budget' ELSE 'ot_actual' END AS kind,
           r.id,
           p2.full_name AS employee_name, p2.employee_code, p2.department,
           r.status, r.created_at,
           NULL::text AS leave_type, NULL::text AS start_date, NULL::text AS end_date,
           NULL::boolean AS half_day, NULL::text AS half_day_period,
           r.requested_hours,
           to_char(r.target_month, 'YYYY-MM') AS target_month,
           -- work_date is populated for BOTH request types (it's copied from
           -- target_month at insert time for a budget row — see
           -- fileOTBudgetRequest — not a real work date), so it's only
           -- meaningful, and only surfaced, for an 'actual' filing.
           CASE WHEN r.request_type = 'actual'
                THEN to_char(r.work_date, 'YYYY-MM-DD') END AS work_date,
           to_char(r.time_from, 'HH24:MI') AS time_from,
           to_char(r.time_to, 'HH24:MI') AS time_to,
           NULL::text AS original_time_in, NULL::text AS original_time_out,
           NULL::text AS original_shift_label,
           NULL::text AS requested_time_in, NULL::text AS requested_time_out,
           NULL::text AS requested_shift_label,
           r.justification AS requester_text, r.review_notes, r.reviewed_at,
           -- ot_approval_requests has no reviewer column — reviewed_by_name is
           -- genuinely unavailable for OT, not just unjoined.
           NULL::text AS reviewed_by_name,
           CASE WHEN r.status = 'pending' THEN cap2.full_name END AS current_approver_name,
           r.current_approver_index,
           COALESCE(array_length(r.approver_chain, 1), 0) AS chain_length
         FROM ot_approval_requests r
         LEFT JOIN profiles p2 ON p2.id = r.employee_id
         LEFT JOIN profiles cap2 ON cap2.id = r.approver_chain[r.current_approver_index + 1]
         WHERE r.created_at >= $1::timestamp AT TIME ZONE 'Asia/Manila'
           AND r.created_at < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'

         UNION ALL

         SELECT
           'dispute' AS kind,
           ad.id,
           p3.full_name AS employee_name, p3.employee_code, p3.department,
           ad.status, ad.created_at,
           NULL::text AS leave_type, NULL::text AS start_date, NULL::text AS end_date,
           NULL::boolean AS half_day, NULL::text AS half_day_period,
           NULL::numeric AS requested_hours, NULL::text AS target_month,
           to_char(ad.work_date, 'YYYY-MM-DD') AS work_date,
           NULL::text AS time_from, NULL::text AS time_to,
           -- Already plain "HH:MM" text at rest (see normTime in
           -- attendance-dispute-functions.ts) — no to_char needed.
           ad.original_time_in, ad.original_time_out, ad.original_shift_label,
           ad.requested_time_in, ad.requested_time_out, ad.requested_shift_label,
           ad.reason AS requester_text, ad.review_notes, ad.reviewed_at,
           rp3.full_name AS reviewed_by_name,
           CASE WHEN ad.status = 'pending' THEN cap3.full_name END AS current_approver_name,
           ad.current_approver_index,
           COALESCE(array_length(ad.approver_chain, 1), 0) AS chain_length
         FROM attendance_disputes ad
         LEFT JOIN profiles p3 ON p3.id = ad.employee_id
         LEFT JOIN profiles rp3 ON rp3.id = ad.reviewed_by
         LEFT JOIN profiles cap3 ON cap3.id = ad.approver_chain[ad.current_approver_index + 1]
         WHERE ad.created_at >= $1::timestamp AT TIME ZONE 'Asia/Manila'
           AND ad.created_at < ($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila'
       ) combined
       ORDER BY created_at DESC
       LIMIT $3::int`,
      params,
    );

    const truncated = rows.length > ALL_REQUESTS_ROW_LIMIT;
    return {
      rows: truncated ? rows.slice(0, ALL_REQUESTS_ROW_LIMIT) : rows,
      truncated,
      limit: ALL_REQUESTS_ROW_LIMIT,
    };
  });
