// Occurrence generation for recurring calendar events. Pure calendar math on
// PH wall-clock "YYYY-MM-DD" strings — no timezone conversion here (the server
// converts each date to an instant via the +08:00 literal, same as one-off
// events). Shared by the server (materializing rows) and the create dialog
// (live "creates N occurrences" preview), so both always agree.

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

export const MAX_OCCURRENCES_PER_SERIES = 104; // ~2 years weekly
export const MAX_HORIZON_YEARS = 3;

function parts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
}

function toIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function addDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// Generate the PH-local occurrence DATES for a series, first occurrence =
// anchorDate. Throws stable error codes:
//   HORIZON_EXCEEDED      — untilDate further than MAX_HORIZON_YEARS out
//   TOO_MANY_OCCURRENCES  — rule yields more than the cap before untilDate
//   NO_OCCURRENCES        — untilDate before anchorDate
// Edge rules (deliberate, per design):
//   monthly: CLAMP to the last day of short months, always from the ORIGINAL
//            anchor day (Jan 31 → Feb 28/29 → Mar 31 — never walks to the 28th)
//   yearly:  SKIP Feb 29 in non-leap years (a leap-day event stays a leap-day
//            event; skipped years produce no row)
export function generateOccurrenceDates(
  anchorDate: string,
  frequency: RecurrenceFrequency,
  intervalN: number,
  untilDate: string,
): string[] {
  const anchor = parts(anchorDate);
  const horizon = toIso(
    anchor.y + MAX_HORIZON_YEARS,
    anchor.m,
    Math.min(anchor.d, daysInMonth(anchor.y + MAX_HORIZON_YEARS, anchor.m)),
  );
  if (untilDate > horizon) throw new Error("HORIZON_EXCEEDED");
  if (untilDate < anchorDate) throw new Error("NO_OCCURRENCES");

  const out: string[] = [];
  // Step bound is a hard backstop; every branch below either pushes a date or
  // (yearly Feb 29) skips at most 3 consecutive years within the horizon.
  for (let step = 0; step < 4000; step++) {
    let d: string;
    if (frequency === "daily") {
      d = addDays(anchorDate, step * intervalN);
    } else if (frequency === "weekly") {
      d = addDays(anchorDate, step * intervalN * 7);
    } else if (frequency === "monthly") {
      const monthsOut = step * intervalN;
      const y = anchor.y + Math.floor((anchor.m - 1 + monthsOut) / 12);
      const m = ((anchor.m - 1 + monthsOut) % 12) + 1;
      d = toIso(y, m, Math.min(anchor.d, daysInMonth(y, m)));
    } else {
      const y = anchor.y + step * intervalN;
      if (anchor.m === 2 && anchor.d === 29 && !isLeap(y)) {
        if (toIso(y, 3, 1) > untilDate) break;
        continue;
      }
      d = toIso(y, anchor.m, anchor.d);
    }
    if (d > untilDate) break;
    out.push(d);
    if (out.length > MAX_OCCURRENCES_PER_SERIES) throw new Error("TOO_MANY_OCCURRENCES");
  }
  if (out.length === 0) throw new Error("NO_OCCURRENCES");
  return out;
}
