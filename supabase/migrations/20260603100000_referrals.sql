-- Referral Program — additive, scoped to miyagisanchez (shared Supabase).
-- Run this in Supabase SQL editor: https://xljxqymsuyhlnorfrnno.supabase.co/project/xljxqymsuyhlnorfrnno/editor
-- Access is via the service role only (no RLS), like the other marketplace_* tables.

-- One shareable referral code per user.
CREATE TABLE IF NOT EXISTS marketplace_referral_codes (
  clerk_user_id  TEXT        PRIMARY KEY,
  code           TEXT        NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ledger: one row per invited person.
-- status: 'signed_up' → 'qualified' (first paid order) → 'rewarded' (coupon issued)
CREATE TABLE IF NOT EXISTS marketplace_referrals (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_clerk_user_id  TEXT        NOT NULL,
  referred_clerk_user_id  TEXT        UNIQUE,
  referred_email          TEXT,
  status                  TEXT        NOT NULL DEFAULT 'signed_up',
  reward_coupon_code      TEXT,
  reward_amount_cents     INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  qualified_at            TIMESTAMPTZ,
  rewarded_at             TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS marketplace_referrals_referrer_idx
  ON marketplace_referrals (referrer_clerk_user_id);
CREATE INDEX IF NOT EXISTS marketplace_referrals_status_idx
  ON marketplace_referrals (status);

-- Singleton, admin-editable reward config (no deploy needed to change amounts).
CREATE TABLE IF NOT EXISTS marketplace_referral_settings (
  id                  INTEGER     PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled             BOOLEAN     NOT NULL DEFAULT true,
  reward_type         TEXT        NOT NULL DEFAULT 'fixed',     -- 'fixed' | 'percentage'
  reward_amount_cents INTEGER     NOT NULL DEFAULT 10000,       -- $100 MXN toward a print ad
  reward_expiry_days  INTEGER     NOT NULL DEFAULT 90,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO marketplace_referral_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
