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

// PH calendar date (UTC+8, no DST) as YYYY-MM-DD. Server-authoritative "today"
// for absence computation — Cloud Run runs in UTC, so we offset explicitly
// rather than trust the caller's browser timezone.
function phTodayIso(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// PH wall-clock time (UTC+8, no DST) as HH:MM. Server-authoritative "now" for the
// clock-out moment — the client's submitted time is never trusted.
function phNowHHMM(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(11, 16);
}

function isoDateFrom(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isoDaysBefore(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - days);
  return isoDateFrom(d);
}

// PH calendar date (YYYY-MM-DD) of a stored UTC timestamp.
function phDateOf(isoTimestamp: string): string {
  return new Date(new Date(isoTimestamp).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Absence tracking went live on this date; days before it are never flagged
// absent (no retroactive absences from before the system tracked attendance).
const ABSENCE_TRACKING_START = "2026-06-16";

// System/service account always excluded from attendance & absence monitoring,
// matched by email (the row id differs across environments). Individual
// employees can additionally opt out via profiles.exclude_from_attendance.
const MONITORING_EXCLUDED_EMAIL = "localadmin@hris.local";

type LeaveSpan = { start_date: string; end_date: string };

// A synthesized "absent" record, shaped like a daily_time_reports row so report
// renderers can treat it the same as a real one. Absence is computed live, never
// stored: a past workday with no clock-in and no approved/pending leave.
function makeAbsentRow(employeeId: string, workDate: string): Record<string, unknown> {
  return {
    id: `absent-${employeeId}-${workDate}`,
    employee_id: employeeId,
    work_date: workDate,
    time_in: null,
    time_out: null,
    hours_worked: 0,
    overtime_hours: 0,
    late_minutes: 0,
    shift_label: null,
    is_undertime: false,
    undertime_minutes: 0,
    is_absent: true,
    is_leave: false,
    leave_type: null,
    ot_status: null,
    created_at: null,
  };
}

// Weekdays (Mon–Fri) in [startDate, endDate] that fall strictly before PH-today
// and have neither a clock-in (dtrDates) nor a covering approved/pending leave.
// `notBefore` floors the scan at the employee's account-creation date so days
// before they existed in the system aren't flagged absent.
function computeAbsentDays(
  employeeId: string,
  startDate: string,
  endDate: string,
  dtrDates: Set<string>,
  leaves: LeaveSpan[],
  notBefore: string,
  holidays: Set<string>,
): Record<string, unknown>[] {
  const today = phTodayIso();
  // Floor the scan at the later of: range start, the employee's hire date, and
  // the global absence-tracking start date.
  let from = startDate;
  if (from < notBefore) from = notBefore;
  if (from < ABSENCE_TRACKING_START) from = ABSENCE_TRACKING_START;
  const out: Record<string, unknown>[] = [];
  const cur = new Date(from + "T00:00:00");
  for (;;) {
    const iso = isoDateFrom(cur);
    if (iso > endDate || iso >= today) break; // past the range or not yet over
    const dow = cur.getDay(); // 0 Sun … 6 Sat
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) {
      const onLeave = leaves.some((l) => l.start_date <= iso && iso <= l.end_date);
      if (!dtrDates.has(iso) && !onLeave) out.push(makeAbsentRow(employeeId, iso));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// Clock-in/out GPS coordinates are captured for HR audit ONLY and are surfaced
// solely through the assertHR-gated activity log. The employee-facing queries
// below fetch whole rows via SELECT *, so we strip the location columns in place
// to keep this location PII off the employee dashboard/DTR payloads (nothing
// there renders it). Mutating the row (rather than mapping to a new object)
// keeps the rows loosely typed, so the server fn's serialized shape is
// unchanged. Absence rows never carry these keys.
function stripLocationColumns(row: Record<string, unknown>): void {
  delete row.clock_in_lat;
  delete row.clock_in_lon;
  delete row.clock_in_accuracy;
  delete row.clock_in_loc_status;
  delete row.clock_out_lat;
  delete row.clock_out_lon;
  delete row.clock_out_accuracy;
  delete row.clock_out_loc_status;
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
    const empId = context.user.dbUserId;
    const today = phTodayIso();
    const startDate = today.slice(0, 7) + "-01"; // first of current PH month
    const { fetchActiveHolidayDates } = await import("@/lib/holiday-functions");
    const [{ rows }, { rows: leaves }, { rows: prof }, holidays] = await Promise.all([
      pool.query(
        `SELECT * FROM daily_time_reports
         WHERE employee_id = $1 AND work_date >= $2
         ORDER BY work_date DESC`,
        [empId, startDate],
      ),
      pool.query<LeaveSpan>(
        `SELECT start_date, end_date FROM leave_requests
         WHERE employee_id = $1 AND status IN ('approved', 'pending') AND end_date >= $2`,
        [empId, startDate],
      ),
      pool.query<{ created_at: string; email: string | null; exclude_from_attendance: boolean }>(
        `SELECT created_at, email, exclude_from_attendance FROM profiles WHERE id = $1`,
        [empId],
      ),
      fetchActiveHolidayDates(pool, startDate, today),
    ]);
    const joinDate = prof[0] ? phDateOf(prof[0].created_at) : startDate;
    const excluded =
      prof[0]?.email === MONITORING_EXCLUDED_EMAIL || prof[0]?.exclude_from_attendance === true;
    const dtrDates = new Set(rows.map((r) => r.work_date as string));
    const absents = excluded
      ? []
      : computeAbsentDays(empId, startDate, today, dtrDates, leaves, joinDate, holidays);
    for (const r of rows) stripLocationColumns(r);
    return [...rows, ...absents].sort((a, b) =>
      (b.work_date as string).localeCompare(a.work_date as string),
    );
  });

export const getDTRsForMonth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { yearMonth: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const empId = context.user.dbUserId;
    const [y, m] = data.yearMonth.split("-").map(Number);
    const startDate = `${data.yearMonth}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${data.yearMonth}-${String(lastDay).padStart(2, "0")}`;
    const { fetchActiveHolidayDates } = await import("@/lib/holiday-functions");
    const [{ rows }, { rows: leaves }, { rows: prof }, holidays] = await Promise.all([
      pool.query(
        `SELECT * FROM daily_time_reports
         WHERE employee_id = $1 AND work_date >= $2 AND work_date <= $3
         ORDER BY work_date ASC`,
        [empId, startDate, endDate],
      ),
      pool.query<LeaveSpan>(
        `SELECT start_date, end_date FROM leave_requests
         WHERE employee_id = $1 AND status IN ('approved', 'pending')
           AND start_date <= $3 AND end_date >= $2`,
        [empId, startDate, endDate],
      ),
      pool.query<{ created_at: string; email: string | null; exclude_from_attendance: boolean }>(
        `SELECT created_at, email, exclude_from_attendance FROM profiles WHERE id = $1`,
        [empId],
      ),
      fetchActiveHolidayDates(pool, startDate, endDate),
    ]);
    const joinDate = prof[0] ? phDateOf(prof[0].created_at) : startDate;
    const excluded =
      prof[0]?.email === MONITORING_EXCLUDED_EMAIL || prof[0]?.exclude_from_attendance === true;
    const dtrDates = new Set(rows.map((r) => r.work_date as string));
    const absents = excluded
      ? []
      : computeAbsentDays(empId, startDate, endDate, dtrDates, leaves, joinDate, holidays);
    for (const r of rows) stripLocationColumns(r);
    return [...rows, ...absents].sort((a, b) =>
      (a.work_date as string).localeCompare(b.work_date as string),
    );
  });

// A validated, storage-ready location. Coordinates only ever accompany the
// "captured" status; every other status stores NULL coords.
type StoredLocation = {
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  status: "captured" | "unavailable" | "not_captured";
};

// Location is self-reported by the browser Geolocation API and is validated
// here before it touches the database — never trusted blindly. Anything
// malformed or out of range is coerced to "unavailable" (NULL coords) rather
// than throwing, so a bad payload can never block a legitimate clock-in. These
// coordinates are advisory (audit-only) and are never used to allow/deny.
function normalizeLocation(input: unknown): StoredLocation {
  const NONE: StoredLocation = { lat: null, lon: null, accuracy: null, status: "not_captured" };
  const UNAVAILABLE: StoredLocation = {
    lat: null,
    lon: null,
    accuracy: null,
    status: "unavailable",
  };
  if (input == null || typeof input !== "object") return NONE;
  const o = input as Record<string, unknown>;
  const s = o.status;
  const status =
    s === "captured" || s === "unavailable" || s === "not_captured" ? s : "unavailable";
  // Non-captured statuses never carry coordinates.
  if (status !== "captured") return status === "not_captured" ? NONE : UNAVAILABLE;

  const { lat, lon, accuracy } = o;
  const latOk = typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const lonOk = typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180;
  // Claimed "captured" but the coordinates are garbage → treat as unavailable.
  if (!latOk || !lonOk) return UNAVAILABLE;

  const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const acc =
    typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0
      ? Math.round(accuracy * 10) / 10
      : null;
  return { lat: round6(lat), lon: round6(lon), accuracy: acc, status: "captured" };
}

export const clockInDTR = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    (data: { workDate: string; timeIn: string; shiftLabel: string; location?: unknown }) => data,
  )
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    // Official Business trips are off-site by definition: the office-network
    // geofence is skipped and the day is never late-flagged. Every other shift
    // is geofenced and late-checked normally.
    const isOfficialBusiness = data.shiftLabel === "OB";
    if (!isOfficialBusiness) {
      // Geofence: reject clock-ins that don't originate from a configured office
      // network. No-op when no networks are configured (see office-network-functions).
      const { resolveClientIp, assertOnOfficeNetwork } =
        await import("@/lib/office-network-functions");
      await assertOnOfficeNetwork(pool, resolveClientIp(getRequest()));
    }
    const lateMinutes = isOfficialBusiness ? 0 : lateMinutesFor(data.timeIn);
    const loc = normalizeLocation(data.location);
    await pool.query(
      `INSERT INTO daily_time_reports (employee_id, work_date, time_in, shift_label, cutoff_id, is_undertime, undertime_minutes, late_minutes, clock_in_lat, clock_in_lon, clock_in_accuracy, clock_in_loc_status)
       VALUES ($1, $2, $3, $4, NULL, FALSE, 0, $5, $6, $7, $8, $9)`,
      [
        context.user.dbUserId,
        data.workDate,
        data.timeIn,
        data.shiftLabel,
        lateMinutes,
        loc.lat,
        loc.lon,
        loc.accuracy,
        loc.status,
      ],
    );
  });

