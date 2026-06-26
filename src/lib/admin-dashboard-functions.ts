import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertHR, assertUser } from "@/lib/auth-middleware";

// System/service account always excluded from attendance monitoring, matched by
// email (its row id differs across environments). Individual employees can also
// opt out via profiles.exclude_from_attendance. Kept in sync with dtr-functions.
const MONITORING_EXCLUDED_EMAIL = "localadmin@hris.local";

export type AdminDashboardStats = {
  totalEmployees: number;
  // Today
  presentToday: number;
  stillClockedIn: number;
  lateToday: number;
  onLeaveToday: number;
  notClockedIn: number;
  // Pending approvals across the org
  pendingLeaves: number;
  pendingOT: number;
  pendingDisputes: number;
  // This month (month-to-date) rollup
  monthHours: number;
  monthOtHours: number;
  monthLateCount: number;
  monthUndertimeCount: number;
  // Headcount by department, largest first
  byDepartment: { department: string; count: number }[];
};

// Org-wide stats for the admin/HR dashboard. Gathered in a handful of aggregate
// queries (admin/HR only). `today` and `monthStart` are passed from the client
// so the numbers line up with the user's local business date — consistent with
// the other dashboard server functions.
export const getAdminDashboardStats = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { today: string; monthStart: string }) => data)
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");

    const [headcount, today, leaveToday, pending, month] = await Promise.all([
      pool.query<{ department: string; count: string }>(
        `SELECT COALESCE(NULLIF(department, ''), 'Unassigned') AS department, count(*) AS count
           FROM profiles
          WHERE email IS DISTINCT FROM $1 AND exclude_from_attendance IS NOT TRUE
          GROUP BY 1
          ORDER BY count(*) DESC, 1 ASC`,
        [MONITORING_EXCLUDED_EMAIL],
      ),
      pool.query<{ present: string; still_in: string; late: string }>(
        `SELECT count(*) FILTER (WHERE d.time_in IS NOT NULL) AS present,
                count(*) FILTER (WHERE d.time_in IS NOT NULL AND d.time_out IS NULL) AS still_in,
                count(*) FILTER (WHERE d.late_minutes > 0) AS late
           FROM daily_time_reports d
           JOIN profiles p ON p.id = d.employee_id
          WHERE d.work_date = $1
            AND p.email IS DISTINCT FROM $2 AND p.exclude_from_attendance IS NOT TRUE`,
        [data.today, MONITORING_EXCLUDED_EMAIL],
      ),
      pool.query<{ on_leave: string }>(
        `SELECT count(DISTINCT lr.employee_id) AS on_leave
           FROM leave_requests lr
           JOIN profiles p ON p.id = lr.employee_id
          WHERE lr.status = 'approved' AND lr.start_date <= $1 AND lr.end_date >= $1
            AND p.email IS DISTINCT FROM $2 AND p.exclude_from_attendance IS NOT TRUE`,
        [data.today, MONITORING_EXCLUDED_EMAIL],
      ),
      pool.query<{ leaves: string; ot: string; disputes: string }>(
        `SELECT (SELECT count(*) FROM leave_requests WHERE status = 'pending') AS leaves,
                (SELECT count(*) FROM ot_approval_requests WHERE status = 'pending') AS ot,
                (SELECT count(*) FROM attendance_disputes WHERE status = 'pending') AS disputes`,
      ),
      pool.query<{
        hours: string;
        ot_hours: string;
        late_count: string;
        undertime_count: string;
      }>(
        `SELECT COALESCE(SUM(d.hours_worked), 0) AS hours,
                COALESCE(SUM(d.overtime_hours), 0) AS ot_hours,
                count(*) FILTER (WHERE d.late_minutes > 0) AS late_count,
                count(*) FILTER (WHERE d.is_undertime) AS undertime_count
           FROM daily_time_reports d
           JOIN profiles p ON p.id = d.employee_id
          WHERE d.work_date >= $1 AND d.work_date <= $2
            AND p.email IS DISTINCT FROM $3 AND p.exclude_from_attendance IS NOT TRUE`,
        [data.monthStart, data.today, MONITORING_EXCLUDED_EMAIL],
      ),
    ]);

    const totalEmployees = headcount.rows.reduce((s, r) => s + Number(r.count), 0);
    const presentToday = Number(today.rows[0]?.present ?? 0);
    const onLeaveToday = Number(leaveToday.rows[0]?.on_leave ?? 0);

    return {
      totalEmployees,
      presentToday,
      stillClockedIn: Number(today.rows[0]?.still_in ?? 0),
      lateToday: Number(today.rows[0]?.late ?? 0),
      onLeaveToday,
      notClockedIn: Math.max(0, totalEmployees - presentToday - onLeaveToday),
      pendingLeaves: Number(pending.rows[0]?.leaves ?? 0),
      pendingOT: Number(pending.rows[0]?.ot ?? 0),
      pendingDisputes: Number(pending.rows[0]?.disputes ?? 0),
      monthHours: Number(month.rows[0]?.hours ?? 0),
      monthOtHours: Number(month.rows[0]?.ot_hours ?? 0),
      monthLateCount: Number(month.rows[0]?.late_count ?? 0),
      monthUndertimeCount: Number(month.rows[0]?.undertime_count ?? 0),
      byDepartment: headcount.rows.map((r) => ({
        department: r.department,
        count: Number(r.count),
      })),
    } satisfies AdminDashboardStats;
  });

