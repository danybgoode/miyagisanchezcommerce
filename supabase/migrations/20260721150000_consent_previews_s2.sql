-- Founding merchant consent-safe previews · Sprint 2 — additive, scoped to
-- miyagisanchez (shared Supabase). Apply BY HAND in the SQL editor and verify
-- with to_regclass (a merged file is NOT an applied migration).
--
-- Sprint 1 shipped the preview anchor + opaque links. This adds the CONSENT
-- RECORD itself: an immutable, versioned log of what the merchant was shown and
-- what they decided about it. Append-only by design — a decision is a historical
-- fact, so a later edit creates a NEW row rather than mutating the old one.

-- One row per merchant decision on a specific reviewed snapshot.
--
-- `snapshot_hash` is the content hash from lib/preview-snapshot.ts, computed over
-- exactly the material fields (shop identity + each product's id/title/price/
-- currency/image). It is what makes approval VERSIONED: activation re-hashes the
-- live proposal and refuses unless it still matches the approved hash, so a
-- material edit after approval cannot publish under the old consent.
--
-- `snapshot` keeps the full reviewed payload as JSONB — the merchant-readable
-- record of what they actually saw, independent of any later mutation of the
-- shop. Without it the hash would prove a change occurred but not what was agreed.
CREATE TABLE IF NOT EXISTS merchant_preview_decisions (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  preview_id    UUID        NOT NULL REFERENCES merchant_previews(id) ON DELETE CASCADE,
  version       INTEGER     NOT NULL,
  decision      TEXT        NOT NULL CHECK (decision IN ('approved', 'changes_requested')),
  snapshot_hash TEXT        NOT NULL,
  snapshot      JSONB       NOT NULL,
  -- Provenance of the decision. NOT a legal signature — we record what happened
  -- (which link was used, from where), never claim identity we cannot prove.
  -- `grant_id` ties the decision to the specific opaque link it came through.
  grant_id      UUID        REFERENCES merchant_preview_grants(id),
  actor_note    TEXT,                                  -- optional merchant message
  actor_ip_hash TEXT,                                  -- hashed, never raw IP
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS merchant_preview_decisions_preview_idx
  ON merchant_preview_decisions (preview_id, created_at DESC);

-- The APPROVED snapshot a preview currently rests on, and when it was activated.
-- Nullable: a preview may never have been approved. `approved_snapshot_hash` is
-- the value activation compares against; it is CLEARED when a material edit
-- invalidates approval, so a stale hash can never authorize a publish.
ALTER TABLE merchant_previews
  ADD COLUMN IF NOT EXISTS approved_snapshot_hash TEXT,
  ADD COLUMN IF NOT EXISTS approved_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at           TIMESTAMPTZ;

-- Same posture as the Sprint 1 tables: RLS ON, no policies. These rows ARE the
-- consent record — a client able to insert an 'approved' decision could publish a
-- merchant's shop without their consent. The app reaches Supabase only via the
-- service-role key, which bypasses RLS.
ALTER TABLE merchant_preview_decisions ENABLE ROW LEVEL SECURITY;
