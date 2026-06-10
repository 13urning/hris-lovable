import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertUser, assertHR } from "@/lib/auth-middleware";

export const fetchMyProfile = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT vl_credits, sl_credits, vl_remaining, sl_remaining FROM profiles WHERE id = $1 LIMIT 1`,
      [context.user.dbUserId],
    );
    return (rows[0] ?? null) as {
      vl_credits: number | null; sl_credits: number | null;
      vl_remaining: number | null; sl_remaining: number | null;
    } | null;
  });

export const fetchMyLeaves = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, leave_type, start_date, end_date, status FROM leave_requests
       WHERE employee_id = $1 ORDER BY start_date DESC`,
      [context.user.dbUserId],
    );
    return rows as { id: string; leave_type: string; start_date: string; end_date: string; status: string }[];
  });

// HR/admin view of all leaves. Regular users see only their own via fetchMyLeaves.
export const fetchAllLeaves = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertHR(context.user);
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
  .middleware([authMiddleware])
  .inputValidator((data: { ids: string[] }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    if (data.ids.length === 0) return [];
    const { pool } = await import("@/lib/db.server");
    const placeholders = data.ids.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await pool.query(
      `SELECT id, full_name, department FROM profiles WHERE id IN (${placeholders})`,
      data.ids,
    );
    return rows as { id: string; full_name: string; department: string }[];
  });

// File a leave request — employeeId is derived from the verified token so a
// user cannot file on behalf of someone else.
export const fileLeaveRequest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: {
    leaveType: string;
    startDate: string; endDate: string; reason: string | null;
  }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { resolveChain } = await import("@/lib/chain.server");
    const chain = await resolveChain(pool, context.user.dbUserId);

    // Group Head filing — auto-approve since there's no one above.
    const isAutoApproved = chain.length === 0;
    const status = isAutoApproved ? "approved" : "pending";
    const reviewedAt = isAutoApproved ? new Date().toISOString() : null;
    const reviewedBy = isAutoApproved ? context.user.dbUserId : null;

    await pool.query(
      `INSERT INTO leave_requests
         (employee_id, leave_type, start_date, end_date, reason,
          status, approver_chain, current_approver_index, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)`,
      [context.user.dbUserId, data.leaveType, data.startDate, data.endDate, data.reason,
       status, chain, reviewedBy, reviewedAt],
    );
  });

// Approver at current step approves → advance the chain. If past the end, mark
// fully approved. approverId comes from the verified token, not the body.
export const approveLeaveStep = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string; notes?: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: [req] } = await client.query<{
        approver_chain: string[]; current_approver_index: number; status: string;
      }>(
        `SELECT approver_chain, current_approver_index, status
         FROM leave_requests WHERE id = $1 FOR UPDATE`,
        [data.id],
      );
      if (!req) throw new Error("NOT_FOUND");
      if (req.status !== "pending") throw new Error("NOT_PENDING");

      const expected = req.approver_chain[req.current_approver_index];
      if (expected !== context.user.dbUserId) throw new Error("NOT_CURRENT_APPROVER");

      const nextIndex = req.current_approver_index + 1;
      const isFinal = nextIndex >= req.approver_chain.length;

      if (isFinal) {
        await client.query(
          `UPDATE leave_requests
              SET status = 'approved',
                  current_approver_index = $1,
                  reviewed_by = $2,
                  reviewed_at = $3,
                  review_notes = COALESCE($4, review_notes)
            WHERE id = $5`,
          [nextIndex, context.user.dbUserId, new Date().toISOString(), data.notes ?? null, data.id],
        );
      } else {
        await client.query(
          `UPDATE leave_requests SET current_approver_index = $1 WHERE id = $2`,
          [nextIndex, data.id],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

// Approver rejects → request is final regardless of chain position.
export const rejectLeaveStep = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string; notes?: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows: [req] } = await pool.query<{
      approver_chain: string[]; current_approver_index: number; status: string;
    }>(
      `SELECT approver_chain, current_approver_index, status FROM leave_requests WHERE id = $1`,
      [data.id],
    );
    if (!req) throw new Error("NOT_FOUND");
    if (req.status !== "pending") throw new Error("NOT_PENDING");
    if (req.approver_chain[req.current_approver_index] !== context.user.dbUserId) {
      throw new Error("NOT_CURRENT_APPROVER");
    }

    await pool.query(
      `UPDATE leave_requests
          SET status = 'rejected',
              reviewed_by = $1,
              reviewed_at = $2,
              review_notes = COALESCE($3, review_notes)
        WHERE id = $4`,
      [context.user.dbUserId, new Date().toISOString(), data.notes ?? null, data.id],
    );
  });

// Queue for the current user: leaves where they are the next approver in line.
// PostgreSQL arrays are 1-indexed, so we add 1 to the 0-based JS index.
export const fetchMyPendingLeaveApprovals = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT lr.id, lr.employee_id, lr.leave_type, lr.start_date, lr.end_date,
              lr.reason, lr.current_approver_index, lr.approver_chain, lr.created_at,
              p.full_name AS employee_full_name, p.department AS employee_department
         FROM leave_requests lr
         LEFT JOIN profiles p ON p.id = lr.employee_id
        WHERE lr.status = 'pending'
          AND lr.approver_chain[lr.current_approver_index + 1] = $1
        ORDER BY lr.created_at DESC`,
      [context.user.dbUserId],
    );
    return rows as {
      id: string; employee_id: string; leave_type: string;
      start_date: string; end_date: string; reason: string | null;
      current_approver_index: number; approver_chain: string[]; created_at: string;
      employee_full_name: string | null; employee_department: string | null;
    }[];
  });

// Delete a leave request. Owner can delete their own pending requests; HR/admin
// can delete any. Other users get FORBIDDEN — no silent IDOR.
export const deleteLeaveRequest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows: [req] } = await pool.query<{ employee_id: string; status: string }>(
      `SELECT employee_id, status FROM leave_requests WHERE id = $1`,
      [data.id],
    );
    if (!req) throw new Error("NOT_FOUND");
    const isOwner = req.employee_id === context.user.dbUserId;
    if (!isOwner && !context.user.isHR) throw new Error("FORBIDDEN");
    await pool.query(`DELETE FROM leave_requests WHERE id = $1`, [data.id]);
  });