// Clock-out is WRITE-ONCE and SERVER-AUTHORITATIVE. Hours/undertime are computed
// from the stored time_in and the SERVER's clock-out time (never the client's
// submitted value), and the UPDATE is guarded by `time_out IS NULL` so a later
// re-submit can't overwrite time_out to inflate hours or erase an undertime flag.
// `timeOut` in the payload is accepted for backward-compat but IGNORED.
export const clockOutDTR = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { dtrId: string; timeOut?: string; location?: unknown }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");

    // Load the caller's own record: time_in drives the hours math; time_out is the
    // write-once gate.
    const {
      rows: [row],
    } = await pool.query<{
      time_in: string | null;
      time_out: string | null;
      hours_worked: number | null;
      is_undertime: boolean | null;
      undertime_minutes: number | null;
    }>(
      `SELECT time_in, time_out, hours_worked, is_undertime, undertime_minutes
         FROM daily_time_reports WHERE id = $1 AND employee_id = $2`,
      [data.dtrId, context.user.dbUserId],
    );
    if (!row) throw new Error("NOT_FOUND");
    if (!row.time_in) throw new Error("NOT_CLOCKED_IN");

    // Already clocked out -> return the recorded punch unchanged (no overwrite).
    if (row.time_out) {
      return {
        hoursWorked: row.hours_worked ?? 0,
        isUndertime: row.is_undertime ?? false,
        undertimeMins: row.undertime_minutes ?? 0,
        timeOut: row.time_out.slice(0, 5),
        alreadyClockedOut: true,
      };
    }

    // SERVER-authoritative clock-out moment (PH). A crafted `data.timeOut` can't
    // backdate or extend the punch.
    const timeOut = phNowHHMM();
    const [ih, im] = row.time_in.split(":").map(Number);
    const [oh, om] = timeOut.split(":").map(Number);
    const totalMins = oh * 60 + om - (ih * 60 + im);
    const hoursWorked = Math.max(0, Math.round((totalMins / 60) * 100) / 100);
    const STANDARD = 9;
    const isUndertime = hoursWorked < STANDARD;
    const undertimeMins = isUndertime ? Math.max(0, Math.round(STANDARD * 60 - totalMins)) : 0;
    const loc = normalizeLocation(data.location);

    // `AND time_out IS NULL` = write-once + race-safe (two concurrent clock-outs:
    // exactly one wins; the loser sees 0 rows and reads back the stored punch).
    const { rowCount } = await pool.query(
      `UPDATE daily_time_reports
         SET time_out = $1, hours_worked = $2, is_undertime = $3, undertime_minutes = $4,
             clock_out_lat = $5, clock_out_lon = $6, clock_out_accuracy = $7, clock_out_loc_status = $8
       WHERE id = $9 AND employee_id = $10 AND time_out IS NULL`,
      [
        timeOut,
        hoursWorked,
        isUndertime,
        undertimeMins,
        loc.lat,
        loc.lon,
        loc.accuracy,
        loc.status,
        data.dtrId,
        context.user.dbUserId,
      ],
    );

    if (rowCount === 0) {
      // Race loser: another clock-out filled time_out first. Return the stored punch.
      const {
        rows: [fresh],
      } = await pool.query<{
        time_out: string | null;
        hours_worked: number | null;
        is_undertime: boolean | null;
        undertime_minutes: number | null;
      }>(
        `SELECT time_out, hours_worked, is_undertime, undertime_minutes
           FROM daily_time_reports WHERE id = $1 AND employee_id = $2`,
        [data.dtrId, context.user.dbUserId],
      );
      return {
        hoursWorked: fresh?.hours_worked ?? hoursWorked,
        isUndertime: fresh?.is_undertime ?? isUndertime,
        undertimeMins: fresh?.undertime_minutes ?? undertimeMins,
        timeOut: fresh?.time_out?.slice(0, 5) ?? timeOut,
        alreadyClockedOut: true,
      };
    }

    return { hoursWorked, isUndertime, undertimeMins, timeOut, alreadyClockedOut: false };
  });

