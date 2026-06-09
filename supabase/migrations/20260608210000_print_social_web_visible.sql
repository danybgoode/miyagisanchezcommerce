-- Neighborhood Pulse · web opt-in for community/social submissions.
-- Additive and default-off: print approval never auto-publishes an item online.

ALTER TABLE print_social_submissions
  ADD COLUMN IF NOT EXISTS web_visible BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS print_social_web_visible_idx
  ON print_social_submissions (web_visible, status, created_at DESC);
