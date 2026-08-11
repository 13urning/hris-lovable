// Functional smoke test for the leave_requests_no_overlap constraint. Runs a
// series of inserts inside ONE transaction that is ALWAYS rolled back, so it
// leaves no data behind. Uses far-future dates to avoid touching real rows.
// Usage: node scripts/smoke-test-leave-overlap.mjs <db-name>
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

const [, , dbName] = process.argv;
if (!dbName) {
  console.error("Usage: node scripts/smoke-test-leave-overlap.mjs <db-name>");
  process.exit(1);
}
const env = loadEnv();
const pool = new Pool({
  host: env.DB_HOST ?? "127.0.0.1",
  port: parseInt(env.DB_PORT ?? "5432", 10),
  database: dbName,
  user: env.DB_USER ?? "postgres",
  password: env.DB_PASSWORD,
  connectionTimeoutMillis: 8000,
});

let passed = 0;
let failed = 0;
const client = await pool.connect();

// Insert a leave row for `emp` inside a savepoint; return true on success, or the
// SQLSTATE on failure (so the outer transaction survives an expected rejection).
async function tryInsert(emp, { start, end, half = false, period = null, status = "pending" }) {
  await client.query("SAVEPOINT s");
  try {
    await client.query(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, status, half_day, half_day_period)
       VALUES ($1, 'VL', $2, $3, $4, $5, $6)`,
      [emp, start, end, status, half, period],
    );
    await client.query("RELEASE SAVEPOINT s");
    return "OK";
  } catch (e) {
    await client.query("ROLLBACK TO SAVEPOINT s");
    return e.code; // '23P01' = exclusion_violation
  }
}

function check(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}  (got ${actual}, expected ${expected})`);
  ok ? passed++ : failed++;
}

try {
  // 1) constraint present?
  const { rows: con } = await client.query(
    `SELECT conname FROM pg_constraint WHERE conname = 'leave_requests_no_overlap'`,
  );
  console.log(`Constraint present on "${dbName}": ${con.length === 1 ? "YES" : "NO"}`);
  if (con.length !== 1) throw new Error("Constraint missing — aborting smoke test.");

  const { rows: users } = await client.query(`SELECT id FROM users LIMIT 1`);
  if (!users.length)
    throw new Error("No users row available to satisfy the FK — cannot smoke test inserts.");
  const emp = users[0].id;
  console.log(
    `Using employee_id ${emp}\nAll inserts run inside a transaction that is rolled back.\n`,
  );

  await client.query("BEGIN");

  // Baseline full-day multi-day leave 2099-01-10..2099-01-12
  check(
    "seed full-day 01-10..01-12",
    await tryInsert(emp, { start: "2099-01-10", end: "2099-01-12" }),
    "OK",
  );
  // Overlapping full-day 01-11..01-13 -> blocked
  check(
    "overlap full-day 01-11..01-13 rejected",
    await tryInsert(emp, { start: "2099-01-11", end: "2099-01-13" }),
    "23P01",
  );
  // Consecutive full-day 01-13..01-13 (day after the 01-12 end) -> allowed (half-open)
  check(
    "consecutive full-day 01-13 allowed",
    await tryInsert(emp, { start: "2099-01-13", end: "2099-01-13" }),
    "OK",
  );

  // Half-day AM on a fresh day
  check(
    "half-day AM 01-20 allowed",
    await tryInsert(emp, { start: "2099-01-20", end: "2099-01-20", half: true, period: "AM" }),
    "OK",
  );
  // Half-day PM same day, different period -> allowed
  check(
    "half-day PM 01-20 allowed (diff period)",
    await tryInsert(emp, { start: "2099-01-20", end: "2099-01-20", half: true, period: "PM" }),
    "OK",
  );
  // Half-day AM same day again -> blocked (same period)
  check(
    "half-day AM 01-20 again rejected",
    await tryInsert(emp, { start: "2099-01-20", end: "2099-01-20", half: true, period: "AM" }),
    "23P01",
  );
  // Full-day on 01-20 -> blocked (overlaps both halves)
  check(
    "full-day 01-20 rejected (overlaps halves)",
    await tryInsert(emp, { start: "2099-01-20", end: "2099-01-20" }),
    "23P01",
  );

  // Cancelled overlapping leave -> allowed (partial index ignores inactive)
  check(
    "cancelled overlap 01-10..01-12 allowed",
    await tryInsert(emp, { start: "2099-01-10", end: "2099-01-12", status: "cancelled" }),
    "OK",
  );

  await client.query("ROLLBACK");
  console.log(`\nRolled back. Result: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