export const getActivityLogDTRs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");

    // Absence is computed live for the trailing 30 days (a bounded window keeps
    // the cross-employee expansion cheap). Fetch real DTRs, the employee roster,
    // and any leave overlapping the window in parallel.
    const { fetchActiveHolidayDates } = await import("@/lib/holiday-functions");
    const today = phTodayIso();
    const windowStart = isoDaysBefore(today, 30);
    const [{ rows }, { rows: profiles }, { rows: winDtrs }, { rows: winLeaves }, holidays] =
      await Promise.all([
        pool.query(
          `SELECT d.id, d.employee_id, d.work_date, d.time_in, d.time_out,
                  d.hours_worked, d.shift_label, d.is_undertime, d.undertime_minutes, d.late_minutes, d.created_at,
                  d.clockout_channel,
                  d.clock_in_lat, d.clock_in_lon, d.clock_in_accuracy, d.clock_in_loc_status,
                  d.clock_out_lat, d.clock_out_lon, d.clock_out_accuracy, d.clock_out_loc_status,
                  p.full_name, p.employee_code, p.department
           FROM daily_time_reports d
           LEFT JOIN profiles p ON p.id = d.employee_id
           WHERE p.email IS DISTINCT FROM $1 AND p.exclude_from_attendance IS NOT TRUE
           ORDER BY d.work_date DESC, d.time_in DESC
           LIMIT 1000`,
          [MONITORING_EXCLUDED_EMAIL],
        ),
        pool.query(
          `SELECT id, full_name, employee_code, department, created_at FROM profiles
            WHERE email IS DISTINCT FROM $1 AND exclude_from_attendance IS NOT TRUE`,
          [MONITORING_EXCLUDED_EMAIL],
        ),
        pool.query<{ employee_id: string; work_date: string }>(
          `SELECT employee_id, work_date FROM daily_time_reports
           WHERE work_date >= $1 AND work_date < $2`,
          [windowStart, today],
        ),
        pool.query<{ employee_id: string; start_date: string; end_date: string }>(
          `SELECT employee_id, start_date, end_date FROM leave_requests
           WHERE status IN ('approved', 'pending') AND end_date >= $1 AND start_date < $2`,
          [windowStart, today],
        ),
        fetchActiveHolidayDates(pool, windowStart, today),
      ]);

    type Entry = {
      id: string;
      employee_id: string;
      work_date: string;
      time_in: string | null;
      time_out: string | null;
      hours_worked: number | null;
      shift_label: string | null;
      is_undertime: boolean | null;
      undertime_minutes: number | null;
      late_minutes: number | null;
      created_at: string | null;
      clockout_channel: string | null;
      clock_in_lat: number | null;
      clock_in_lon: number | null;
      clock_in_accuracy: number | null;
      clock_in_loc_status: string | null;
      clock_out_lat: number | null;
      clock_out_lon: number | null;
      clock_out_accuracy: number | null;
      clock_out_loc_status: string | null;
      is_absent: boolean;
      profile: {
        full_name: string;
        employee_code: string | null;
        department: string | null;
      } | null;
    };

    const entries: Entry[] = rows.map((r) => ({
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
      clockout_channel: r.clockout_channel as string | null,
      clock_in_lat: r.clock_in_lat as number | null,
      clock_in_lon: r.clock_in_lon as number | null,
      clock_in_accuracy: r.clock_in_accuracy as number | null,
      clock_in_loc_status: r.clock_in_loc_status as string | null,
      clock_out_lat: r.clock_out_lat as number | null,
      clock_out_lon: r.clock_out_lon as number | null,
      clock_out_accuracy: r.clock_out_accuracy as number | null,
      clock_out_loc_status: r.clock_out_loc_status as string | null,
      is_absent: false,
      profile: r.full_name
        ? {
            full_name: r.full_name as string,
            employee_code: r.employee_code as string | null,
            department: r.department as string | null,
          }
        : null,
    }));

    // Per-employee index of clocked-in dates and leave spans within the window.
    const dtrByEmp = new Map<string, Set<string>>();
    for (const d of winDtrs) {
      let s = dtrByEmp.get(d.employee_id);
      if (!s) dtrByEmp.set(d.employee_id, (s = new Set()));
      s.add(d.work_date);
    }
    const leavesByEmp = new Map<string, LeaveSpan[]>();
    for (const l of winLeaves) {
      const arr = leavesByEmp.get(l.employee_id) ?? [];
      arr.push({ start_date: l.start_date, end_date: l.end_date });
      leavesByEmp.set(l.employee_id, arr);
    }

    for (const p of profiles) {
      const empId = p.id as string;
      const joinDate = p.created_at ? phDateOf(p.created_at as string) : windowStart;
      const absents = computeAbsentDays(
        empId,
        windowStart,
        today,
        dtrByEmp.get(empId) ?? new Set(),
        leavesByEmp.get(empId) ?? [],
        joinDate,
        holidays,
      );
      for (const a of absents) {
        entries.push({
          id: a.id as string,
          employee_id: empId,
          work_date: a.work_date as string,
          time_in: null,
          time_out: null,
          hours_worked: null,
          shift_label: null,
          is_undertime: false,
          undertime_minutes: null,
          late_minutes: null,
          created_at: null,
          clockout_channel: null,
          clock_in_lat: null,
          clock_in_lon: null,
          clock_in_accuracy: null,
          clock_in_loc_status: null,
          clock_out_lat: null,
          clock_out_lon: null,
          clock_out_accuracy: null,
          clock_out_loc_status: null,
          is_absent: true,
          profile: {
            full_name: p.full_name as string,
            employee_code: p.employee_code as string | null,
            department: p.department as string | null,
          },
        });
      }
    }

    return entries;
  });

