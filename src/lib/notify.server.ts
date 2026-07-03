import type { Pool, PoolClient } from "pg";

export type NotifyType =
  | "leave_request"
  | "leave_decision"
  | "ot_request"
  | "ot_decision"
  | "dispute_request"
  | "dispute_decision";

// Insert one in-app notification. Idempotent on (user_id, type, ref_id) via
// notifications_ref_uniq — a retried mutation or double-fire is a silent no-op.
// Pass the PoolClient of the surrounding transaction so the notification
// commits/rolls back atomically with the business mutation. title/body are
// pre-formatted snapshots (they survive source-row deletion); keep them
// PII-minimal — in particular, never put manager review notes in the body.
export async function notifyUser(
  q: Pool | PoolClient,
  n: {
    userId: string;
    type: NotifyType;
    refId: string; // source row id (leave / OT / dispute)
    title: string;
    body?: string | null;
  },
): Promise<void> {
  await q.query(
    `INSERT INTO notifications (user_id, type, ref_id, title, body)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, type, ref_id) WHERE ref_id IS NOT NULL DO NOTHING`,
    [n.userId, n.type, n.refId, n.title, n.body ?? null],
  );
}

// ── Snapshot-body date formatting ────────────────────────────────────────────
// Business dates arrive as "YYYY-MM-DD" strings (see db.server.ts DATE parser)
// and are already PH-calendar dates, so plain string math is safe — no timezone
// conversion wanted here.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "2026-07-10" → "Jul 10"
export function phDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

// "2026-07-01" → "Jul 2026"
export function phMonth(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

// Same day → "Jul 10"; same month → "Jul 10–12"; else "Jul 30 – Aug 2"
export function phDateRange(startIso: string, endIso: string): string {
  if (startIso === endIso) return phDate(startIso);
  if (startIso.slice(0, 7) === endIso.slice(0, 7)) {
    return `${phDate(startIso)}–${Number(endIso.slice(8))}`;
  }
  return `${phDate(startIso)} – ${phDate(endIso)}`;
}