export type RosterEntry = {
  id: string;
  name: string;
  department: string | null;
  timeIn: string | null;
  timeOut: string | null;
  shift: string | null;
  lateMinutes: number;
  leaveType: string | null;
  halfDay: boolean;
  halfDayPeriod: "AM" | "PM" | null;
  leaveEnd: string | null;
};

export type AttendanceRoster = {
  present: RosterEntry[];
  onLeave: RosterEntry[];
  notClockedIn: RosterEntry[];
};

// Who is present / on leave / not clocked in today. Powers the click-through
// drill-downs on the dashboard metric cards. "Late" is derived client-side from
// the present list (lateMinutes > 0). Admin/HR only.
export const getAdminAttendanceRoster = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { today: string }) => data)
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");

    const [present, onLeave, notIn] = await Promise.all([
      pool.query<{
        id: string;
        full_name: string;
        department: string | null;
        time_in: string | null;
        time_out: string | null;
        shift_label: string | null;
        late_minutes: number;
      }>(
        `SELECT p.id, p.full_name, p.department,
                d.time_in, d.time_out, d.shift_label, d.late_minutes
           FROM daily_time_reports d
           JOIN profiles p ON p.id = d.employee_id
          WHERE d.work_date = $1 AND d.time_in IS NOT NULL
            AND p.email IS DISTINCT FROM $2 AND p.exclude_from_attendance IS NOT TRUE
          ORDER BY p.full_name ASC`,
        [data.today, MONITORING_EXCLUDED_EMAIL],
      ),
      pool.query<{
        id: string;
        full_name: string;
        department: string | null;
        leave_type: string;
        half_day: boolean;
        half_day_period: "AM" | "PM" | null;
        end_date: string;
      }>(
        `SELECT DISTINCT ON (p.id) p.id, p.full_name, p.department,
                lr.leave_type, lr.half_day, lr.half_day_period, lr.end_date
           FROM leave_requests lr
           JOIN profiles p ON p.id = lr.employee_id
          WHERE lr.status = 'approved' AND lr.start_date <= $1 AND lr.end_date >= $1
            AND p.email IS DISTINCT FROM $2 AND p.exclude_from_attendance IS NOT TRUE
          ORDER BY p.id, lr.start_date ASC`,
        [data.today, MONITORING_EXCLUDED_EMAIL],
      ),
      pool.query<{ id: string; full_name: string; department: string | null }>(
        `SELECT p.id, p.full_name, p.department
           FROM profiles p
          WHERE p.email IS DISTINCT FROM $2 AND p.exclude_from_attendance IS NOT TRUE
            AND p.id NOT IN (
                  SELECT employee_id FROM daily_time_reports
                   WHERE work_date = $1 AND time_in IS NOT NULL)
            AND p.id NOT IN (
                  SELECT employee_id FROM leave_requests
                   WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1)
          ORDER BY p.full_name ASC`,
        [data.today, MONITORING_EXCLUDED_EMAIL],
      ),
    ]);

    const blank = {
      timeIn: null,
      timeOut: null,
      shift: null,
      lateMinutes: 0,
      leaveType: null,
      halfDay: false,
      halfDayPeriod: null,
      leaveEnd: null,
    } as const;

    return {
      present: present.rows.map((r) => ({
        ...blank,
        id: r.id,
        name: r.full_name,
        department: r.department,
        timeIn: r.time_in,
        timeOut: r.time_out,
        shift: r.shift_label,
        lateMinutes: Number(r.late_minutes ?? 0),
      })),
      onLeave: onLeave.rows
        .map((r) => ({
          ...blank,
          id: r.id,
          name: r.full_name,
          department: r.department,
          leaveType: r.leave_type,
          halfDay: r.half_day,
          halfDayPeriod: r.half_day_period,
          leaveEnd: r.end_date,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      notClockedIn: notIn.rows.map((r) => ({
        ...blank,
        id: r.id,
        name: r.full_name,
        department: r.department,
      })),
    } satisfies AttendanceRoster;
  });

export type TeamDashboardStats = {
  hasTeam: boolean;
  teamSize: number;
  presentToday: number;
  stillClockedIn: number;
  lateToday: number;
  onLeaveToday: number;
  notClockedIn: number;
  // Pending approvals where the signed-in user is the current approver.
  pendingLeaves: number;
  pendingOT: number;
  pendingDisputes: number;
};

// Team-lead dashboard for any approver (not just HR/admin): "today at a glance"
// scoped to the user's subordinates, plus the count of requests waiting on them
// across leaves / OT / disputes. Self-scoping comes from the org chart.
export const getMyTeamDashboardStats = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { today: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { resolveSubordinates } = await import("@/lib/chain.server");
    const me = context.user.dbUserId;
    const subs = await resolveSubordinates(pool, me);

    // Requests where I'm the next approver in the chain (1-indexed arrays).
    const pending = await pool.query<{ leaves: string; ot: string; disputes: string }>(
      `SELECT
         (SELECT count(*) FROM leave_requests
           WHERE status = 'pending' AND approver_chain[current_approver_index + 1] = $1) AS leaves,
         (SELECT count(*) FROM ot_approval_requests
           WHERE status = 'pending' AND approver_chain[current_approver_index + 1] = $1) AS ot,
         (SELECT count(*) FROM attendance_disputes
           WHERE status = 'pending' AND approver_chain[current_approver_index + 1] = $1) AS disputes`,
      [me],
    );
    const pendingLeaves = Number(pending.rows[0]?.leaves ?? 0);
    const pendingOT = Number(pending.rows[0]?.ot ?? 0);
    const pendingDisputes = Number(pending.rows[0]?.disputes ?? 0);

    const emptyTeam = {
      hasTeam: false as boolean,
      teamSize: 0,
      presentToday: 0,
      stillClockedIn: 0,
      lateToday: 0,
      onLeaveToday: 0,
      notClockedIn: 0,
      pendingLeaves,
      pendingOT,
      pendingDisputes,
    } satisfies TeamDashboardStats;

    if (subs.length === 0) return emptyTeam;

    const [teamCount, today, leaveToday] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT count(*) AS count
           FROM profiles
          WHERE id = ANY($1::uuid[])
            AND email IS DISTINCT FROM $2 AND exclude_from_attendance IS NOT TRUE`,
        [subs, MONITORING_EXCLUDED_EMAIL],
      ),
      pool.query<{ present: string; still_in: string; late: string }>(
        `SELECT count(*) FILTER (WHERE d.time_in IS NOT NULL) AS present,
                count(*) FILTER (WHERE d.time_in IS NOT NULL AND d.time_out IS NULL) AS still_in,
                count(*) FILTER (WHERE d.late_minutes > 0) AS late
           FROM daily_time_reports d
           JOIN profiles p ON p.id = d.employee_id
          WHERE d.work_date = $1 AND d.employee_id = ANY($2::uuid[])
            AND p.email IS DISTINCT FROM $3 AND p.exclude_from_attendance IS NOT TRUE`,
        [data.today, subs, MONITORING_EXCLUDED_EMAIL],
      ),
      pool.query<{ on_leave: string }>(
        `SELECT count(DISTINCT lr.employee_id) AS on_leave
           FROM leave_requests lr
           JOIN profiles p ON p.id = lr.employee_id
          WHERE lr.status = 'approved' AND lr.start_date <= $1 AND lr.end_date >= $1
            AND lr.employee_id = ANY($2::uuid[])
            AND p.email IS DISTINCT FROM $3 AND p.exclude_from_attendance IS NOT TRUE`,
        [data.today, subs, MONITORING_EXCLUDED_EMAIL],
      ),
    ]);

    const teamSize = Number(teamCount.rows[0]?.count ?? 0);
    if (teamSize === 0) return emptyTeam;

    const presentToday = Number(today.rows[0]?.present ?? 0);
    const onLeaveToday = Number(leaveToday.rows[0]?.on_leave ?? 0);

    return {
      hasTeam: true,
      teamSize,
      presentToday,
      stillClockedIn: Number(today.rows[0]?.still_in ?? 0),
      lateToday: Number(today.rows[0]?.late ?? 0),
      onLeaveToday,
      notClockedIn: Math.max(0, teamSize - presentToday - onLeaveToday),
      pendingLeaves,
      pendingOT,
      pendingDisputes,
    } satisfies TeamDashboardStats;
  });

// Roster drill-down scoped to the signed-in user's subordinates (same shape as
// getAdminAttendanceRoster). Powers the team dashboard's clickable cards.
export const getMyTeamRoster = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { today: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { resolveSubordinates } = await import("@/lib/chain.server");
    const subs = await resolveSubordinates(pool, context.user.dbUserId);

    const blank = {
      timeIn: null,
      timeOut: null,
      shift: null,
      lateMinutes: 0,
      leaveType: null,
      halfDay: false,
      halfDayPeriod: null,
      leaveEnd: null,
    } as const;

    if (subs.length === 0) {
      return { present: [], onLeave: [], notClockedIn: [] } satisfies AttendanceRoster;
    }

    const [present, onLeave, notIn] = await Promise.all([
      pool.query<{
        id: string;
        full_name: string;
        department: string | null;
        time_in: string | null;
        time_out: string | null;
        shift_label: string | null;
        late_minutes: number;
      }>(
        `SELECT p.id, p.full_name, p.department,
                d.time_in, d.time_out, d.shift_label, d.late_minutes
           FROM daily_time_reports d
           JOIN profiles p ON p.id = d.employee_id
          WHERE d.work_date = $1 AND d.time_in IS NOT NULL AND d.employee_id = ANY($2::uuid[])
            AND p.email IS DISTINCT FROM $3 AND p.exclude_from_attendance IS NOT TRUE
          ORDER BY p.full_name ASC`,
        [data.today, subs, MONITORING_EXCLUDED_EMAIL],
      ),
      pool.query<{
        id: string;
        full_name: string;
        department: string | null;
        leave_type: string;
        half_day: boolean;
        half_day_period: "AM" | "PM" | null;
        end_date: string;
      }>(
        `SELECT DISTINCT ON (p.id) p.id, p.full_name, p.department,
                lr.leave_type, lr.half_day, lr.half_day_period, lr.end_date
           FROM leave_requests lr
           JOIN profiles p ON p.id = lr.employee_id
          WHERE lr.status = 'approved' AND lr.start_date <= $1 AND lr.end_date >= $1
            AND lr.employee_id = ANY($2::uuid[])
            AND p.email IS DISTINCT FROM $3 AND p.exclude_from_attendance IS NOT TRUE
          ORDER BY p.id, lr.start_date ASC`,
        [data.today, subs, MONITORING_EXCLUDED_EMAIL],
      ),
      pool.query<{ id: string; full_name: string; department: string | null }>(
        `SELECT p.id, p.full_name, p.department
           FROM profiles p
          WHERE p.id = ANY($2::uuid[])
            AND p.email IS DISTINCT FROM $3 AND p.exclude_from_attendance IS NOT TRUE
            AND p.id NOT IN (
                  SELECT employee_id FROM daily_time_reports
                   WHERE work_date = $1 AND time_in IS NOT NULL)
            AND p.id NOT IN (
                  SELECT employee_id FROM leave_requests
                   WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1)
          ORDER BY p.full_name ASC`,
        [data.today, subs, MONITORING_EXCLUDED_EMAIL],
      ),
    ]);

    return {
      present: present.rows.map((r) => ({
        ...blank,
        id: r.id,
        name: r.full_name,
        department: r.department,
        timeIn: r.time_in,
        timeOut: r.time_out,
        shift: r.shift_label,
        lateMinutes: Number(r.late_minutes ?? 0),
      })),
      onLeave: onLeave.rows
        .map((r) => ({
          ...blank,
          id: r.id,
          name: r.full_name,
          department: r.department,
          leaveType: r.leave_type,
          halfDay: r.half_day,
          halfDayPeriod: r.half_day_period,
          leaveEnd: r.end_date,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      notClockedIn: notIn.rows.map((r) => ({
        ...blank,
        id: r.id,
        name: r.full_name,
        department: r.department,
      })),
    } satisfies AttendanceRoster;
  });
