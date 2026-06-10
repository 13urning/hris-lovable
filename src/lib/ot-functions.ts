import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertUser } from "@/lib/auth-middleware";

type OTRow = {
  id: string; dtr_id: string | null; employee_id: string;
  requested_hours: number; work_date: string | null;
  request_type: "pre_approved" | "actual"; pre_approved_id: string | null;
  target_month: string | null;
  status: "pending" | "approved" | "rejected";
  approver_chain: string[]; current_approver_index: number;
  reviewed_at: string | null; review_notes: string | null; created_at: string;
};

export const getMyOTBudgets = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM ot_approval_requests
       WHERE employee_id = $1 AND request_type = 'pre_approved'
       ORDER BY target_month DESC`,
      [context.user.dbUserId],
    );
    return rows as OTRow[];
  });

export const getMyActualOTs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM ot_approval_requests
       WHERE employee_id = $1 AND request_type = 'actual'
       ORDER BY work_date DESC`,
      [context.user.dbUserId],
    );
    return rows as OTRow[];
  });

export const getApprovedOTBudgets = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM ot_approval_requests
       WHERE employee_id = $1 AND request_type = 'pre_approved' AND status = 'approved'
       ORDER BY target_month DESC`,
      [context.user.dbUserId],
    );
    return rows as OTRow[];
  });

export const getOTBudgetsForDashboard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { targetMonth: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, requested_hours, target_month, status FROM ot_approval_requests
       WHERE employee_id = $1 AND request_type = 'pre_approved'
         AND status = 'approved' AND target_month = $2`,
      [context.user.dbUserId, data.targetMonth],
    );
    return rows as { id: string; requested_hours: number; target_month: string; status: string }[];
  });

export const getFiledOTForDashboard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, requested_hours, pre_approved_id FROM ot_approval_requests
       WHERE employee_id = $1 AND request_type = 'actual'`,
      [context.user.dbUserId],
    );
    return rows as { id: string; requested_hours: number; pre_approved_id: string | null }[];
  });

// File a monthly OT budget request — chain resolved at file time. Group Head
// filing → auto-approved (chain empty). employeeId comes from the verified token.
export const fileOTBudgetRequest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: {
    targetMonth: string;
    requestedHours: number; notes: string | null;
  }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { resolveChain } = await import("@/lib/chain.server");
    const chain = await resolveChain(pool, context.user.dbUserId);

    const isAutoApproved = chain.length === 0;
    const status = isAutoApproved ? "approved" : "pending";
    const reviewedAt = isAutoApproved ? new Date().toISOString() : null;

    await pool.query(
      `INSERT INTO ot_approval_requests
         (employee_id, request_type, target_month, requested_hours,
          work_date, status, approver_chain, current_approver_index,
          review_notes, reviewed_at)
       VALUES ($1, 'pre_approved', $2, $3, $2, $4, $5, 0, $6, $7)`,
      [context.user.dbUserId, data.targetMonth + "-01", data.requestedHours,
       status, chain, data.notes, reviewedAt],
    );
  });

// File actual OT hours against an approved budget — no approval needed.
export const fileActualOTHours = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: {
    preApprovedId: string;
    workDate: string; hours: number;
  }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");

    // Guard: the budget must belong to the caller. Prevents filing actuals
    // against someone else's pre-approved budget.
    const { rows: [budget] } = await pool.query<{ employee_id: string; status: string }>(
      `SELECT employee_id, status FROM ot_approval_requests WHERE id = $1`,
      [data.preApprovedId],
    );
    if (!budget) throw new Error("NOT_FOUND");
    if (budget.employee_id !== context.user.dbUserId) throw new Error("FORBIDDEN");
    if (budget.status !== "approved") throw new Error("BUDGET_NOT_APPROVED");

    await pool.query(
      `INSERT INTO ot_approval_requests
         (employee_id, request_type, pre_approved_id, work_date,
          requested_hours, status, approver_chain, current_approver_index)
       VALUES ($1, 'actual', $2, $3, $4, 'approved', '{}', 0)`,
      [context.user.dbUserId, data.preApprovedId, data.workDate, data.hours],
    );
  });

export const fetchMyPendingOTApprovals = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT r.id, r.employee_id, r.requested_hours, r.target_month,
              r.approver_chain, r.current_approver_index, r.review_notes, r.created_at,
              p.full_name AS employee_full_name
         FROM ot_approval_requests r
         LEFT JOIN profiles p ON p.id = r.employee_id
        WHERE r.status = 'pending' AND r.request_type = 'pre_approved'
          AND r.approver_chain[r.current_approver_index + 1] = $1
        ORDER BY r.created_at DESC`,
      [context.user.dbUserId],
    );
    return rows as {
      id: string; employee_id: string; requested_hours: number;
      target_month: string | null; approver_chain: string[];
      current_approver_index: number; review_notes: string | null;
      created_at: string; employee_full_name: string | null;
    }[];
  });

export const approveOTStep = createServerFn({ method: "POST" })
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
         FROM ot_approval_requests WHERE id = $1 FOR UPDATE`,
        [data.id],
      );
      if (!req) throw new Error("NOT_FOUND");
      if (req.status !== "pending") throw new Error("NOT_PENDING");
      if (req.approver_chain[req.current_approver_index] !== context.user.dbUserId) {
        throw new Error("NOT_CURRENT_APPROVER");
      }

      const nextIndex = req.current_approver_index + 1;
      const isFinal = nextIndex >= req.approver_chain.length;

      if (isFinal) {
        await client.query(
          `UPDATE ot_approval_requests
              SET status = 'approved',
                  current_approver_index = $1,
                  reviewed_at = $2,
                  review_notes = COALESCE($3, review_notes)
            WHERE id = $4`,
          [nextIndex, new Date().toISOString(), data.notes ?? null, data.id],
        );
      } else {
        await client.query(
          `UPDATE ot_approval_requests SET current_approver_index = $1 WHERE id = $2`,
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

export const rejectOTStep = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string; notes?: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows: [req] } = await pool.query<{
      approver_chain: string[]; current_approver_index: number; status: string;
    }>(
      `SELECT approver_chain, current_approver_index, status
       FROM ot_approval_requests WHERE id = $1`,
      [data.id],
    );
    if (!req) throw new Error("NOT_FOUND");
    if (req.status !== "pending") throw new Error("NOT_PENDING");
    if (req.approver_chain[req.current_approver_index] !== context.user.dbUserId) {
      throw new Error("NOT_CURRENT_APPROVER");
    }

    await pool.query(
      `UPDATE ot_approval_requests
          SET status = 'rejected',
              reviewed_at = $1,
              review_notes = COALESCE($2, review_notes)
        WHERE id = $3`,
      [new Date().toISOString(), data.notes ?? null, data.id],
    );
  });
