-- Migration: recurring calendar events via materialized occurrences
--
-- A series is the authored rule; each occurrence is an ordinary
-- calendar_events row, so the entire lazy-promotion / reminder /
-- notification stack works unchanged. Deleting a series cascades to its
-- occurrences and their reminders; already-delivered notifications survive
-- via the existing SET NULL on notifications.event_id / reminder_id.
-- Occurrence generation happens in app code (src/lib/recurrence.ts) at
-- create time, capped at 104 occurrences / 3-year horizon.

CREATE TABLE IF NOT EXISTS event_series (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frequency    text NOT NULL CHECK (frequency IN ('daily','weekly','monthly','yearly')),
  interval_n   integer NOT NULL DEFAULT 1 CHECK (interval_n BETWEEN 1 AND 52),
  -- Anchor = the FIRST occurrence's start instant; the rule derives the rest.
  -- until_date is the inclusive PH-local horizon the admin picked.
  starts_at    timestamptz NOT NULL,
  until_date   date NOT NULL,
  occurrence_count integer NOT NULL CHECK (occurrence_count BETWEEN 1 AND 104),
  created_by   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS series_id uuid
    REFERENCES event_series(id) ON DELETE CASCADE;  -- NULL = one-off event
ALTER TABLE calendar_events
  ADD COLUMN IF NOT EXISTS occurrence_index integer; -- 0-based, NULL for one-offs

CREATE INDEX IF NOT EXISTS calendar_events_series_idx
  ON calendar_events (series_id) WHERE series_id IS NOT NULL;
