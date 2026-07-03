-- Migration: widen notifications to approval-flow events
--
-- The in-app inbox (20260703150000) so far only carries calendar event
-- reminders. This adds the approval-flow taxonomy: an approver is notified
-- when a leave / OT / attendance-dispute request lands in their queue, and the
-- requester is notified when their request is finally approved or rejected.
-- Approval notifications are inserted eagerly inside the mutating transaction
-- (not lazily materialized like reminders). No RLS (app-layer authz).

-- 1) Widen the type CHECK. The original constraint is the inline auto-named
--    one from 20260703150000; drop-if-exists then re-add covers any name.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'event_reminder',
    'leave_request',    'leave_decision',
    'ot_request',       'ot_decision',
    'dispute_request',  'dispute_decision'
  ));

-- 2) Generic reference to the source row (leave_requests / ot_approval_requests
--    / attendance_disputes). Plain uuid, NO FK — three different source tables,
--    and notifications are self-contained snapshots that must survive source
--    deletion. Never used for authorization; purely traceability + idempotency.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ref_id uuid;

-- 3) Idempotency guard: a given (user, type, source row) notifies at most once,
--    so a retried mutation can't duplicate. Composite because one source row
--    legitimately notifies several users over its lifetime (each approver in
--    turn, then the requester), and a request vs decision notification share
--    the same ref_id. Partial: event_reminder rows keep their own
--    notifications_reminder_uniq index.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_ref_uniq
  ON notifications (user_id, type, ref_id) WHERE ref_id IS NOT NULL;
