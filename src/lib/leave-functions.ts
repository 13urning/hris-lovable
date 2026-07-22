import { createServerFn } from "@tanstack/react-start";
import type { PoolClient } from "pg";
import { authMiddleware, assertUser, assertHR } from "@/lib/auth-middleware";
import {
  enforceRateLimit,
  LEAVE_WRITE_RATE_LIMIT,
  LEAVE_ONBEHALF_RATE_LIMIT,
} from "@/lib/rate-limit.server";

// Reject a new leave whose dates overlap an existing ACTIVE (pending or approved)
// leave for the same employee — the duplicate/overlapping filings this guards
// against. Cancelled and rejected leaves are ignored so a re-file after a rejection
// still works. Two HALF-days on the same day with different AM/PM periods do NOT
// conflict (together they make one full day), so that legitimate case is allowed.
//
// Runs inside the caller's transaction so the check and the insert commit
// atomically. NOTE: under READ COMMITTED this can't see a concurrent uncommitted
// insert, so two truly simultaneous identical filings could still both pass; the
// per-user write rate limit shrinks that window to near-zero. A DB EXCLUDE
// constraint (daterange GiST) would make it airtight — tracked as a follow-up.
async function assertNoOverlappingLeave(
  client: PoolClient,
  employeeId: string,
  startDate: string,
  endDate: string,
  halfDay: boolean,
  halfDayPeriod: "AM" | "PM" | null,
): Promise<void> {
  const { rowCount } = await client.query(
    `SELECT 1
       FROM leave_requests
      WHERE employee_id = $1
        AND status IN ('pending', 'approved')
        AND start_date <= $3::date
        AND end_date   >= $2::date
        AND NOT (
          -- both are half-days on the same single day but different AM/PM periods
          $4::boolean = true
          AND half_day = true
          AND start_date = end_date
          AND start_date = $2::date
          AND $2::date = $3::date
          AND half_day_period IS NOT NULL
          AND $5 IS NOT NULL
          AND half_day_period IS DISTINCT FROM $5::text
        )
      LIMIT 1`,
    [employeeId, startDate, endDate, halfDay, halfDayPeriod],
  );
  if (rowCount && rowCount > 0) throw new Error("OVERLAPPING_LEAVE");
}

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
      vl_credits: number | null;
      sl_credits: number | null;
      vl_remaining: number | null;
      sl_remaining: number | null;
    } | null;
  });

