-- Sprint 3 fix: allow 'subscription' as a valid listing_type
-- Dynamically drops any CHECK constraint on listing_type so 'subscription' can be inserted.
-- Safe to run even if no such constraint exists.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'marketplace_listings'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%listing_type%'
  LOOP
    EXECUTE format('ALTER TABLE marketplace_listings DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'Dropped constraint: %', r.conname;
  END LOOP;
END $$;

-- No new constraint — listing_type is a free-form TEXT field going forward.
-- Valid values are: 'product' | 'service' | 'rental' | 'digital' | 'subscription'
-- (enforced at the application layer in the create API)
