// Pure calendar-date validation shared by report-functions.ts and
// all-requests.ts. Kept dependency-free (no DB, no server-fn imports) so it can
// be imported by client-bundled modules without dragging server code along.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Floor for any date this app accepts. JS happily parses year 0000, but Postgres
// has no year zero and throws a raw "date/time field value out of range" on the
// cast; nothing in an HR record predates this anyway.
const MIN_DATE = "1900-01-01";

// Shape AND calendar validity — "2026-13-45" / "2026-02-30" match the regex but
// must not reach a ::date cast (Postgres would throw a raw datetime error, or
// worse, silently roll over to a neighboring date).
export function isRealDate(s: string): boolean {
  if (!DATE_RE.test(s) || s < MIN_DATE) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
