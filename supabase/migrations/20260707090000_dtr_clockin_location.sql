-- Web clock-in/out GPS location tagging (audit-only, no enforcement).
--
-- Additive + nullable: legacy rows keep loc_status = NULL ("predates feature"),
-- which is distinct from the 'not_captured' status a new row uses when location
-- was never attempted. No backfill, no table rewrite.
--
-- Coordinates are self-reported by the browser Geolocation API and are ADVISORY
-- ONLY. They are never used to allow or deny a clock-in (see clockInDTR /
-- clockOutDTR in src/lib/dtr-functions.ts). The existing IP-CIDR office-network
-- geofence remains the sole location gate.

ALTER TABLE daily_time_reports
  ADD COLUMN IF NOT EXISTS clock_in_lat        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS clock_in_lon        NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS clock_in_accuracy   NUMERIC(7,1),
  ADD COLUMN IF NOT EXISTS clock_in_loc_status TEXT,
  ADD COLUMN IF NOT EXISTS clock_out_lat        NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS clock_out_lon        NUMERIC(10,6),
  ADD COLUMN IF NOT EXISTS clock_out_accuracy   NUMERIC(7,1),
  ADD COLUMN IF NOT EXISTS clock_out_loc_status TEXT;

-- Value guard for the status columns. NULL is allowed so legacy rows never
-- violate it. NOT VALID keeps the lock light and skips re-scanning existing
-- rows (all NULL, trivially valid).
ALTER TABLE daily_time_reports
  DROP CONSTRAINT IF EXISTS dtr_clock_in_loc_status_check;
ALTER TABLE daily_time_reports
  ADD CONSTRAINT dtr_clock_in_loc_status_check
  CHECK (clock_in_loc_status IS NULL
         OR clock_in_loc_status IN ('captured', 'unavailable', 'not_captured'))
  NOT VALID;

ALTER TABLE daily_time_reports
  DROP CONSTRAINT IF EXISTS dtr_clock_out_loc_status_check;
ALTER TABLE daily_time_reports
  ADD CONSTRAINT dtr_clock_out_loc_status_check
  CHECK (clock_out_loc_status IS NULL
         OR clock_out_loc_status IN ('captured', 'unavailable', 'not_captured'))
  NOT VALID;

-- Coordinate range sanity at the DB tier (defense in depth behind the server
-- validation in normalizeLocation). NULL-tolerant, NOT VALID for a light lock.
ALTER TABLE daily_time_reports
  DROP CONSTRAINT IF EXISTS dtr_clock_in_coord_range_check;
ALTER TABLE daily_time_reports
  ADD CONSTRAINT dtr_clock_in_coord_range_check
  CHECK ((clock_in_lat IS NULL OR clock_in_lat BETWEEN -90 AND 90)
     AND (clock_in_lon IS NULL OR clock_in_lon BETWEEN -180 AND 180)
     AND (clock_in_accuracy IS NULL OR clock_in_accuracy >= 0))
  NOT VALID;

ALTER TABLE daily_time_reports
  DROP CONSTRAINT IF EXISTS dtr_clock_out_coord_range_check;
ALTER TABLE daily_time_reports
  ADD CONSTRAINT dtr_clock_out_coord_range_check
  CHECK ((clock_out_lat IS NULL OR clock_out_lat BETWEEN -90 AND 90)
     AND (clock_out_lon IS NULL OR clock_out_lon BETWEEN -180 AND 180)
     AND (clock_out_accuracy IS NULL OR clock_out_accuracy >= 0))
  NOT VALID;
