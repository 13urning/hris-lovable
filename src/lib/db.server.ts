import { Pool, types } from "pg";

// Return DATE columns as "YYYY-MM-DD" strings (not Date objects) to match
// Supabase's behavior and avoid UTC-midnight timezone shift issues.
types.setTypeParser(1082, (val: string) => val); // DATE
types.setTypeParser(1114, (val: string) => new Date(val + "Z").toISOString()); // TIMESTAMP
types.setTypeParser(1184, (val: string) => new Date(val).toISOString()); // TIMESTAMPTZ

// Cloud Run: connect via Unix socket injected by Cloud SQL sidecar.
// Local dev: connect via Cloud SQL Auth Proxy on 127.0.0.1:5432.
const pool = new Pool(
  process.env.CLOUD_SQL_UNIX_SOCKET
    ? {
        host: process.env.CLOUD_SQL_UNIX_SOCKET,
        database: process.env.DB_NAME ?? "wave_hris",
        user: process.env.DB_USER ?? "postgres",
        password: process.env.DB_PASSWORD,
      }
    : {
        host: process.env.DB_HOST ?? "127.0.0.1",
        port: parseInt(process.env.DB_PORT ?? "5432"),
        database: process.env.DB_NAME ?? "wave_hris",
        user: process.env.DB_USER ?? "postgres",
        password: process.env.DB_PASSWORD,
      },
);

export { pool };
