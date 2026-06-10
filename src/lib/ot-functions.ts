import { createServerFn } from "@tanstack/react-start";

type OTRow = {
  id: string; dtr_id: string | null; employee_id: string;
  requested_hours: number; work_date: string | null;
  request_type: "pre_approved" | "actual"; pre_approved_id: string | null;
  target_month: string | null; step: "is" | "dh";
  status: "pending" | "approved" | "rejected";
  is_approver_id: string | null; dh_approver_id: string | null;
  is_decided_at: string | null; dh_decided_at: string | null;
  is_notes: string | null; dh_notes: string | null; created_at: string;
};

export const getMyOTBudgets = createServerFn({ method: "POST" })
  .inputValidator((data: { employeeId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM ot_approval_requests
       WHERE employee_id = $1 AND request_type = 'pre_approved'
       ORDER BY target_month DESC`,
      [data.employeeId],
    );
    return rows as OTRow[];
  });

export const getMyActualOTs = createServerFn({ method: "POST" })
  .inputValidator((data: { employeeId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM ot_approval_requests
       WHERE employee_id = $1 AND request_type = 'actual'
       ORDER BY work_date DESC`,
      [data.employeeId],
    );
    return rows as OTRow[];
  });

export const getApprovedOTBudgets = createServerFn({ method: "POST" })
  .inputValidator((data: { employeeId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT * FROM ot_approval_requests
       WHERE employee_id = $1 AND request_type = 'pre_approved' AND status = 'approved'
       ORDER BY target_month DESC`,
      [data.employeeId],
    );
    return rows as OTRow[];
  });

export const getOTBudgetsForDashboard = createServerFn({ method: "POST" })
  .inputValidator((data: { employeeId: string; targetMonth: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, requested_hours, target_month, status FROM ot_approval_requests
       WHERE employee_id = $1 AND request_type = 'pre_approved'
         AND status = 'approved' AND target_month = $2`,
      [data.employeeId, data.targetMonth],
    );
    return rows as { id: string; requested_hours: number; target_month: string; status: string }[];
  });

export const getFiledOTForDashboard = createServerFn({ method: "POST" })
  .inputValidator((data: { employeeId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, requested_hours, pre_approved_id FROM ot_approval_requests
       WHERE employee_id = $1 AND request_type = 'actual'`,
      [data.employeeId],
    );
    return rows as { id: string; requested_hours: number; pre_approved_id: string | null }[];
  });

export const getPendingISApprovals = createServerFn({ method: "POST" })
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT r.*, p.full_name AS profile_full_name
       FROM ot_approval_requests r
       LEFT JOIN profiles p ON p.id = r.employee_id
       WHERE r.is_approver_id = $1 AND r.step = 'is'
         AND r.status = 'pending' AND r.request_type = 'pre_approved'`,
      [data.userId],
    );
    return rows.map((r) => ({ ...r, profile: r.profile_full_name ? { full_name: r.profile_full_name } : null })) as (OTRow & { profile: { full_name: string } | null })[];
  });

export const getPendingDHApprovals = createServerFn({ method: "POST" })
  .inputValidator((data: { userId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT r.*, p.full_name AS profile_full_name
       FROM ot_approval_requests r
       LEFT JOIN profiles p ON p.id = r.employee_id
       WHERE r.dh_approver_id = $1 AND r.step = 'dh'
         AND r.status = 'pending' AND r.request_type = 'pre_approved'`,
      [data.userId],
    );
    return rows.map((r) => ({ ...r, profile: r.profile_full_name ? { full_name: r.profile_full_name } : null })) as (OTRow & { profile: { full_name: string } | null })[];
  });

export const resolveOTApprovers = createServerFn({ method: "POST" })
  .inputValidator((data: { employeeId: string }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");

    // Get my node + immediate parent (IS approver)
    const { rows: [myRow] } = await pool.query<{ parent_id: string | null }>(
      `SELECT parent_id FROM org_nodes WHERE employee_id = $1 LIMIT 1`,
      [data.employeeId],
    );
    if (!myRow) throw new Error("NO_ORG_NODE");
    if (!myRow.parent_id) throw new Error("NO_ORG_NODE");

    const { rows: [parentRow] } = await pool.query<{ employee_id: string }>(
      `SELECT employee_id FROM org_nodes WHERE id = $1 LIMIT 1`,
      [myRow.parent_id],
    );
    if (!parentRow) throw new Error("NO_ORG_NODE");

    const isApproverId = parentRow.employee_id;

    // Walk up the tree to find the dept head (DH approver) using a recursive CTE
    const { rows } = await pool.query<{ employee_id: string; is_dept_head: boolean }>(
      `WITH RECURSIVE chain AS (
         SELECT id, employee_id, parent_id, is_dept_head, 0 AS depth
         FROM org_nodes WHERE employee_id = $1
         UNION ALL
         SELECT n.id, n.employee_id, n.parent_id, n.is_dept_head, chain.depth + 1
         FROM org_nodes n
         JOIN chain ON n.id = chain.parent_id
         WHERE chain.depth < 15
       )
       SELECT employee_id, is_dept_head FROM chain WHERE is_dept_head = TRUE LIMIT 1`,
      [isApproverId],
    );

    const dhRow = rows[0];
    if (!dhRow) throw new Error("NO_DH");

    return { isApproverId, dhApproverId: dhRow.employee_id };
  });

export const insertOTRequest = createServerFn({ method: "POST" })
  .inputValidator((data: Record<string, unknown>) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const cols = Object.keys(data);
    const vals = Object.values(data);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    await pool.query(
      `INSERT INTO ot_approval_requests (${cols.join(", ")}) VALUES (${placeholders})`,
      vals,
    );
  });

export const updateOTRequest = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; fields: Record<string, unknown> }) => data)
  .handler(async ({ data }) => {
    const { pool } = await import("@/lib/db.server");
    const entries = Object.entries(data.fields);
    const sets = entries.map(([col], i) => `${col} = $${i + 1}`).join(", ");
    const vals = [...entries.map(([, v]) => v), data.id];
    await pool.query(
      `UPDATE ot_approval_requests SET ${sets} WHERE id = $${vals.length}`,
      vals,
    );
  });
