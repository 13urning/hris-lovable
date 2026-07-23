-- Rollback for 20260723083000_leave_no_overlap.sql
--
-- Instant and non-destructive: drops the constraint (and its backing GiST index).
-- No leave data is touched. Apply the same way:
--   node scripts/apply-migration.mjs supabase/migrations/20260723083000_leave_no_overlap_rollback.sql <db>

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS leave_requests_no_overlap;

-- btree_gist is intentionally LEFT installed — it is harmless and may be relied on
-- by future constraints. To fully revert the extension as well (only if nothing
-- else uses it), run manually:
--   DROP EXTENSION IF EXISTS btree_gist;
