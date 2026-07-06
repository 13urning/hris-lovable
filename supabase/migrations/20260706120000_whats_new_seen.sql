-- Migration: "What's New" per-user seen-tracking + first-sight watermark
--
-- The What's New modal (src/components/WhatsNewModal.tsx) shows MAJOR, unseen
-- announcement entries — defined in code at src/lib/whats-new.ts — whose target
-- roles intersect the viewer's roles, once per user across devices. Two pieces of
-- state, doing two different jobs:
--
--   whats_new_seen           — per (user, entry) dismissal rows. Steady state:
--                              "this user has already acknowledged entry X."
--                              Order- and role-independent; the PK is the
--                              idempotent claim (same pattern as notifications).
--   profiles.whats_new_watermark — a per-user cutoff. An entry published on or
--                              before it is treated as "before your time" and
--                              never shown. Seeded from the account's creation
--                              time, so a brand-new hire never gets flooded with
--                              the entire back-catalogue, while existing users
--                              still see anything shipped after they joined.
--
-- No RLS (app-layer authz, consistent with the rest of the Cloud SQL schema).
-- entry_id values are code-defined slugs, never user input; no FK (the source of
-- truth is a code file, and a seen-row must survive an entry being removed).

CREATE TABLE IF NOT EXISTS whats_new_seen (
  user_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entry_id  text        NOT NULL,
  seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, entry_id)   -- the only query is WHERE user_id = $1; PK covers it
);

-- Watermark. NULL only ever appears transiently mid-migration; the backfill and
-- the DEFAULT below ensure every real row has a value.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whats_new_watermark timestamptz;

-- Backfill EXISTING users to their account creation time: they are accountable
-- for (and will see) any major entry published after they joined — including
-- this launch — but nothing predating them.
UPDATE profiles SET whats_new_watermark = created_at WHERE whats_new_watermark IS NULL;

-- Future accounts (import path or provisionUser) auto-get a birth-time watermark
-- with no app-code change, so new hires start with a clean slate.
ALTER TABLE profiles ALTER COLUMN whats_new_watermark SET DEFAULT now();
