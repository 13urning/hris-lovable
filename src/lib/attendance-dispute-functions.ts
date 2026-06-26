import { createServerFn } from "@tanstack/react-start";
import { authMiddleware, assertUser, assertAdmin } from "@/lib/auth-middleware";

// ── Shared time math (kept in sync with dtr-functions.ts) ──────────────────────
// Company-wide tardiness rule: any clock-in after 09:00 is late. Returns minutes
// past 09:00 (0 = on time). Official Business ("OB") days are never late-flagged.
const LATE_CUTOFF_MINUTES = 9 * 60;
const STANDARD_HOURS = 9;

function lateMinutesFor(timeIn: string): number {
  const [h, m] = timeIn.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return Math.max(0, h * 60 + m - LATE_CUTOFF_MINUTES);
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Hours worked / undertime from a time_in/time_out pair, matching clockOutDTR.
function computeWorked(timeIn: string, timeOut: string) {
  const totalMins = minutesOf(timeOut) - minutesOf(timeIn);
  const hoursWorked = Math.max(0, Math.round((totalMins / 60) * 100) / 100);
  const isUndertime = hoursWorked < STANDARD_HOURS;
  const undertimeMins = isUndertime ? Math.max(0, Math.round(STANDARD_HOURS * 60 - totalMins)) : 0;
  return { hoursWorked, isUndertime, undertimeMins };
}

// Normalize a "HH:MM" / "HH:MM:SS" string to "HH:MM" (or null).
function normTime(t: string | null | undefined): string | null {
  if (!t) return null;
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

export type DisputeRow = {
  id: string;
  employee_id: string;
  dtr_id: string | null;
  work_date: string;
  original_time_in: string | null;
  original_time_out: string | null;
  original_shift_label: string | null;
  requested_time_in: string | null;
  requested_time_out: string | null;
  requested_shift_label: string | null;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  approver_chain: string[];
  current_approver_index: number;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
};

// Load the signed-in employee's attendance for a date so the dispute modal can
// pre-fill the current clock-in / clock-out / shift. Returns null when there's
// no record (an absent day the employee may be adding attendance for).
export const fetchDtrForDispute = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { date: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, work_date, time_in, time_out, shift_label, hours_worked, late_minutes
         FROM daily_time_reports
        WHERE employee_id = $1 AND work_date = $2
        LIMIT 1`,
      [context.user.dbUserId, data.date],
    );
    return (rows[0] ?? null) as {
      id: string;
      work_date: string;
      time_in: string | null;
      time_out: string | null;
      shift_label: string | null;
      hours_worked: number | null;
      late_minutes: number | null;
    } | null;
  });

// File an attendance dispute. employee_id is derived from the verified token so
// a user can't dispute on someone else's behalf. The dispute is routed up the
// org chart; if the filer sits atop the tree it auto-applies immediately.
export const fileAttendanceDispute = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    (data: {
      workDate: string;
      timeIn: string | null;
      timeOut: string | null;
      shiftLabel: string | null;
      reason: string | null;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    assertUser(context.user);

    const reqTimeIn = normTime(data.timeIn);
    const reqTimeOut = normTime(data.timeOut);
    const reqShift = data.shiftLabel || null;
    if (!reqTimeIn) throw new Error("TIME_IN_REQUIRED");
    if (reqTimeOut && minutesOf(reqTimeOut) <= minutesOf(reqTimeIn)) {
      throw new Error("TIME_OUT_BEFORE_IN");
    }

    const { pool } = await import("@/lib/db.server");

    // Snapshot the existing record (if any) for audit + to know which DTR to
    // patch on approval.
    const {
      rows: [existing],
    } = await pool.query<{
      id: string;
      time_in: string | null;
      time_out: string | null;
      shift_label: string | null;
    }>(
      `SELECT id, time_in, time_out, shift_label FROM daily_time_reports
        WHERE employee_id = $1 AND work_date = $2 LIMIT 1`,
      [context.user.dbUserId, data.workDate],
    );

    const { resolveChain } = await import("@/lib/chain.server");
    const chain = await resolveChain(pool, context.user.dbUserId);

    // Top of the tree → no approver → apply immediately.
    const autoApprove = chain.length === 0;

    const {
      rows: [dispute],
    } = await pool.query<{ id: string }>(
      `INSERT INTO attendance_disputes
         (employee_id, dtr_id, work_date,
          original_time_in, original_time_out, original_shift_label,
          requested_time_in, requested_time_out, requested_shift_label,
          reason, status, approver_chain, current_approver_index, reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 0, $13, $14)
       RETURNING id`,
      [
        context.user.dbUserId,
        existing?.id ?? null,
        data.workDate,
        normTime(existing?.time_in),
        normTime(existing?.time_out),
        existing?.shift_label ?? null,
        reqTimeIn,
        reqTimeOut,
        reqShift,
        data.reason,
        autoApprove ? "approved" : "pending",
        chain,
        autoApprove ? context.user.dbUserId : null,
        autoApprove ? new Date().toISOString() : null,
      ],
    );

    if (autoApprove) {
      await applyDisputeToDTR(pool, dispute.id);
    }
  });

// Apply an approved dispute's requested values to daily_time_reports. Patches
// the existing row when one is linked, otherwise inserts a fresh record for the
// day. Late/hours/undertime are recomputed server-side from the new times.
// Defined as a plain async fn (not a server fn) so it can run inside the approve
// transaction's connection.
async function applyDisputeToDTR(
  pool: import("pg").Pool,
  disputeId: string,
  client?: import("pg").PoolClient,
) {
  const db = client ?? pool;
  const {
    rows: [d],
  } = await db.query<{
    employee_id: string;
    dtr_id: string | null;
    work_date: string;
    requested_time_in: string | null;
    requested_time_out: string | null;
    requested_shift_label: string | null;
  }>(
    `SELECT employee_id, dtr_id, work_date,
            requested_time_in, requested_time_out, requested_shift_label
       FROM attendance_disputes WHERE id = $1`,
    [disputeId],
  );
  if (!d) throw new Error("NOT_FOUND");

  const timeIn = d.requested_time_in;
  const timeOut = d.requested_time_out;
  const shift = d.requested_shift_label;
  const isOB = shift === "OB";

  // No clock-in means nothing meaningful to apply.
  if (!timeIn) return;

  const lateMinutes = isOB ? 0 : lateMinutesFor(timeIn);
  const worked = timeOut ? computeWorked(timeIn, timeOut) : null;
  const hoursWorked = worked?.hoursWorked ?? 0;
  const isUndertime = worked?.isUndertime ?? false;
  const undertimeMins = worked?.undertimeMins ?? 0;

  if (d.dtr_id) {
    await db.query(
      `UPDATE daily_time_reports
          SET time_in = $1, time_out = $2, shift_label = $3,
              late_minutes = $4, hours_worked = $5,
              is_undertime = $6, undertime_minutes = $7,
              is_absent = false
        WHERE id = $8`,
      [timeIn, timeOut, shift, lateMinutes, hoursWorked, isUndertime, undertimeMins, d.dtr_id],
    );
  } else {
    const {
      rows: [inserted],
    } = await db.query<{ id: string }>(
      `INSERT INTO daily_time_reports
         (employee_id, work_date, time_in, time_out, shift_label, cutoff_id,
          late_minutes, hours_worked, is_undertime, undertime_minutes)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, $9)
       RETURNING id`,
      [
        d.employee_id,
        d.work_date,
        timeIn,
        timeOut,
        shift,
        lateMinutes,
        hoursWorked,
        isUndertime,
        undertimeMins,
      ],
    );
    // Link the dispute to the row it just created, for traceability.
    await db.query(`UPDATE attendance_disputes SET dtr_id = $1 WHERE id = $2`, [
      inserted.id,
      disputeId,
    ]);
  }
}

// The signed-in employee's own disputes (history).
export const fetchMyDisputes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, employee_id, dtr_id, work_date,
              original_time_in, original_time_out, original_shift_label,
              requested_time_in, requested_time_out, requested_shift_label,
              reason, status, approver_chain, current_approver_index,
              reviewed_at, review_notes, created_at
         FROM attendance_disputes
        WHERE employee_id = $1
        ORDER BY work_date DESC, created_at DESC`,
      [context.user.dbUserId],
    );
    return rows as DisputeRow[];
  });

