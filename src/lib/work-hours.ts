// Single source of truth for how a punched day is GRADED — lateness and
// undertime — and for how an approved leave changes that grading.
//
// Several paths write these flags: the interactive clock-in/clock-out
// (dtr-functions), the device tap-toggle (device-clock-in.server), an approved
// attendance dispute (attendance-dispute-functions), and the recompute that runs
// when a leave is approved after the fact (leave-functions). They must all agree,
// or the same day is graded differently depending on how it was punched.
//
// An APPROVED leave shortens what the employee owes that date:
//   - half-day leave  -> 4.5h expected (they work the other half)
//   - full-day leave  -> 0h expected
//   - AM + PM halves  -> 0h expected (a legitimate pair; see the no-overlap guard
//                        in leave-functions, which allows exactly this case)
// And when the MORNING is the part on leave (AM half-day, or any full day), the
// 09:00 late cutoff doesn't apply at all — the employee isn't expected in until
// the afternoon, so clocking in at 13:00 is on time, not four hours late. This
// mirrors how an Official Business day is already exempted. A PM half-day keeps
// the normal 09:00 cutoff, because the employee still works the morning.
//
// `pg` is imported TYPE-ONLY, so this module pulls in no server-only runtime code
// and stays cheap to unit-test.
import type { Pool, PoolClient } from "pg";

// Company-wide standard workday length, in hours.
export const STANDARD_HOURS = 9;

// Company-wide tardiness rule: any clock-in after 09:00 is late, regardless of
// the employee's shift.
export const LATE_CUTOFF_MINUTES = 9 * 60;

// Official Business trip: off-site by definition, so never late-flagged.
const OB_SHIFT = "OB";

// Minutes since midnight for a "HH:MM" / "HH:MM:SS" time string.
export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Raw minutes past the 09:00 cutoff (0 = on time). Callers should prefer
// computeDayFlags, which also applies the OB and leave exemptions.
export function lateMinutesFor(timeIn: string): number {
  const [h, m] = timeIn.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return Math.max(0, h * 60 + m - LATE_CUTOFF_MINUTES);
}

// Latest clock-out an employee may SELF-REPORT for a day they forgot to close.
//
// Every fixed shift is STANDARD_HOURS long and its code names the start hour
// ("8-5" -> 08:00, so the bar is 17:00). Official Business has no fixed end, so
// the ceiling is a standard day measured from when they actually clocked in.
//
// This is the guard rail on the whole self-report path: because a self-report
// skips the approver chain, it must never be able to manufacture a longer day
// than the employee was rostered for. Anyone genuinely owed more files an
// attendance dispute, where a human looks at it.
export function selfReportCapMinutes(
  shiftLabel: string | null | undefined,
  timeIn: string,
): number {
  const inMins = minutesOfDay(timeIn);
  const startHour = Number(String(shiftLabel ?? "").split("-")[0]);
  if (shiftLabel === OB_SHIFT || !Number.isFinite(startHour) || startHour <= 0) {
    return inMins + STANDARD_HOURS * 60;
  }
  return startHour * 60 + STANDARD_HOURS * 60;
}

export type SelfReportRejection = "BAD_FORMAT" | "BEFORE_CLOCK_IN" | "AFTER_SHIFT_END";

// Validate a self-reported clock-out against its day. Returns null when the time
// is acceptable, or the reason it is not.
export function validateSelfReportedTimeOut(args: {
  timeIn: string;
  timeOut: string;
  shiftLabel: string | null | undefined;
}): SelfReportRejection | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(args.timeOut)) return "BAD_FORMAT";
  const out = minutesOfDay(args.timeOut);
  if (out <= minutesOfDay(args.timeIn)) return "BEFORE_CLOCK_IN";
  if (out > selfReportCapMinutes(args.shiftLabel, args.timeIn)) return "AFTER_SHIFT_END";
  return null;
}

