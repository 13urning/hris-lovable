// Pure OT time-range → hours logic. No server/db imports, so it's cheap to
// unit-test and safe to import on both ends: the client uses it for the live
// preview + budget-cap gate, and the server uses it as the AUTHORITATIVE hours
// (a client-sent hours value no longer exists — it can't be tampered to overrun
// a budget). Single source of truth for the overnight rule and the rounding.

// "HH:MM", 00:00–23:59. The real input guard — native <input type="time"> emits
// this, but the server must never trust that and re-validates here.
export const OT_TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type OtHoursResult = {
  hours: number; // rounded to 2dp — feeds requested_hours (NUMERIC(6,2)) + the cap
  overnight: boolean; // end wrapped past midnight
  minutes: number; // integer minutes, 1..1439
};

// Returns null for structurally invalid input: bad format, or a zero-length
// window (from == to). Callers decide what null means — the server throws
// INVALID_TIME_RANGE; the client keeps the submit disabled ("no preview yet").
export function computeOtHours(timeFrom: string, timeTo: string): OtHoursResult | null {
  if (!OT_TIME_RE.test(timeFrom) || !OT_TIME_RE.test(timeTo)) return null;
  const [fh, fm] = timeFrom.split(":").map(Number);
  const [th, tm] = timeTo.split(":").map(Number);
  const fromMin = fh * 60 + fm;
  const toMin = th * 60 + tm;
  // Reject equal endpoints FIRST — otherwise the overnight branch below would
  // turn 20:00→20:00 into a 24h window instead of the zero-length it is.
  if (fromMin === toMin) return null;
  let minutes = toMin - fromMin;
  const overnight = minutes < 0;
  if (overnight) minutes += 1440; // ends the next day
  // minutes is now provably 1..1439 (max 23:59 span), so no >24h case exists.
  const hours = Math.round((minutes / 60) * 100) / 100;
  return { hours, overnight, minutes };
}

// "20:00" / "20:00:00" → "8:00 PM". Tolerates the "HH:MM:SS" that Postgres `time`
// columns return on read, as well as the "HH:MM" the form sends.
export function to12Hour(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m ?? 0).padStart(2, "0")} ${ampm}`;
}

// "8:00 PM – 1:00 AM" for a stored window, or null when either endpoint is
// missing (legacy actual rows and all budget rows) so callers fall back to hours.
export function formatOtRange(timeFrom: string | null, timeTo: string | null): string | null {
  if (!timeFrom || !timeTo) return null;
  return `${to12Hour(timeFrom)} – ${to12Hour(timeTo)}`;
}
