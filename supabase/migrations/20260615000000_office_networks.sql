-- Office network allowlist for clock-in geofencing.
-- A clock-in is only permitted when the caller's public IP falls within one of
-- the active CIDR ranges below. Admins manage these rows from the
-- "Office Networks" admin screen.
--
-- Design note: when there are ZERO active rows the check FAILS OPEN (clock-in is
-- allowed from anywhere). This makes the feature opt-in — the restriction only
-- takes effect once an admin has added at least one network, so deploying this
-- migration alone never locks anyone out.
--
-- The `cidr` column uses Postgres' native cidr type so containment matching is
-- done in-database with the `<<=` operator (`$1::inet <<= cidr`). A single static
-- IP is just a /32 (e.g. 203.0.113.10/32).

CREATE TABLE IF NOT EXISTS office_networks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  cidr       cidr NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of the active set during the clock-in containment check.
CREATE INDEX IF NOT EXISTS idx_office_networks_active
  ON office_networks (is_active)
  WHERE is_active = true;