// Disputes where the signed-in user is the current approver in the chain.
// Postgres arrays are 1-indexed, so add 1 to the 0-based JS index.
export const fetchMyPendingDisputeApprovals = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT ad.id, ad.employee_id, ad.dtr_id, ad.work_date,
              ad.original_time_in, ad.original_time_out, ad.original_shift_label,
              ad.requested_time_in, ad.requested_time_out, ad.requested_shift_label,
              ad.reason, ad.status, ad.approver_chain, ad.current_approver_index,
              ad.created_at,
              p.full_name AS employee_full_name, p.department AS employee_department
         FROM attendance_disputes ad
         LEFT JOIN profiles p ON p.id = ad.employee_id
        WHERE ad.status = 'pending'
          AND ad.approver_chain[ad.current_approver_index + 1] = $1
        ORDER BY ad.created_at DESC`,
      [context.user.dbUserId],
    );
    return rows as (DisputeRow & {
      employee_full_name: string | null;
      employee_department: string | null;
    })[];
  });

// Admin-only: every pending dispute across the org, regardless of where it sits
// in its approver chain. Used to power the admin override panel so an admin can
// clear disputes that are stuck on (or simply waiting for) another approver.
export const fetchAllPendingDisputes = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertAdmin(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT ad.id, ad.employee_id, ad.dtr_id, ad.work_date,
              ad.original_time_in, ad.original_time_out, ad.original_shift_label,
              ad.requested_time_in, ad.requested_time_out, ad.requested_shift_label,
              ad.reason, ad.status, ad.approver_chain, ad.current_approver_index,
              ad.created_at,
              p.full_name AS employee_full_name, p.department AS employee_department,
              ap.full_name AS current_approver_name
         FROM attendance_disputes ad
         LEFT JOIN profiles p ON p.id = ad.employee_id
         LEFT JOIN profiles ap ON ap.id = ad.approver_chain[ad.current_approver_index + 1]
        WHERE ad.status = 'pending'
        ORDER BY ad.created_at DESC`,
    );
    return rows as (DisputeRow & {
      employee_full_name: string | null;
      employee_department: string | null;
      current_approver_name: string | null;
    })[];
  });

