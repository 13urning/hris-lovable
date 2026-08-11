// READ-ONLY diagnostic: find active leave_requests that would violate the
// planned no-overlap EXCLUDE constraint (matching the app guard's half-day AM/PM
// exception). Makes NO changes. Usage:
//   node scripts/check-leave-overlaps.mjs <db-name>
// e.g. node scripts/check-leave-overlaps.mjs wave_hris_staging
import { readFileSync } from "node:fs";
import { Pool } from "pg";

function loadEnv() {
  const env = {};
  let raw = "";
  try {
    raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const [, , dbName] = process.argv;
if (!dbName) {
  console.error("Usage: node scripts/check-leave-overlaps.mjs <db-name>");
  process.exit(1);
}

const env = loadEnv();
const pool = new Pool({
  host: env.DB_HOST ?? "127.0.0.1",
  port: parseInt(env.DB_PORT ?? "5432", 10),
  database: dbName,
  user: env.DB_USER ?? "postgres",
  password: env.DB_PASSWORD,
  // Fail fast if the IP isn't authorized / proxy isn't up, rather than hang.
  connectionTimeoutMillis: 8000,
});

// Pairs of active leaves for the same employee whose date ranges overlap, EXCEPT
// the legitimate case of two same-day half-days with different AM/PM periods.
const OVERLAP_PAIRS = `
  SELECT a.employee_id,
         a.id AS a_id, a.status AS a_status, a.start_date AS a_start, a.end_date AS a_end,
         a.half_day AS a_half, a.half_day_period AS a_period, a.created_at AS a_created,
         b.id AS b_id, b.status AS b_status, b.start_date AS b_start, b.end_date AS b_end,
         b.half_day AS b_half, b.half_day_period AS b_period, b.created_at AS b_created
    FROM leave_requests a
    JOIN leave_requests b
      ON a.employee_id = b.employee_id
     AND a.id < b.id
   WHERE a.status IN ('pending','approved')
     AND b.status IN ('pending','approved')
     AND a.start_date <= b.end_date
     AND a.end_date   >= b.start_date
     AND NOT (
       a.half_day AND b.half_day
       AND a.start_date = a.end_date AND b.start_date = b.end_date
       AND a.start_date = b.start_date
       AND a.half_day_period IS NOT NULL AND b.half_day_period IS NOT NULL
       AND a.half_day_period <> b.half_day_period
     )
   ORDER BY a.employee_id, a_start`;

const client = await pool.connect();
try {
  const { rows: meta } = await client.query(
    `SELECT current_database() AS db,
            (SELECT count(*) FROM leave_requests) AS total,
            (SELECT count(*) FROM leave_requests WHERE status IN ('pending','approved')) AS active`,
  );
  console.log(
    `Connected to "${meta[0].db}"  |  leave_requests: ${meta[0].total} total, ${meta[0].active} active (pending/approved)`,
  );

  const { rows } = await client.query(OVERLAP_PAIRS);
  console.log(`\nOverlapping active pairs that would VIOLATE the constraint: ${rows.length}`);
  const badIds = new Set();
  for (const r of rows) {
    badIds.add(r.a_id);
    badIds.add(r.b_id);
  }
  console.log(`Distinct rows involved: ${badIds.size}`);
  for (const r of rows.slice(0, 25)) {
    console.log(
      `  emp ${r.employee_id}\n` +
        `    A ${r.a_id} [${r.a_status}] ${r.a_start}..${r.a_end}${r.a_half ? ` half:${r.a_period}` : ""} created ${r.a_created}\n` +
        `    B ${r.b_id} [${r.b_status}] ${r.b_start}..${r.b_end}${r.b_half ? ` half:${r.b_period}` : ""} created ${r.b_created}`,
    );
  }
  if (rows.length > 25) console.log(`  ... and ${rows.length - 25} more pairs`);
} catch (err) {
  console.error("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
