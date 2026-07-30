import { Pool, types } from "pg";

// Return DATE columns as "YYYY-MM-DD" strings (not Date objects) to match
// Supabase's behavior and avoid UTC-midnight timezone shift issues.
types.setTypeParser(1082, (val: string) => val); // DATE
types.setTypeParser(1114, (val: string) => new Date(val + "Z").toISOString()); // TIMESTAMP
types.setTypeParser(1184, (val: string) => new Date(val).toISOString()); // TIMESTAMPTZ

// Return NUMERIC as a JS number. Default pg behavior is to return strings to
// preserve arbitrary precision — every NUMERIC column in this app holds small
// values (weights, scores, hours, leave credits), so parseFloat is safe and
// avoids "0" + "20" string-concat bugs in client-side reduce/sum logic.
types.setTypeParser(1700, (val: string) => parseFloat(val)); // NUMERIC

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

// DEFECT FIX, not only an observability gap. `pg` emits 'error' on an idle
// client that dies out from under the pool — a Cloud SQL restart, a reaped
// connection, a network blip. An EventEmitter 'error' with NO listener does not
// warn: it throws, and an uncaught throw here terminates the Node process. With
// prod and staging sharing one db-f1-micro, that is a live way to lose a
// container silently. Attaching a listener both fixes the crash and gives us the
// first visibility we have ever had into pool faults.
pool.on("error", (err) => {
  void import("@/lib/log.server").then(({ logError }) => {
    logError("pg_pool_idle_client_error", err);
  });
});

export { pool };