// Admin override: approve any pending dispute immediately, bypassing the whole
// approver chain. Gated to admins via assertAdmin. The chain index is advanced
// to the end so the dispute reads as fully approved, and the requested values
// are written back to the DTR in the same transaction.
export const adminApproveDispute = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string; notes?: string }) => data)
  .handler(async ({ data, context }) => {
    assertAdmin(context.user);
    const { pool } = await import("@/lib/db.server");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const {
        rows: [req],
      } = await client.query<{ approver_chain: string[]; status: string }>(
        `SELECT approver_chain, status
           FROM attendance_disputes WHERE id = $1 FOR UPDATE`,
        [data.id],
      );
      if (!req) throw new Error("NOT_FOUND");
      if (req.status !== "pending") throw new Error("NOT_PENDING");

      await client.query(
        `UPDATE attendance_disputes
            SET status = 'approved',
                current_approver_index = $1,
                reviewed_by = $2,
                reviewed_at = $3,
                review_notes = COALESCE($4, review_notes)
          WHERE id = $5`,
        [
          req.approver_chain.length,
          context.user.dbUserId,
          new Date().toISOString(),
          data.notes ?? "Approved by admin override",
          data.id,
        ],
      );
      await applyDisputeToDTR(pool, data.id, client);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

// Approve the current step. Advances the chain; on the final step the dispute is
// applied to the DTR. approverId comes from the verified token, not the body.
export const approveDisputeStep = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string; notes?: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const {
        rows: [req],
      } = await client.query<{
        approver_chain: string[];
        current_approver_index: number;
        status: string;
      }>(
        `SELECT approver_chain, current_approver_index, status
           FROM attendance_disputes WHERE id = $1 FOR UPDATE`,
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
          `UPDATE attendance_disputes
              SET status = 'approved',
                  current_approver_index = $1,
                  reviewed_by = $2,
                  reviewed_at = $3,
                  review_notes = COALESCE($4, review_notes)
            WHERE id = $5`,
          [nextIndex, context.user.dbUserId, new Date().toISOString(), data.notes ?? null, data.id],
        );
        await applyDisputeToDTR(pool, data.id, client);
      } else {
        await client.query(
          `UPDATE attendance_disputes SET current_approver_index = $1 WHERE id = $2`,
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

// Reject the dispute — final regardless of chain position.
export const rejectDisputeStep = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string; notes?: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const {
      rows: [req],
    } = await pool.query<{
      approver_chain: string[];
      current_approver_index: number;
      status: string;
    }>(
      `SELECT approver_chain, current_approver_index, status
         FROM attendance_disputes WHERE id = $1`,
      [data.id],
    );
    if (!req) throw new Error("NOT_FOUND");
    if (req.status !== "pending") throw new Error("NOT_PENDING");
    if (req.approver_chain[req.current_approver_index] !== context.user.dbUserId) {
      throw new Error("NOT_CURRENT_APPROVER");
    }

    await pool.query(
      `UPDATE attendance_disputes
          SET status = 'rejected',
              reviewed_by = $1,
              reviewed_at = $2,
              review_notes = COALESCE($3, review_notes)
        WHERE id = $4`,
      [context.user.dbUserId, new Date().toISOString(), data.notes ?? null, data.id],
    );
  });

// Owner cancels their own still-pending dispute.
export const cancelDispute = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const {
      rows: [req],
    } = await pool.query<{ employee_id: string; status: string }>(
      `SELECT employee_id, status FROM attendance_disputes WHERE id = $1`,
      [data.id],
    );
    if (!req) throw new Error("NOT_FOUND");
    const isOwner = req.employee_id === context.user.dbUserId;
    if (!isOwner && !context.user.isHR) throw new Error("FORBIDDEN");
    if (req.status !== "pending") throw new Error("NOT_PENDING");
    await pool.query(
      `UPDATE attendance_disputes
          SET status = 'cancelled',
              review_notes = COALESCE(review_notes, $2)
        WHERE id = $1`,
      [data.id, isOwner ? "Cancelled by employee" : "Cancelled by HR"],
    );
  });
