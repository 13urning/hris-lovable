import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertUser, assertHR } from "@/lib/auth-middleware";
import type { Pool } from "pg";

export type Holiday = {
  id: string;
  holiday_date: string;
  name: string;
  local_name: string | null;
  is_active: boolean;
  source: string;
};

// PH calendar date (UTC+8, no DST) as YYYY-MM-DD. Cloud Run runs in UTC.
function phTodayIso(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Active holiday dates within [startDate, endDate] as a Set of YYYY-MM-DD. Shared
// by the absence logic (a holiday with no clock-in is not an absence). Takes the
// pool so callers that already hold one don't reconnect.
export async function fetchActiveHolidayDates(
  pool: Pool,
  startDate: string,
  endDate: string,
): Promise<Set<string>> {
  const { rows } = await pool.query<{ holiday_date: string }>(
    `SELECT holiday_date FROM holidays
      WHERE is_active = true AND holiday_date >= $1 AND holiday_date <= $2`,
    [startDate, endDate],
  );
  return new Set(rows.map((r) => r.holiday_date));
}

export const listHolidays = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, holiday_date, name, local_name, is_active, source
         FROM holidays ORDER BY holiday_date`,
    );
    return rows as Holiday[];
  });

// Active holidays from PH-today through the end of the current month — shown on
// the dashboard. Visible to any signed-in user.
export const getUpcomingHolidaysThisMonth = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const today = phTodayIso();
    const [y, m] = today.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const monthEnd = `${today.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;
    const { rows } = await pool.query(
      `SELECT id, holiday_date, name, local_name, is_active, source
         FROM holidays
        WHERE is_active = true AND holiday_date >= $1 AND holiday_date <= $2
        ORDER BY holiday_date`,
      [today, monthEnd],
    );
    return rows as Holiday[];
  });

// Pull PH public holidays for a year from the free Nager.Date API and insert any
// that are missing. Existing rows (including manual ones) are left untouched so
// admin edits are never clobbered. Returns how many new dates were added.
export const syncPhilippineHolidays = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { year: number }) => data)
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    const year = Math.trunc(data.year);
    if (year < 2000 || year > 2100) throw new Error("INVALID_YEAR");

    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/PH`);
    if (!res.ok) throw new Error("HOLIDAY_API_FAILED");
    const holidays = (await res.json()) as { date: string; name: string; localName: string }[];
    if (!Array.isArray(holidays)) throw new Error("HOLIDAY_API_FAILED");

    const { pool } = await import("@/lib/db.server");
    let added = 0;
    for (const h of holidays) {
      const { rowCount } = await pool.query(
        `INSERT INTO holidays (holiday_date, name, local_name, source)
         VALUES ($1, $2, $3, 'nager')
         ON CONFLICT (holiday_date) DO NOTHING`,
        [h.date, h.name, h.localName ?? null],
      );
      added += rowCount ?? 0;
    }
    return { added, fetched: holidays.length, year };
  });

export const addHoliday = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { date: string; name: string }) => data)
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    const name = data.name.trim();
    const date = data.date.trim();
    if (!name) throw new Error("NAME_REQUIRED");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("INVALID_DATE");
    const { pool } = await import("@/lib/db.server");
    try {
      await pool.query(
        `INSERT INTO holidays (holiday_date, name, source) VALUES ($1, $2, 'manual')
         ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name, is_active = true`,
        [date, name],
      );
    } catch {
      throw new Error("INVALID_DATE");
    }
  });

export const setHolidayActive = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string; isActive: boolean }) => data)
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rowCount } = await pool.query(`UPDATE holidays SET is_active = $1 WHERE id = $2`, [
      data.isActive,
      data.id,
    ]);
    if (!rowCount) throw new Error("NOT_FOUND");
  });

export const deleteHoliday = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rowCount } = await pool.query(`DELETE FROM holidays WHERE id = $1`, [data.id]);
    if (!rowCount) throw new Error("NOT_FOUND");
  });
