import { Pool } from "pg";

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
