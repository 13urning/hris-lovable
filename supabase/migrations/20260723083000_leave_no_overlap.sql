-- Airtight no-overlap guard for active leave requests (security-gate finding F-1).
--
-- Complements the application-level check in leave-functions.ts by making it
-- IMPOSSIBLE at the database level for one employee to hold two overlapping
-- ACTIVE (pending/approved) leave requests — even under a concurrent race that
-- slips past the app-level pre-check. Cancelled/rejected leaves are excluded (the
-- partial WHERE) so re-filing after a rejection still works.
--
-- Half-day semantics match the app guard EXACTLY. Each leave occupies a half-open
-- time interval, so two SAME-DAY half-days with DIFFERENT AM/PM periods do NOT
-- conflict (AM = [00:00,12:00), PM = [12:00,24:00)), while AM+AM, AM+full,
-- full+full, and any multi-day overlap all conflict. Consecutive full days do NOT
-- conflict (half-open '[)' upper bound). A malformed half-day with a NULL period
-- is treated conservatively as occupying the whole day.
--
-- All interval expressions use `timestamp` (without time zone) casts so the index
-- expression is IMMUTABLE (a timestamptz/now() cast would be rejected).
--
-- NON-DESTRUCTIVE: adds an extension and a constraint; changes no rows. Verified
-- zero existing violations on staging and prod before applying
-- (scripts/check-leave-overlaps.mjs). Rollback is instant with no data loss — see
-- the paired 20260723083000_leave_no_overlap_rollback.sql.
--
-- Applied via scripts/apply-migration.mjs, which wraps this file in a single
-- transaction (BEGIN/COMMIT) — so the SET LOCAL timeouts scope to this migration.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- GiST equality operator class for the uuid employee_id column used with `=` below.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE public.leave_requests
  ADD CONSTRAINT leave_requests_no_overlap
  EXCLUDE USING gist (
    employee_id WITH =,
    tsrange(
      -- lower bound: PM half-day starts at noon; everything else at day start
      start_date::timestamp
        + CASE WHEN half_day AND half_day_period = 'PM'
               THEN interval '12 hours' ELSE interval '0 hours' END,
      -- upper bound (exclusive): AM ends at noon; PM ends next midnight; a
      -- full-day or multi-day leave runs through the day after end_date
      CASE
        WHEN half_day AND half_day_period = 'AM' THEN start_date::timestamp + interval '12 hours'
        WHEN half_day AND half_day_period = 'PM' THEN (start_date + 1)::timestamp
        ELSE (end_date + 1)::timestamp
      END,
      '[)'
    ) WITH &&
  )
  WHERE (status IN ('pending', 'approved'));