export const fetchMyLeaves = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, employee_id, leave_type, start_date, end_date, reason,
              status, reviewed_at, review_notes, created_at, half_day, half_day_period
       FROM leave_requests
       WHERE employee_id = $1 ORDER BY start_date DESC`,
      [context.user.dbUserId],
    );
    return rows as {
      id: string;
      employee_id: string;
      leave_type: string;
      start_date: string;
      end_date: string;
      reason: string | null;
      status: "pending" | "approved" | "rejected" | "cancelled";
      reviewed_at: string | null;
      review_notes: string | null;
      created_at: string;
      half_day: boolean;
      half_day_period: "AM" | "PM" | null;
    }[];
  });

// HR/admin view of all leaves. Regular users see only their own via fetchMyLeaves.
export const fetchAllLeaves = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, employee_id, leave_type, start_date, end_date, reason,
              status, reviewed_at, review_notes, created_at, half_day, half_day_period
       FROM leave_requests
       ORDER BY start_date DESC`,
    );
    return rows as {
      id: string;
      employee_id: string;
      leave_type: string;
      start_date: string;
      end_date: string;
      reason: string | null;
      status: "pending" | "approved" | "rejected" | "cancelled";
      reviewed_at: string | null;
      review_notes: string | null;
      created_at: string;
      half_day: boolean;
      half_day_period: "AM" | "PM" | null;
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
  .inputValidator(
    (data: {
      leaveType: string;
      startDate: string;
      endDate: string;
      reason: string | null;
      halfDay?: boolean;
      halfDayPeriod?: "AM" | "PM" | null;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    // Tight write throttle on top of the global baseline: a user filing their own
    // leave does so a handful of times at most; rapid repeats are the scripted
    // spam this guards against. Keyed per user so it can't affect anyone else.
    enforceRateLimit(`leave:file:u:${context.user.dbUserId}`, LEAVE_WRITE_RATE_LIMIT);
    const { pool } = await import("@/lib/db.server");

    // A half-day leave always covers exactly one day, so collapse the range and
    // require a valid AM/PM period. It counts as 0.5 days against the balance.
    const halfDay = data.halfDay === true;
    const halfDayPeriod = halfDay ? (data.halfDayPeriod ?? null) : null;
    if (halfDay && halfDayPeriod !== "AM" && halfDayPeriod !== "PM") {
      throw new Error("HALF_DAY_PERIOD_REQUIRED");
    }
    const startDate = data.startDate;
    const endDate = halfDay ? data.startDate : data.endDate;

    // Balance gate (employees only): every leave type except Leave without Pay
    // (WP) requires enough remaining balance to cover the requested business
    // days. VL draws from vl_remaining, SL from sl_remaining, and all other paid
    // types from the combined pool. When nothing remains, WP is the only filable
    // type. HR/admins filing their own leave are not balance-limited.
    if (!context.user.isHR && data.leaveType !== "WP") {
      const { businessDaysBetween } = await import("@/lib/utils");
      const days = halfDay ? 0.5 : businessDaysBetween(startDate, endDate);
      const {
        rows: [prof],
      } = await pool.query<{ vl_remaining: number | null; sl_remaining: number | null }>(
        `SELECT vl_remaining, sl_remaining FROM profiles WHERE id = $1`,
        [context.user.dbUserId],
      );
      const vl = Number(prof?.vl_remaining ?? 0);
      const sl = Number(prof?.sl_remaining ?? 0);
      const available = data.leaveType === "VL" ? vl : data.leaveType === "SL" ? sl : vl + sl;
      if (available < days) throw new Error("INSUFFICIENT_BALANCE");
    }

    const { resolveChain } = await import("@/lib/chain.server");
    const chain = await resolveChain(pool, context.user.dbUserId);

    // Group Head filing — auto-approve since there's no one above.
    const isAutoApproved = chain.length === 0;
    const status = isAutoApproved ? "approved" : "pending";
    const reviewedAt = isAutoApproved ? new Date().toISOString() : null;
    const reviewedBy = isAutoApproved ? context.user.dbUserId : null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assertNoOverlappingLeave(
        client,
        context.user.dbUserId,
        startDate,
        endDate,
        halfDay,
        halfDayPeriod,
      );
      const {
        rows: [inserted],
      } = await client.query<{ id: string }>(
        `INSERT INTO leave_requests
           (employee_id, leave_type, start_date, end_date, reason,
            status, approver_chain, current_approver_index, reviewed_by, reviewed_at,
            half_day, half_day_period)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11)
         RETURNING id`,
        [
          context.user.dbUserId,
          data.leaveType,
          startDate,
          endDate,
          data.reason,
          status,
          chain,
          reviewedBy,
          reviewedAt,
          halfDay,
          halfDayPeriod,
        ],
      );
      // Nudge the first approver's inbox. Auto-approved filings skip it — the
      // filer is the actor and sees the approved state immediately.
      if (!isAutoApproved) {
        const { notifyUser, phDate, phDateRange } = await import("@/lib/notify.server");
        const {
          rows: [me],
        } = await client.query<{ full_name: string | null }>(
          `SELECT full_name FROM profiles WHERE id = $1`,
          [context.user.dbUserId],
        );
        await notifyUser(client, {
          userId: chain[0],
          type: "leave_request",
          refId: inserted.id,
          title: `Leave request from ${me?.full_name ?? "an employee"}`,
          body: halfDay
            ? `${data.leaveType} · ${phDate(startDate)} (${halfDayPeriod})`
            : `${data.leaveType} · ${phDateRange(startDate, endDate)}`,
        });
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

// Lightweight employee list for the admin "file on behalf" picker. HR/admin only.
export const fetchProfilesForLeaveFiling = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    assertHR(context.user);
    const { pool } = await import("@/lib/db.server");
    const { rows } = await pool.query(
      `SELECT id, full_name, department FROM profiles ORDER BY full_name`,
    );
    return rows as { id: string; full_name: string; department: string | null }[];
  });

// HR/admin files a leave on an employee's behalf (e.g. the employee was absent
// and never filed). The employee_id is the TARGET, not the caller. The caller
// chooses whether to approve immediately or route through the employee's normal
// supervisor chain via `autoApprove`.
export const fileLeaveOnBehalf = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    (data: {
      employeeId: string;
      leaveType: string;
      startDate: string;
      endDate: string;
      reason: string | null;
      autoApprove: boolean;
      halfDay?: boolean;
      halfDayPeriod?: "AM" | "PM" | null;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    assertHR(context.user);
    // Looser than self-service filing (HR may process a small batch) but still
    // caps runaway automation. Keyed per HR/admin filer, not the target employee.
    enforceRateLimit(`leave:onbehalf:u:${context.user.dbUserId}`, LEAVE_ONBEHALF_RATE_LIMIT);
    if (!data.employeeId) throw new Error("EMPLOYEE_REQUIRED");
    const { pool } = await import("@/lib/db.server");
    const { resolveChain } = await import("@/lib/chain.server");

    // Half-day leave collapses to a single day and needs a valid AM/PM period.
    const halfDay = data.halfDay === true;
    const halfDayPeriod = halfDay ? (data.halfDayPeriod ?? null) : null;
    if (halfDay && halfDayPeriod !== "AM" && halfDayPeriod !== "PM") {
      throw new Error("HALF_DAY_PERIOD_REQUIRED");
    }
    const startDate = data.startDate;
    const endDate = halfDay ? data.startDate : data.endDate;

    // Resolve the TARGET employee's chain. If they aren't in the org tree we
    // can't route for approval — only an immediate approval can proceed.
    let chain: string[] = [];
    try {
      chain = await resolveChain(pool, data.employeeId);
    } catch {
      if (!data.autoApprove) throw new Error("NO_ORG_NODE");
    }

    // Auto-approve when asked, or when the employee sits atop the tree (no chain).
    const autoApprove = data.autoApprove || chain.length === 0;
    const status = autoApprove ? "approved" : "pending";
    const reviewedAt = autoApprove ? new Date().toISOString() : null;
    const reviewedBy = autoApprove ? context.user.dbUserId : null;
    const note = `Filed on behalf by ${context.user.email ?? "an administrator"}`;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await assertNoOverlappingLeave(
        client,
        data.employeeId,
        startDate,
        endDate,
        halfDay,
        halfDayPeriod,
      );
      const {
        rows: [inserted],
      } = await client.query<{ id: string }>(
        `INSERT INTO leave_requests
           (employee_id, leave_type, start_date, end_date, reason,
            status, approver_chain, current_approver_index, reviewed_by, reviewed_at, review_notes,
            half_day, half_day_period)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          data.employeeId,
          data.leaveType,
          startDate,
          endDate,
          data.reason,
          status,
          chain,
          reviewedBy,
          reviewedAt,
          autoApprove ? note : null,
          halfDay,
          halfDayPeriod,
        ],
      );
      // Routed on-behalf filing: the TARGET employee is the requester, so their
      // first approver gets the nudge, named after the employee (not the HR filer).
      if (!autoApprove) {
        const { notifyUser, phDate, phDateRange } = await import("@/lib/notify.server");
        const {
          rows: [emp],
        } = await client.query<{ full_name: string | null }>(
          `SELECT full_name FROM profiles WHERE id = $1`,
          [data.employeeId],
        );
        await notifyUser(client, {
          userId: chain[0],
          type: "leave_request",
          refId: inserted.id,
          title: `Leave request from ${emp?.full_name ?? "an employee"}`,
          body: halfDay
            ? `${data.leaveType} · ${phDate(startDate)} (${halfDayPeriod})`
            : `${data.leaveType} · ${phDateRange(startDate, endDate)}`,
        });
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
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

      const {
        rows: [req],
      } = await client.query<{
        approver_chain: string[];
        current_approver_index: number;
        status: string;
        employee_id: string;
        leave_type: string;
        start_date: string;
        end_date: string;
        half_day: boolean;
        half_day_period: string | null;
      }>(
        `SELECT approver_chain, current_approver_index, status,
                employee_id, leave_type, start_date, end_date, half_day, half_day_period
         FROM leave_requests WHERE id = $1 FOR UPDATE`,
        [data.id],
      );
      if (!req) throw new Error("NOT_FOUND");
      if (req.status !== "pending") throw new Error("NOT_PENDING");

      const expected = req.approver_chain[req.current_approver_index];
      if (expected !== context.user.dbUserId) throw new Error("NOT_CURRENT_APPROVER");

      const nextIndex = req.current_approver_index + 1;
      const isFinal = nextIndex >= req.approver_chain.length;

      const { notifyUser, phDate, phDateRange } = await import("@/lib/notify.server");
      const body = req.half_day
        ? `${req.leave_type} · ${phDate(req.start_date)} (${req.half_day_period})`
        : `${req.leave_type} · ${phDateRange(req.start_date, req.end_date)}`;

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
        await notifyUser(client, {
          userId: req.employee_id,
          type: "leave_decision",
          refId: data.id,
          title: "Your leave request was approved",
          body,
        });
      } else {
        await client.query(`UPDATE leave_requests SET current_approver_index = $1 WHERE id = $2`, [
          nextIndex,
          data.id,
        ]);
        // Plain SELECT (no FOR UPDATE) — don't widen the lock onto profiles.
        const {
          rows: [emp],
        } = await client.query<{ full_name: string | null }>(
          `SELECT full_name FROM profiles WHERE id = $1`,
          [req.employee_id],
        );
        await notifyUser(client, {
          userId: req.approver_chain[nextIndex],
          type: "leave_request",
          refId: data.id,
          title: `Leave request from ${emp?.full_name ?? "an employee"}`,
          body,
        });
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
    const {
      rows: [req],
    } = await pool.query<{
      approver_chain: string[];
      current_approver_index: number;
      status: string;
      employee_id: string;
      leave_type: string;
      start_date: string;
      end_date: string;
      half_day: boolean;
      half_day_period: string | null;
    }>(
      `SELECT approver_chain, current_approver_index, status,
              employee_id, leave_type, start_date, end_date, half_day, half_day_period
         FROM leave_requests WHERE id = $1`,
      [data.id],
    );
    if (!req) throw new Error("NOT_FOUND");
    if (req.status !== "pending") throw new Error("NOT_PENDING");
    if (req.approver_chain[req.current_approver_index] !== context.user.dbUserId) {
      throw new Error("NOT_CURRENT_APPROVER");
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE leave_requests
            SET status = 'rejected',
                reviewed_by = $1,
                reviewed_at = $2,
                review_notes = COALESCE($3, review_notes)
          WHERE id = $4`,
        [context.user.dbUserId, new Date().toISOString(), data.notes ?? null, data.id],
      );
      const { notifyUser, phDate, phDateRange } = await import("@/lib/notify.server");
      await notifyUser(client, {
        userId: req.employee_id,
        type: "leave_decision",
        refId: data.id,
        title: "Your leave request was rejected",
        // Review notes stay off the body — they can carry sensitive manager
        // comments; the recipient reads them on the leaves page.
        body: req.half_day
          ? `${req.leave_type} · ${phDate(req.start_date)} (${req.half_day_period})`
          : `${req.leave_type} · ${phDateRange(req.start_date, req.end_date)}`,
      });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
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
              lr.half_day, lr.half_day_period,
              p.full_name AS employee_full_name, p.department AS employee_department
         FROM leave_requests lr
         LEFT JOIN profiles p ON p.id = lr.employee_id
        WHERE lr.status = 'pending'
          AND lr.approver_chain[lr.current_approver_index + 1] = $1
        ORDER BY lr.created_at DESC`,
      [context.user.dbUserId],
    );
    return rows as {
      id: string;
      employee_id: string;
      leave_type: string;
      start_date: string;
      end_date: string;
      reason: string | null;
      current_approver_index: number;
      approver_chain: string[];
      created_at: string;
      half_day: boolean;
      half_day_period: "AM" | "PM" | null;
      employee_full_name: string | null;
      employee_department: string | null;
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
    const {
      rows: [req],
    } = await pool.query<{ employee_id: string; status: string }>(
      `SELECT employee_id, status FROM leave_requests WHERE id = $1`,
      [data.id],
    );
    if (!req) throw new Error("NOT_FOUND");
    const isOwner = req.employee_id === context.user.dbUserId;
    if (!isOwner && !context.user.isHR) throw new Error("FORBIDDEN");
    await pool.query(`DELETE FROM leave_requests WHERE id = $1`, [data.id]);
  });

// Soft-cancel a leave request: owner can cancel their own pending request,
// HR/admin can cancel any pending one. Sets status to 'cancelled' (kept for
// history) rather than deleting. Already-decided requests can't be cancelled.
export const cancelLeaveRequest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    assertUser(context.user);
    const { pool } = await import("@/lib/db.server");
    const {
      rows: [req],
    } = await pool.query<{ employee_id: string; status: string }>(
      `SELECT employee_id, status FROM leave_requests WHERE id = $1`,
      [data.id],
    );
    if (!req) throw new Error("NOT_FOUND");
    const isOwner = req.employee_id === context.user.dbUserId;
    if (!isOwner && !context.user.isHR) throw new Error("FORBIDDEN");
    if (req.status !== "pending") throw new Error("NOT_PENDING");
    await pool.query(
      `UPDATE leave_requests
          SET status = 'cancelled',
              review_notes = COALESCE(review_notes, $2)
        WHERE id = $1`,
      [data.id, isOwner ? "Cancelled by employee" : "Cancelled by HR"],
    );
  });
