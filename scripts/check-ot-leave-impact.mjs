// READ-ONLY: show the before/after impact of two dashboard fixes.
//  1) OT "Used"/"Remaining": count only APPROVED filed OT (not cancelled/rejected/pending).
//  2) Leaves "Total filed": exclude user-cancelled requests.
// Makes NO changes. Usage: node scripts/check-ot-leave-impact.mjs <db-name>
import { readFileSync } from "node:fs";
import { Pool } from "pg";

function loadEnv() {
  const env = {};
  let raw = "";
  try { raw = readFileSync(new URL("../.env", import.meta.url), "utf8"); } catch { return env; }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

const [, , dbName] = process.argv;
if (!dbName) { console.error("Usage: node scripts/check-ot-leave-impact.mjs <db-name>"); process.exit(1); }
const env = loadEnv();
const pool = new Pool({
  host: env.DB_HOST ?? "127.0.0.1", port: parseInt(env.DB_PORT ?? "5432", 10),
  database: dbName, user: env.DB_USER ?? "postgres", password: env.DB_PASSWORD,
  connectionTimeoutMillis: 8000,
});

// OT: aggregate filed (actual) hours per employee+budget-month against APPROVED budgets,
// mirroring the dashboard's grouping. Show rows where non-approved filings inflate "used".
const OT_SQL = `
WITH budget_month AS (
  SELECT employee_id, target_month, SUM(requested_hours) AS budget_hours
  FROM ot_approval_requests
  WHERE request_type='pre_approved' AND status='approved'
  GROUP BY employee_id, target_month
),
actual_month AS (
  SELECT b.employee_id, b.target_month,
         SUM(a.requested_hours)                                        AS all_filed,
         COALESCE(SUM(a.requested_hours) FILTER (WHERE a.status='approved'),0)  AS approved_filed,
         COALESCE(SUM(a.requested_hours) FILTER (WHERE a.status='cancelled'),0) AS cancelled_h,
         COALESCE(SUM(a.requested_hours) FILTER (WHERE a.status='rejected'),0)  AS rejected_h,
         COALESCE(SUM(a.requested_hours) FILTER (WHERE a.status='pending'),0)   AS pending_h
  FROM ot_approval_requests a
  JOIN ot_approval_requests b ON b.id = a.pre_approved_id
  WHERE a.request_type='actual' AND b.request_type='pre_approved' AND b.status='approved'
  GROUP BY b.employee_id, b.target_month
)
SELECT COALESCE(p.full_name,'(unknown)') AS employee, bm.target_month AS month,
       bm.budget_hours AS budget,
       am.all_filed      AS used_old,
       am.approved_filed AS used_new,
       am.cancelled_h, am.rejected_h, am.pending_h,
       GREATEST(0, bm.budget_hours - am.all_filed)      AS remaining_old,
       GREATEST(0, bm.budget_hours - am.approved_filed) AS remaining_new
FROM budget_month bm
JOIN actual_month am ON am.employee_id=bm.employee_id AND am.target_month=bm.target_month
LEFT JOIN profiles p ON p.id = bm.employee_id
WHERE am.all_filed <> am.approved_filed
ORDER BY (am.all_filed - am.approved_filed) DESC`;

// Leaves: per employee, total filed old (all) vs new (exclude cancelled).
const LEAVE_SQL = `
SELECT COALESCE(p.full_name,'(unknown)') AS employee,
       COUNT(*)                                          AS total_old,
       COUNT(*) FILTER (WHERE lr.status <> 'cancelled')  AS total_new,
       COUNT(*) FILTER (WHERE lr.status = 'cancelled')   AS cancelled,
       COUNT(*) FILTER (WHERE lr.status = 'rejected')    AS rejected
FROM leave_requests lr
LEFT JOIN profiles p ON p.id = lr.employee_id
GROUP BY p.full_name
HAVING COUNT(*) FILTER (WHERE lr.status = 'cancelled') > 0
ORDER BY cancelled DESC`;

const client = await pool.connect();
try {
  console.log(`### Database: ${dbName}\n`);
  console.log("== OT: 'Used'/'Remaining' before vs after (only rows the fix changes) ==");
  const ot = await client.query(OT_SQL);
  if (!ot.rows.length) console.log("  (no employee/month affected — no non-approved filed OT against an approved budget)");
  for (const r of ot.rows) {
    const excluded = Number(r.used_old) - Number(r.used_new);
    console.log(`  ${r.employee} · ${r.month} · budget ${Number(r.budget).toFixed(1)}h`);
    console.log(`     Used:      ${Number(r.used_old).toFixed(1)}h  ->  ${Number(r.used_new).toFixed(1)}h   (−${excluded.toFixed(1)}h: cancelled ${Number(r.cancelled_h).toFixed(1)}, rejected ${Number(r.rejected_h).toFixed(1)}, pending ${Number(r.pending_h).toFixed(1)})`);
    console.log(`     Remaining: ${Number(r.remaining_old).toFixed(1)}h  ->  ${Number(r.remaining_new).toFixed(1)}h`);
  }

  console.log("\n== Leaves: 'Total filed' before vs after (employees with cancelled leaves) ==");
  const lv = await client.query(LEAVE_SQL);
  if (!lv.rows.length) console.log("  (no employee has cancelled leaves — count unchanged for everyone)");
  for (const r of lv.rows) {
    console.log(`  ${r.employee}:  ${r.total_old}  ->  ${r.total_new}   (−${r.cancelled} cancelled; ${r.rejected} rejected still counted)`);
  }
} catch (err) {
  console.error("ERROR:", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
