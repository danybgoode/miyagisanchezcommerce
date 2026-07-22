-- Golden Beans event-destination-router · Story 3.1 — the Miyagi merchant-lifecycle
-- projection (the CONSUMER side of the loop).
--
-- Additive, scoped to miyagisanchez (shared Supabase). Apply BY HAND in the SQL
-- editor BEFORE merging the code that reads these tables, and verify with
-- to_regclass — a merged file is NOT an applied migration (LEARNINGS: "Supabase
-- migration file vs. actually-applied").
--
-- AGENTS rule #1 & #2 hold: none of this is commerce. Medusa remains the source of
-- truth for shops, products and orders. What lands here are lifecycle FACTS —
-- "this merchant reached this milestone at this time" — delivered by Golden Beans
-- over the Sprint 2 signed webhook. `first_sale` is a milestone FLAG, never an
-- order record; there is deliberately no amount, no order id, no buyer.
--
-- The merchant id is `marketplace_shops.id` (the shop mirror UUID) — the same
-- non-personal subject key lib/preview-events.ts already uses. TEXT, not UUID:
-- the envelope's `subject.id` is an opaque string on the wire and a malformed one
-- must be rejected by our own validation with a clean 4xx, not by a cast error
-- deep inside a function.

-- ---------------------------------------------------------------------------
-- 1. The idempotency store — one row per DELIVERED Golden Beans event.
-- ---------------------------------------------------------------------------
-- `event_id` is the envelope `id`: the canonical Golden Beans EVENT id, stable
-- across every retry AND every operator replay. It is the ONLY correct dedupe
-- key (the delivery id changes per attempt; a content hash would collapse two
-- genuinely distinct milestones that happen to serialize identically).
--
-- It is the PRIMARY KEY, which is the whole point: idempotency is enforced by a
-- UNIQUE CONSTRAINT inside one statement, never by a SELECT-then-INSERT in Node.
-- Delivery is at-least-once and the dispatcher retries concurrently, so two
-- attempts of the same event can be in flight at once — check-then-act would let
-- both pass the check and both write.
CREATE TABLE IF NOT EXISTS merchant_lifecycle_deliveries (
  event_id    TEXT        PRIMARY KEY,
  event_type  TEXT        NOT NULL,
  merchant_id TEXT        NOT NULL,
  -- The producer's asserted event time (envelope `occurredAt`), which is what the
  -- milestone is stamped with — NOT our receipt time. A retry that lands 20
  -- minutes late must not move the milestone.
  occurred_at TIMESTAMPTZ NOT NULL,
  -- X-GB-Delivery-Id: changes per ATTEMPT, so it is diagnostics only. Recording it
  -- lets an operator match a Miyagi row to a specific line in Golden Beans'
  -- delivery history; it is never used for dedupe.
  delivery_id TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The verified envelope as delivered. Kept so a projection bug can be replayed
  -- from what we actually received rather than from what we think was sent.
  payload     JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS merchant_lifecycle_deliveries_merchant_idx
  ON merchant_lifecycle_deliveries (merchant_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 2. The projection — ONE row per merchant, one column per milestone.
-- ---------------------------------------------------------------------------
-- Deliberately a milestone table, not an event log: "a repeat delivery must be a
-- no-op, not a second milestone" (contract guarantee 1). A milestone is a
-- timestamp that can only ever be set once, to the EARLIEST occurrence — see the
-- LEAST() semantics in apply_merchant_lifecycle_event below.
CREATE TABLE IF NOT EXISTS merchant_lifecycle (
  merchant_id             TEXT        PRIMARY KEY,
  -- Stamped by whichever lifecycle event arrives first for this merchant. The
  -- contract names it as the effect of `permission_granted`, but a projection
  -- that only learns a merchant exists from one specific event type would show
  -- nothing at all if that event were ever lost or delivered out of order.
  first_seen_at           TIMESTAMPTZ NOT NULL,
  permission_granted_at   TIMESTAMPTZ,
  preview_approved_at     TIMESTAMPTZ,
  claimed_at              TIMESTAMPTZ,
  three_products_live_at  TIMESTAMPTZ,
  first_sale_at           TIMESTAMPTZ,
  retained_30d_at         TIMESTAMPTZ,
  -- Most recent occurred_at seen for this merchant, for operator triage.
  last_event_at           TIMESTAMPTZ,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 3. Apply one delivered event — atomically, in a single round trip.
-- ---------------------------------------------------------------------------
-- Returns {"applied": bool, "duplicate": bool}. Both writes (the dedupe row and
-- the projection) happen inside one function invocation, so they commit or roll
-- back together: a crash between them cannot leave an event recorded-but-
-- unprojected, which would be the one state that is silently unrecoverable
-- (the retry would be deduped away).
--
-- The ON CONFLICT DO NOTHING ... RETURNING idiom is the idempotency gate. When
-- the insert loses the race it returns no row, we return duplicate:true, and the
-- projection is never touched. That is the "repeat delivery is a no-op" guarantee,
-- enforced by the constraint rather than by application logic.
CREATE OR REPLACE FUNCTION apply_merchant_lifecycle_event(
  p_event_id    TEXT,
  p_event_type  TEXT,
  p_merchant_id TEXT,
  p_occurred_at TIMESTAMPTZ,
  p_delivery_id TEXT,
  p_payload     JSONB
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted BOOLEAN := FALSE;
BEGIN
  -- Defence in depth: the route already validates the vocabulary. Without this a
  -- typo'd type would insert a merchant row with every milestone NULL — a row that
  -- looks like a tracked merchant and means nothing.
  IF p_event_type NOT IN (
    'merchant.permission_granted',
    'merchant.preview_approved',
    'merchant.claimed',
    'merchant.three_products_live',
    'merchant.first_sale',
    'merchant.retained_30d'
  ) THEN
    RAISE EXCEPTION 'unknown merchant lifecycle event type: %', p_event_type;
  END IF;

  IF p_merchant_id IS NULL OR btrim(p_merchant_id) = '' THEN
    RAISE EXCEPTION 'merchant id is required';
  END IF;

  INSERT INTO merchant_lifecycle_deliveries
    (event_id, event_type, merchant_id, occurred_at, delivery_id, payload)
  VALUES
    (p_event_id, p_event_type, p_merchant_id, p_occurred_at, p_delivery_id, p_payload)
  ON CONFLICT (event_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF NOT v_inserted THEN
    RETURN jsonb_build_object('applied', false, 'duplicate', true);
  END IF;

  INSERT INTO merchant_lifecycle AS m (
    merchant_id, first_seen_at, last_event_at,
    permission_granted_at, preview_approved_at, claimed_at,
    three_products_live_at, first_sale_at, retained_30d_at
  ) VALUES (
    p_merchant_id, p_occurred_at, p_occurred_at,
    CASE WHEN p_event_type = 'merchant.permission_granted'  THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.preview_approved'    THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.claimed'             THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.three_products_live' THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.first_sale'          THEN p_occurred_at END,
    CASE WHEN p_event_type = 'merchant.retained_30d'        THEN p_occurred_at END
  )
  ON CONFLICT (merchant_id) DO UPDATE SET
    -- LEAST/GREATEST IGNORE NULLs in Postgres (unlike the aggregate MIN/MAX
    -- confusion this reads like), which is exactly the semantics we want:
    --   existing NULL + new value  → the new value      (first time we learn it)
    --   existing value + new NULL  → the existing value (a different event type)
    --   existing value + new value → the EARLIER one    (out-of-order redelivery)
    -- So a milestone is write-once-earliest. Two distinct events of the same type
    -- (which at-least-once delivery does not cause, but a producer bug could)
    -- still collapse to ONE logical milestone.
    first_seen_at          = LEAST(m.first_seen_at,          EXCLUDED.first_seen_at),
    last_event_at          = GREATEST(m.last_event_at,       EXCLUDED.last_event_at),
    permission_granted_at  = LEAST(m.permission_granted_at,  EXCLUDED.permission_granted_at),
    preview_approved_at    = LEAST(m.preview_approved_at,    EXCLUDED.preview_approved_at),
    claimed_at             = LEAST(m.claimed_at,             EXCLUDED.claimed_at),
    three_products_live_at = LEAST(m.three_products_live_at, EXCLUDED.three_products_live_at),
    first_sale_at          = LEAST(m.first_sale_at,          EXCLUDED.first_sale_at),
    retained_30d_at        = LEAST(m.retained_30d_at,        EXCLUDED.retained_30d_at),
    updated_at             = now();

  RETURN jsonb_build_object('applied', true, 'duplicate', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The EMIT-side once-only guard.
-- ---------------------------------------------------------------------------
-- Miyagi is both producer and consumer here: it emits the six lifecycle events to
-- Golden Beans, which stores them and fans them back into the projection above.
-- The loop cannot be used for emit-side dedupe — while DESTINATION_DELIVERY_ENABLED
-- is OFF nothing ever comes back, so a "have I already projected this?" check would
-- let a repeating call site (upsertOrderMirror runs from the Stripe webhook, the
-- MercadoPago webhook AND the reconcile cron; the retention sweep runs daily) emit
-- the same milestone forever.
--
-- So the emit side gets its own claim table. (merchant_id, event_type) is the
-- primary key: INSERT ... and treat a 23505 unique violation as "already emitted".
-- Same discipline as the delivery store — the constraint decides, not a prior read.
CREATE TABLE IF NOT EXISTS merchant_lifecycle_emissions (
  merchant_id TEXT        NOT NULL,
  event_type  TEXT        NOT NULL,
  emitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (merchant_id, event_type)
);

-- ---------------------------------------------------------------------------
-- 5. RLS: ON, with NO policies — the same posture as merchant_previews.
-- ---------------------------------------------------------------------------
-- These rows describe which merchants are in the founding-merchant funnel and how
-- far along they are. That is commercially sensitive relationship state, and the
-- delivery payloads are the verified bytes of an authenticated integration. The
-- app reaches Supabase only through the service-role key, which bypasses RLS, so
-- enabling it costs the app nothing and removes anon/authenticated access entirely.
ALTER TABLE merchant_lifecycle_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_lifecycle            ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_lifecycle_emissions  ENABLE ROW LEVEL SECURITY;

-- The function is only ever called with the service-role key. PostgREST exposes
-- every function in the public schema, so revoke it from the client-facing roles:
-- reachable by anon it would be an unauthenticated writer into the projection.
REVOKE ALL ON FUNCTION apply_merchant_lifecycle_event(TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
