// Apply a single SQL migration file to a Cloud SQL database.
//
// Usage:
//   node scripts/apply-migration.mjs <path-to-sql> <db-name>
//
// Examples:
//   node scripts/apply-migration.mjs supabase/migrations/20260615000000_office_networks.sql wave_hris_staging
//   node scripts/apply-migration.mjs supabase/migrations/20260615000000_office_networks.sql wave_hris
//
// Connection (host/port/user/password) is read from .env. The database name is
// taken from the 2nd argument so you can point the SAME migration at staging
// first and production later without editing .env. Your machine's IP must be in
// the Cloud SQL instance's Authorized Networks for the direct connection to work.

import { readFileSync } from "node:fs";
import { Pool } from "pg";

// --- tiny .env loader (no extra dependency) ---------------------------------
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

const [, , sqlPath, dbName] = process.argv;
if (!sqlPath || !dbName) {
  console.error("Usage: node scripts/apply-migration.mjs <path-to-sql> <db-name>");
  process.exit(1);
}

const env = loadEnv();
const sql = readFileSync(sqlPath, "utf8");

const pool = new Pool({
  host: env.DB_HOST ?? "127.0.0.1",
  port: parseInt(env.DB_PORT ?? "5432", 10),
  database: dbName,
  user: env.DB_USER ?? "postgres",
  password: env.DB_PASSWORD,
});

const client = await pool.connect();
try {
  console.log(`Applying ${sqlPath} -> database "${dbName}" on ${env.DB_HOST} ...`);
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log("✓ Migration applied successfully.");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("✗ Migration failed, rolled back:\n", err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