// Real-time roster for TODAY: every employee's current status. "pending" =
// not yet clocked in and not on leave — i.e. an absence-in-progress that will be
// confirmed at end of day. On a weekend or holiday nobody is expected, so the UI
// frames those days differently (no pending = absent).
export const getTodayRoster = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");
    const { fetchActiveHolidayDates } = await import("@/lib/holiday-functions");

    const today = phTodayIso();
    const dow = new Date(today + "T00:00:00").getDay();
    const isWeekend = dow === 0 || dow === 6;

    const [{ rows: profiles }, { rows: dtrs }, { rows: leaves }, holidays, { rows: hol }] =
      await Promise.all([
        pool.query(
          `SELECT id, full_name, employee_code, department, created_at FROM profiles
            WHERE email IS DISTINCT FROM $1 AND exclude_from_attendance IS NOT TRUE
            ORDER BY full_name`,
          [MONITORING_EXCLUDED_EMAIL],
        ),
        pool.query<{
          employee_id: string;
          time_in: string | null;
          time_out: string | null;
          late_minutes: number | null;
          shift_label: string | null;
        }>(
          `SELECT employee_id, time_in, time_out, late_minutes, shift_label
           FROM daily_time_reports WHERE work_date = $1`,
          [today],
        ),
        pool.query<{ employee_id: string; leave_type: string }>(
          `SELECT employee_id, leave_type FROM leave_requests
           WHERE status IN ('approved', 'pending') AND start_date <= $1 AND end_date >= $1`,
          [today],
        ),
        fetchActiveHolidayDates(pool, today, today),
        pool.query<{ name: string }>(
          `SELECT name FROM holidays WHERE is_active = true AND holiday_date = $1 LIMIT 1`,
          [today],
        ),
      ]);

    const dtrByEmp = new Map(dtrs.map((d) => [d.employee_id, d]));
    const leaveByEmp = new Map(leaves.map((l) => [l.employee_id, l.leave_type]));
    const holidayName = holidays.has(today) ? (hol[0]?.name ?? "Holiday") : null;

    const employees = profiles
      .filter((p) => phDateOf(p.created_at as string) <= today)
      .map((p) => {
        const empId = p.id as string;
        const dtr = dtrByEmp.get(empId);
        const leaveType = leaveByEmp.get(empId);
        const status: "present" | "leave" | "pending" = dtr?.time_in
          ? "present"
          : leaveType
            ? "leave"
            : "pending";
        return {
          id: empId,
          full_name: p.full_name as string,
          employee_code: p.employee_code as string | null,
          department: p.department as string | null,
          status,
          time_in: dtr?.time_in ?? null,
          time_out: dtr?.time_out ?? null,
          late_minutes: dtr?.late_minutes ?? null,
          shift_label: dtr?.shift_label ?? null,
          leave_type: leaveType ?? null,
        };
      });

    return { date: today, isWeekend, holidayName, employees };
  });
