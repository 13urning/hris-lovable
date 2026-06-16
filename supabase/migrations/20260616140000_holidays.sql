-- Philippine holidays calendar. Drives two things:
--   1. Absence computation excludes holidays (a holiday with no clock-in is NOT
--      an absence).
--   2. The dashboard surfaces upcoming holidays for the current month.
--
-- Rows can be synced from the Nager.Date public API (source = 'nager') or added
-- manually by an admin (source = 'manual') for movable/proclaimed holidays the
-- API does not cover (e.g. Eid'l Fitr, Eid'l Adha).

CREATE TABLE IF NOT EXISTS public.holidays (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date DATE NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  local_name   TEXT,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  source       TEXT NOT NULL DEFAULT 'manual',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON public.holidays(holiday_date);

-- Seed 2026 PH national holidays (Nager.Date). Idempotent on re-run.
INSERT INTO public.holidays (holiday_date, name, local_name, source) VALUES
  ('2026-01-01', 'New Year''s Day', 'Bagong Taon', 'nager'),
  ('2026-02-17', 'Chinese New Year', 'Chinese New Year', 'nager'),
  ('2026-04-02', 'Maundy Thursday', 'Huwebes Santo', 'nager'),
  ('2026-04-03', 'Good Friday', 'Biyernes Santo', 'nager'),
  ('2026-04-04', 'Holy Saturday', 'Sabado de Gloria', 'nager'),
  ('2026-04-09', 'Day of Valor', 'Araw ng Kagitingan', 'nager'),
  ('2026-05-01', 'Labour Day', 'Araw ng Paggawa', 'nager'),
  ('2026-06-12', 'Independence Day', 'Araw ng Kalayaan', 'nager'),
  ('2026-08-21', 'Ninoy Aquino Day', 'Araw ng Kamatayan ni Senador Benigno Simeon "Ninoy" Aquino Jr.', 'nager'),
  ('2026-08-31', 'National Heroes Day', 'Araw ng mga Bayani', 'nager'),
  ('2026-10-31', 'All Saints'' Day Eve', 'All Saints'' Day Eve', 'nager'),
  ('2026-11-01', 'All Saints'' Day', 'Araw ng mga Santo', 'nager'),
  ('2026-11-30', 'Bonifacio Day', 'Araw ni Gat Andres Bonifacio', 'nager'),
  ('2026-12-08', 'Feast of the Immaculate Conception', 'Kapistahan ng Immaculada Concepcion', 'nager'),
  ('2026-12-24', 'Christmas Eve', 'Christmas Eve', 'nager'),
  ('2026-12-25', 'Christmas Day', 'Araw ng Pasko', 'nager'),
  ('2026-12-30', 'Rizal Day', 'Araw ng Kamatayan ni Dr. Jose Rizal', 'nager'),
  ('2026-12-31', 'Last Day of The Year', 'Huling Araw ng Taon', 'nager')
ON CONFLICT (holiday_date) DO NOTHING;