// "HH:MM" for a minutes-since-midnight value, clamped to the end of the day.
export function hhmmOfMinutes(mins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(mins)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

export type WorkedHours = {
  hoursWorked: number;
  isUndertime: boolean;
  undertimeMins: number;
};

// Hours between two SAME-DAY punches, plus the shortfall against `standardHours`
// (pass the value from leaveCoverageFor so an approved leave is respected).
// Math.max(0, ...) clamps out-before-in to 0 — overnight shifts are unsupported
// here, exactly as before. A standardHours of 0 (whole day on leave) can never be
// undertime: hoursWorked is never < 0.
export function computeWorkedHours(
  timeIn: string,
  timeOut: string,
  standardHours: number = STANDARD_HOURS,
): WorkedHours {
  const totalMins = minutesOfDay(timeOut) - minutesOfDay(timeIn);
  const hoursWorked = Math.max(0, Math.round((totalMins / 60) * 100) / 100);
  const isUndertime = hoursWorked < standardHours;
  const undertimeMins = isUndertime ? Math.max(0, Math.round(standardHours * 60 - totalMins)) : 0;
  return { hoursWorked, isUndertime, undertimeMins };
}

export type LeaveCoverage = {
  // Hours the employee is expected to work: 9, 4.5, or 0.
  standardHours: number;
  // True when the MORNING is on leave, so the 09:00 late cutoff doesn't apply.
  lateExempt: boolean;
};

// A day with no approved leave on it: the full 9h bar and the normal cutoff.
export const FULL_DAY_COVERAGE: LeaveCoverage = {
  standardHours: STANDARD_HOURS,
  lateExempt: false,
};

// How much of `workDate` ("YYYY-MM-DD") this employee has covered by APPROVED
// leave. Only 'approved' counts: a pending, rejected or cancelled filing doesn't
// shorten the expected day.
//
// A half-day row with a NULL period is malformed (the app always sets one); the
// `NOT half_day OR half_day_period = 'AM'` term yields NULL for it, which BOOL_OR
// skips, so it conservatively does NOT win a late exemption.
export async function leaveCoverageFor(
  db: Pool | PoolClient,
  employeeId: string,
  workDate: string,
): Promise<LeaveCoverage> {
  const {
    rows: [row],
  } = await db.query<{ leave_fraction: string | number | null; morning_covered: boolean | null }>(
    `SELECT COALESCE(SUM(CASE WHEN half_day THEN 0.5 ELSE 1 END), 0) AS leave_fraction,
            BOOL_OR(NOT half_day OR half_day_period = 'AM')          AS morning_covered
       FROM leave_requests
      WHERE employee_id = $1
        AND status = 'approved'
        AND $2::date BETWEEN start_date AND end_date`,
    [employeeId, workDate],
  );
  // SUM() of a numeric comes back as a string from pg; Number() normalizes both.
  const covered = Math.min(1, Math.max(0, Number(row?.leave_fraction ?? 0) || 0));
  return {
    standardHours: STANDARD_HOURS * (1 - covered),
    lateExempt: row?.morning_covered === true,
  };
}

export type DayFlags = {
  lateMinutes: number;
  hoursWorked: number;
  isUndertime: boolean;
  undertimeMins: number;
};

// The one place the exemptions are applied. An open day (no clock-out yet) gets
// its lateness graded but no hours/undertime — those land at clock-out.
export function computeDayFlags(args: {
  timeIn: string;
  timeOut?: string | null;
  shiftLabel?: string | null;
  coverage?: LeaveCoverage;
}): DayFlags {
  const coverage = args.coverage ?? FULL_DAY_COVERAGE;
  const exempt = args.shiftLabel === OB_SHIFT || coverage.lateExempt;
  const lateMinutes = exempt ? 0 : lateMinutesFor(args.timeIn);
  if (!args.timeOut) {
    return { lateMinutes, hoursWorked: 0, isUndertime: false, undertimeMins: 0 };
  }
  return {
    lateMinutes,
    ...computeWorkedHours(args.timeIn, args.timeOut, coverage.standardHours),
  };
}

// Re-grade already-stored days after the fact — used when a leave is APPROVED (or
// an approved one is deleted) for a date the employee already punched, which
// would otherwise leave a stale late/undertime flag on the row.
//
// Only rows with a clock-in are touched, and `locked_at IS NULL` keeps
// cutoff-locked (submitted/approved payroll) rows immutable. Hours are only
// rewritten once the day is closed; an open day keeps hours_worked = 0 and just
// has its lateness corrected. Returns the number of rows updated.
export async function recomputeLeaveRangeFlags(
  db: Pool | PoolClient,
  employeeId: string,
  startDate: string,
  endDate: string,
): Promise<number> {
  const { rows } = await db.query<{
    id: string;
    work_date: string;
    time_in: string;
    time_out: string | null;
    shift_label: string | null;
  }>(
    `SELECT id, to_char(work_date, 'YYYY-MM-DD') AS work_date,
            to_char(time_in, 'HH24:MI')  AS time_in,
            to_char(time_out, 'HH24:MI') AS time_out,
            shift_label
       FROM daily_time_reports
      WHERE employee_id = $1
        AND work_date BETWEEN $2::date AND $3::date
        AND time_in IS NOT NULL
        AND locked_at IS NULL`,
    [employeeId, startDate, endDate],
  );

  let updated = 0;
  for (const row of rows) {
    const coverage = await leaveCoverageFor(db, employeeId, row.work_date);
    const flags = computeDayFlags({
      timeIn: row.time_in,
      timeOut: row.time_out,
      shiftLabel: row.shift_label,
      coverage,
    });
    // An open day's hours stay untouched (COALESCE-free: we simply don't write
    // them) so a mid-day approval can't zero out a row that's still in progress.
    const { rowCount } = row.time_out
      ? await db.query(
          `UPDATE daily_time_reports
              SET late_minutes = $1, hours_worked = $2,
                  is_undertime = $3, undertime_minutes = $4
            WHERE id = $5 AND locked_at IS NULL`,
          [flags.lateMinutes, flags.hoursWorked, flags.isUndertime, flags.undertimeMins, row.id],
        )
      : await db.query(
          `UPDATE daily_time_reports SET late_minutes = $1 WHERE id = $2 AND locked_at IS NULL`,
          [flags.lateMinutes, row.id],
        );
    updated += rowCount ?? 0;
  }
  return updated;
}
