-- Migration: calendar events with reminders + in-app notification inbox
--
-- An admin creates an event (performance review, meeting, deadline). Each event
-- may carry reminders; a reminder fires to a single recipient (the admin
-- themselves, or a selected user) at a computed fire_at instant. Delivery is
-- LAZY: there is no cron. When a user polls their notification inbox, any of
-- THEIR reminders whose fire_at <= now() are materialized into notification
-- rows (idempotently, via the partial unique index below) and returned.
--
-- No RLS: authorization is app-layer (auth-middleware + assertAdmin/assertUser),
-- consistent with the rest of this schema on Cloud SQL.

-- ── Events ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  description  text,
  -- Wall-clock event moment. The server converts the admin's PH-local input
  -- (date + HH:MM) to an absolute instant at write time using the fixed +08:00
  -- offset (PH has no DST). all_day events pin to 00:00 PH and the UI ignores
  -- the time component.
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz,                       -- NULL = point-in-time / all-day
  all_day      boolean NOT NULL DEFAULT false,
  location     text,
  created_by   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT calendar_events_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT calendar_events_desc_len  CHECK (description IS NULL OR char_length(description) <= 2000),
  CONSTRAINT calendar_events_loc_len   CHECK (location IS NULL OR char_length(location) <= 200),
  CONSTRAINT calendar_events_time_order CHECK (ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX IF NOT EXISTS calendar_events_starts_at_idx ON calendar_events (starts_at);
CREATE INDEX IF NOT EXISTS calendar_events_created_by_idx ON calendar_events (created_by);

-- ── Reminders ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_reminders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id       uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  -- Single recipient. Defaults to the creator at the app layer. FK, not free
  -- text, so a deleted user cascades their reminders away.
  notify_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- Absolute instant the reminder becomes due. Computed = starts_at - offset.
  -- Stored (not derived on read) so the promotion scan is a plain indexed range.
  fire_at        timestamptz NOT NULL,
  -- Denormalized for auditability / UI ("30 minutes before"). Minutes.
  offset_minutes integer NOT NULL DEFAULT 0,
  created_by     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT event_reminders_offset_range
    CHECK (offset_minutes BETWEEN 0 AND 40320)   -- 0 .. 4 weeks
);
-- Hot path: "my reminders that are due". The promotion query filters
-- notify_user_id = $me AND fire_at <= now().
CREATE INDEX IF NOT EXISTS event_reminders_user_fire_idx
  ON event_reminders (notify_user_id, fire_at);
CREATE INDEX IF NOT EXISTS event_reminders_event_idx
  ON event_reminders (event_id);

-- ── Notifications (the in-app inbox) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type         text NOT NULL DEFAULT 'event_reminder'
    CHECK (type IN ('event_reminder')),          -- extensible enum-ish
  -- Nullable link back to the source reminder. SET NULL (not CASCADE): once a
  -- notification is delivered it is a standalone snapshot; deleting the event
  -- must NOT retract a reminder the user already saw.
  reminder_id  uuid REFERENCES event_reminders(id) ON DELETE SET NULL,
  event_id     uuid REFERENCES calendar_events(id) ON DELETE SET NULL,
  -- Snapshotted content so the row renders even after the event is edited/deleted.
  title        text NOT NULL,
  body         text,
  read_at      timestamptz,                       -- NULL = unread
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_title_len CHECK (char_length(title) BETWEEN 1 AND 300)
);
-- Idempotency of promotion: at most ONE notification per reminder. This is the
-- concurrency guard for concurrent polls / multiple Cloud Run instances —
-- INSERT ... ON CONFLICT DO NOTHING makes the insert itself the atomic claim.
-- Partial so future non-reminder notifications (reminder_id NULL) aren't
-- constrained.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_reminder_uniq
  ON notifications (reminder_id) WHERE reminder_id IS NOT NULL;
-- Inbox reads: unread-count and list, newest first, scoped to the user.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id) WHERE read_at IS NULL;
