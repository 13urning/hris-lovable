import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { authMiddleware, assertUser, assertHR } from "@/lib/auth-middleware";

// Company-wide tardiness rule: any clock-in after 09:00 is late, regardless of
// the employee's shift. Returns minutes past 09:00 (0 = on time).
const LATE_CUTOFF_MINUTES = 9 * 60; // 09:00
function lateMinutesFor(timeIn: string): number {
  const [h, m] = timeIn.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return Math.max(0, h * 60 + m - LATE_CUTOFF_MINUTES);
}

export const getTodayDTR = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { date: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, time_in, time_out, hours_worked, shift_label, is_undertime, undertime_minutes, late_minutes
       FROM daily_time_reports WHERE employee_id = $1 AND work_date = $2 LIMIT 1`,
      [context.user.dbUserId, data.date],
    );
    return (rows[0] ?? null) as {
      id: string;
      time_in: string | null;
      time_out: string | null;
      hours_worked: number | null;
      shift_label: string | null;
      is_undertime: boolean | null;
      undertime_minutes: number | null;
      late_minutes: number | null;
    } | null;
  });

export const getRecentDTRsQuery = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM daily_time_reports
       WHERE employee_id = $1
         AND work_date >= date_trunc('month', CURRENT_DATE)::date
       ORDER BY work_date DESC`,
      [context.user.dbUserId],
    );
    return rows;
  });

export const getDTRsForMonth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { yearMonth: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const [y, m] = data.yearMonth.split("-").map(Number);
    const startDate = `${data.yearMonth}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${data.yearMonth}-${String(lastDay).padStart(2, "0")}`;
    const { rows } = await pool.query(
      `SELECT * FROM daily_time_reports
       WHERE employee_id = $1 AND work_date >= $2 AND work_date <= $3
       ORDER BY work_date ASC`,
      [context.user.dbUserId, startDate, endDate],
    );
    return rows;
  });

export const clockInDTR = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { workDate: string; timeIn: string; shiftLabel: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    // Geofence: reject clock-ins that don't originate from a configured office
    // network. No-op when no networks are configured (see office-network-functions).
    const { resolveClientIp, assertOnOfficeNetwork } =
      await import("@/lib/office-network-functions");
    await assertOnOfficeNetwork(pool, resolveClientIp(getRequest()));
    const lateMinutes = lateMinutesFor(data.timeIn);
    await pool.query(
      `INSERT INTO daily_time_reports (employee_id, work_date, time_in, shift_label, cutoff_id, is_undertime, undertime_minutes, late_minutes)
       VALUES ($1, $2, $3, $4, NULL, FALSE, 0, $5)`,
      [context.user.dbUserId, data.workDate, data.timeIn, data.shiftLabel, lateMinutes],
    );
  });

// Hours worked / undertime are computed SERVER-SIDE from the stored time_in and
// the submitted time_out — never trusted from the client — so an employee can't
// inflate their hours (which feed the payroll cutoff aggregation).
export const clockOutDTR = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { dtrId: string; timeOut: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");

    // Load the caller's own record to get the authoritative time_in.
    const {
      rows: [row],
    } = await pool.query<{ time_in: string | null }>(
      `SELECT time_in FROM daily_time_reports WHERE id = $1 AND employee_id = $2`,
      [data.dtrId, context.user.dbUserId],
    );
    if (!row) throw new Error("NOT_FOUND");
    if (!row.time_in) throw new Error("NOT_CLOCKED_IN");

    const [ih, im] = row.time_in.split(":").map(Number);
    const [oh, om] = data.timeOut.split(":").map(Number);
    const totalMins = oh * 60 + om - (ih * 60 + im);
    const hoursWorked = Math.max(0, Math.round((totalMins / 60) * 100) / 100);
    const STANDARD = 9;
    const isUndertime = hoursWorked < STANDARD;
    const undertimeMins = isUndertime ? Math.max(0, Math.round(STANDARD * 60 - totalMins)) : 0;

    await pool.query(
      `UPDATE daily_time_reports
         SET time_out = $1, hours_worked = $2, is_undertime = $3, undertime_minutes = $4
       WHERE id = $5 AND employee_id = $6`,
      [data.timeOut, hoursWorked, isUndertime, undertimeMins, data.dtrId, context.user.dbUserId],
    );

    return { hoursWorked, isUndertime, undertimeMins };
  });

export const getActivityLogDTRs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT d.id, d.employee_id, d.work_date, d.time_in, d.time_out,
              d.hours_worked, d.shift_label, d.is_undertime, d.undertime_minutes, d.late_minutes, d.created_at,
              p.full_name, p.employee_code, p.department
       FROM daily_time_reports d
       LEFT JOIN profiles p ON p.id = d.employee_id
       ORDER BY d.work_date DESC, d.time_in DESC
       LIMIT 1000`,
    );
    return rows.map((r) => ({
      id: r.id as string,
      employee_id: r.employee_id as string,
      work_date: r.work_date as string,
      time_in: r.time_in as string | null,
      time_out: r.time_out as string | null,
      hours_worked: r.hours_worked as number | null,
      shift_label: r.shift_label as string | null,
      is_undertime: r.is_undertime as boolean | null,
      undertime_minutes: r.undertime_minutes as number | null,
      late_minutes: r.late_minutes as number | null,
      created_at: r.created_at as string | null,
      profile: r.full_name
        ? {
            full_name: r.full_name as string,
            employee_code: r.employee_code as string | null,
            department: r.department as string | null,
          }
        : null,
    }));
  });
