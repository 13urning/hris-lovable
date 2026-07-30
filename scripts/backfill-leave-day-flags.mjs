// Backfill: re-grade already-stored DTR days that an APPROVED leave covers.
//
// Before the half-day leave fix, every punched day was graded against a flat 9h
// standard and a flat 09:00 late cutoff, with no knowledge of leave. So an
// employee who filed a half-day and still clocked in/out was tagged undertime,
// and one on an AM half-day was also tagged hours late for arriving in the
// afternoon. The code no longer does that, but rows written before the fix keep
// the wrong flags — this corrects them.
//
// Mirrors src/lib/work-hours.ts exactly (see computeDayFlags / leaveCoverageFor).
// Kept as transcribed JS rather than clever SQL so the arithmetic can be read
// side by side with the TypeScript it has to match.
//
// DRY-RUN BY DEFAULT — prints what it would change and writes nothing. Pass
// --apply to commit.
//
//   node scripts/backfill-leave-day-flags.mjs <db>            # preview
//   node scripts/backfill-leave-day-flags.mjs <db> --apply    # write
//
// Rows with locked_at set (submitted / approved payroll cutoffs) are never
// touched, matching recomputeLeaveRangeFlags.
import { readFileSync } from "node:fs";
import { Pool } from "pg";

const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  env[m[1]] = v;
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const dbName = args.find((a) => !a.startsWith("--")) ?? "wave_hris_staging";

// ── The rule, transcribed from src/lib/work-hours.ts ──────────────────────────
const STANDARD_HOURS = 9;
const LATE_CUTOFF_MINUTES = 9 * 60;

const minutesOfDay = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

function computeDayFlags({ timeIn, timeOut, shiftLabel, standardHours, lateExempt }) {
  const exempt = shiftLabel === "OB" || lateExempt;
  const lateMinutes = exempt ? 0 : Math.max(0, minutesOfDay(timeIn) - LATE_CUTOFF_MINUTES);
  if (!timeOut) return { lateMinutes, isUndertime: false, undertimeMins: 0, open: true };
  const totalMins = minutesOfDay(timeOut) - minutesOfDay(timeIn);
  const hoursWorked = Math.max(0, Math.round((totalMins / 60) * 100) / 100);
  const isUndertime = hoursWorked < standardHours;
  const undertimeMins = isUndertime ? Math.max(0, Math.round(standardHours * 60 - totalMins)) : 0;
  return { lateMinutes, isUndertime, undertimeMins, open: false };
}

const pool = new Pool({
  host: env.DB_HOST,
  port: +env.DB_PORT,
  database: dbName,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
});

// Every unlocked, punched day that at least one approved leave covers, with that
// day's leave coverage aggregated the same way leaveCoverageFor does.
const { rows } = await pool.query(
  `SELECT d.id,
          u.email,
          to_char(d.work_date, 'YYYY-MM-DD') AS work_date,
          to_char(d.time_in,  'HH24:MI')     AS time_in,
          to_char(d.time_out, 'HH24:MI')     AS time_out,
          d.shift_label,
          d.late_minutes,
          d.is_undertime,
          d.undertime_minutes,
          LEAST(1, COALESCE(SUM(CASE WHEN lr.half_day THEN 0.5 ELSE 1 END), 0)) AS covered,
          COALESCE(BOOL_OR(NOT lr.half_day OR lr.half_day_period = 'AM'), false) AS morning_covered
     FROM daily_time_reports d
     JOIN users u ON u.id = d.employee_id
     JOIN leave_requests lr
       ON lr.employee_id = d.employee_id
      AND lr.status = 'approved'
      AND d.work_date BETWEEN lr.start_date AND lr.end_date
    WHERE d.time_in IS NOT NULL
      AND d.locked_at IS NULL
    GROUP BY d.id, u.email
    ORDER BY d.work_date DESC, u.email`,
);

const changes = [];
for (const r of rows) {
  const want = computeDayFlags({
    timeIn: r.time_in,
    timeOut: r.time_out,
    shiftLabel: r.shift_label,
    standardHours: STANDARD_HOURS * (1 - Number(r.covered)),
    lateExempt: r.morning_covered === true,
  });
  // An open day (no clock-out) only has its lateness re-graded, exactly as
  // recomputeLeaveRangeFlags does — its hours land at clock-out.
  const lateChanged = (r.late_minutes ?? 0) !== want.lateMinutes;
  const undertimeChanged =
    !want.open &&
    ((r.is_undertime ?? false) !== want.isUndertime ||
      (r.undertime_minutes ?? 0) !== want.undertimeMins);
  if (!lateChanged && !undertimeChanged) continue;
  changes.push({
    email: r.email,
    date: r.work_date,
    punch: `${r.time_in}–${r.time_out ?? "open"}`,
    leave: `${Number(r.covered) === 1 ? "full" : `${Number(r.covered)}d`}${r.morning_covered ? " (AM)" : ""}`,
    late: `${r.late_minutes ?? 0} → ${want.lateMinutes}`,
    undertime: want.open
      ? "(open day)"
      : `${r.is_undertime ? `yes/${r.undertime_minutes ?? 0}m` : "no"} → ${
          want.isUndertime ? `yes/${want.undertimeMins}m` : "no"
        }`,
    _id: r.id,
    _want: want,
  });
}

console.log(
  `DB: ${dbName} | ${rows.length} leave-covered day(s) examined | ${changes.length} need correction`,
);
if (changes.length) {
  console.table(changes.map(({ _id, _want, ...show }) => show));
}

if (!apply) {
  console.log(
    changes.length
      ? "\nDRY RUN — nothing written. Re-run with --apply to commit."
      : "\nNothing to do.",
  );
  await pool.end();
  process.exit(0);
}

const client = await pool.connect();
let updated = 0;
try {
  await client.query("BEGIN");
  for (const c of changes) {
    const { rowCount } = c._want.open
      ? await client.query(
          `UPDATE daily_time_reports SET late_minutes = $1 WHERE id = $2 AND locked_at IS NULL`,
          [c._want.lateMinutes, c._id],
        )
      : await client.query(
          `UPDATE daily_time_reports
              SET late_minutes = $1, is_undertime = $2, undertime_minutes = $3
            WHERE id = $4 AND locked_at IS NULL`,
          [c._want.lateMinutes, c._want.isUndertime, c._want.undertimeMins, c._id],
        );
    updated += rowCount ?? 0;
  }
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  client.release();
}

console.log(`\nAPPLIED — ${updated} row(s) updated in ${dbName}.`);
await pool.end();
