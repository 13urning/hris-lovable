// Shared absence computation.
//
// Absence is NEVER stored as a row: it is derived at read time as "a past
// workday with no clock-in and no covering leave". Both the employee/HR DTR
// views (dtr-functions) and the admin data export (report-functions) synthesize
// absent rows from THIS single source of truth, so the two can never disagree
// about who was absent. Keep the date rules here; each caller shapes the dates
// into whatever row type it renders.

// PH calendar date (UTC+8, no DST) as YYYY-MM-DD. Server-authoritative "today"
// for absence computation — Cloud Run runs in UTC, so we offset explicitly
// rather than trust the caller's browser timezone.
export function phTodayIso(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function isoDateFrom(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// PH calendar date (YYYY-MM-DD) of a stored UTC timestamp.
export function phDateOf(isoTimestamp: string): string {
  return new Date(new Date(isoTimestamp).getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Absence tracking went live on this date; days before it are never flagged
// absent (no retroactive absences from before the system tracked attendance).
export const ABSENCE_TRACKING_START = "2026-06-16";

export type LeaveSpan = { start_date: string; end_date: string };

// Weekdays (Mon–Fri) in [startDate, endDate] that fall strictly before PH-today
// and have neither a clock-in (dtrDates) nor a covering approved/pending leave.
// `notBefore` floors the scan at the employee's account-creation date so days
// before they existed in the system aren't flagged absent. Returns the absent
// dates as YYYY-MM-DD strings; callers shape them into whatever row they need.
export function computeAbsentDates(
  startDate: string,
  endDate: string,
  dtrDates: Set<string>,
  leaves: LeaveSpan[],
  notBefore: string,
  holidays: Set<string>,
): string[] {
  const today = phTodayIso();
  // Floor the scan at the later of: range start, the employee's hire date, and
  // the global absence-tracking start date.
  let from = startDate;
  if (from < notBefore) from = notBefore;
  if (from < ABSENCE_TRACKING_START) from = ABSENCE_TRACKING_START;
  const out: string[] = [];
  const cur = new Date(from + "T00:00:00");
  for (;;) {
    const iso = isoDateFrom(cur);
    if (iso > endDate || iso >= today) break; // past the range or not yet over
    const dow = cur.getDay(); // 0 Sun … 6 Sat
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) {
      const onLeave = leaves.some((l) => l.start_date <= iso && iso <= l.end_date);
      if (!dtrDates.has(iso) && !onLeave) out.push(iso);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
