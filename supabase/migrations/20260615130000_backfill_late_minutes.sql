-- Backfill late_minutes for existing clock-ins under the company tardiness rule:
-- any clock-in after 09:00 (540 minutes) is late. Minutes past 09:00, floored at
-- 0 for on-time arrivals. Idempotent — safe to re-run.
UPDATE daily_time_reports
SET late_minutes = GREATEST(
  0,
  (EXTRACT(HOUR FROM time_in) * 60 + EXTRACT(MINUTE FROM time_in))::int - 540
)
WHERE time_in IS NOT NULL;
