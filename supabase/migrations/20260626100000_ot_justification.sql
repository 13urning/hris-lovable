-- Migration: OT filer justification
--
-- Lets the filer attach a justification when requesting an OT budget or filing
-- actual OT hours. Kept separate from review_notes (which holds approver /
-- rejection notes) so an approver's note never overwrites the filer's reason.

ALTER TABLE ot_approval_requests
  ADD COLUMN IF NOT EXISTS justification text;
