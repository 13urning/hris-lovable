import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertHR } from "@/lib/auth-middleware";

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
          GROUP BY 1
          ORDER BY count(*) DESC, 1 ASC`,
      ),
      pool.query<{ present: string; still_in: string; late: string }>(
        `SELECT count(*) FILTER (WHERE time_in IS NOT NULL) AS present,
                count(*) FILTER (WHERE time_in IS NOT NULL AND time_out IS NULL) AS still_in,
                count(*) FILTER (WHERE late_minutes > 0) AS late
           FROM daily_time_reports
          WHERE work_date = $1`,
        [data.today],
      ),
      pool.query<{ on_leave: string }>(
        `SELECT count(DISTINCT employee_id) AS on_leave
           FROM leave_requests
          WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1`,
        [data.today],
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
        `SELECT COALESCE(SUM(hours_worked), 0) AS hours,
                COALESCE(SUM(overtime_hours), 0) AS ot_hours,
                count(*) FILTER (WHERE late_minutes > 0) AS late_count,
                count(*) FILTER (WHERE is_undertime) AS undertime_count
           FROM daily_time_reports
          WHERE work_date >= $1 AND work_date <= $2`,
        [data.monthStart, data.today],
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
          ORDER BY p.full_name ASC`,
        [data.today],
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
          ORDER BY p.id, lr.start_date ASC`,
        [data.today],
      ),
      pool.query<{ id: string; full_name: string; department: string | null }>(
        `SELECT p.id, p.full_name, p.department
           FROM profiles p
          WHERE p.id NOT IN (
                  SELECT employee_id FROM daily_time_reports
                   WHERE work_date = $1 AND time_in IS NOT NULL)
            AND p.id NOT IN (
                  SELECT employee_id FROM leave_requests
                   WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1)
          ORDER BY p.full_name ASC`,
        [data.today],
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
