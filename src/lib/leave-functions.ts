import { createServerFn } from "@tanstack/react-start";

export const fetchMyProfile = createServerFn({ method: "POST" })
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT vl_credits, sl_credits, vl_remaining, sl_remaining FROM profiles WHERE id = $1 LIMIT 1`,
      [data.userId],
    );
    return (rows[0] ?? null) as {
      vl_credits: number | null; sl_credits: number | null;
      vl_remaining: number | null; sl_remaining: number | null;
    } | null;
  });

export const fetchMyLeaves = createServerFn({ method: "POST" })
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, leave_type, start_date, end_date, status FROM leave_requests
       WHERE employee_id = $1 ORDER BY start_date DESC`,
      [data.userId],
    );
    return rows as { id: string; leave_type: string; start_date: string; end_date: string; status: string }[];
  });

export const fetchAllLeaves = createServerFn({ method: "POST" })
  .handler(async () => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, employee_id, leave_type, start_date, end_date, reason,
              status, reviewed_at, review_notes, created_at
       FROM leave_requests
       ORDER BY start_date DESC`,
    );
    return rows as {
      id: string; employee_id: string; leave_type: string;
      start_date: string; end_date: string; reason: string | null;
      status: "pending" | "approved" | "rejected" | "cancelled";
      reviewed_at: string | null; review_notes: string | null; created_at: string;
    }[];
  });

export const fetchProfilesByIds = createServerFn({ method: "POST" })
  .inputValidator((data: { ids: string[] }) => data)
  .handler(async ({ data }) => {
    if (data.ids.length === 0) return [];
    const { pool } = await import("@/lib/db.server");
    const placeholders = data.ids.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await pool.query(
      `SELECT id, full_name, department FROM profiles WHERE id IN (${placeholders})`,
      data.ids,
    );
    return rows as { id: string; full_name: string; department: string }[];
  });

export const fileLeaveRequest = createServerFn({ method: "POST" })
  .inputValidator((data: {
    employeeId: string; leaveType: string;
    startDate: string; endDate: string; reason: string | null;
  }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `INSERT INTO leave_requests (employee_id, leave_type, start_date, end_date, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [data.employeeId, data.leaveType, data.startDate, data.endDate, data.reason],
    );
  });

export const updateLeaveRequestStatus = createServerFn({ method: "POST" })
  .inputValidator((data: {
    id: string; status: string;
    reviewedBy: string | null; reviewedAt: string; notes?: string;
  }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(
      `UPDATE leave_requests
       SET status = $1, reviewed_by = $2, reviewed_at = $3, review_notes = COALESCE($4, review_notes)
       WHERE id = $5`,
      [data.status, data.reviewedBy, data.reviewedAt, data.notes ?? null, data.id],
    );
  });

export const deleteLeaveRequest = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    await pool.query(`DELETE FROM leave_requests WHERE id = $1`, [data.id]);
  });
