-- ── Catalog bulk-action staging + audit ──────────────────────────────────────
-- catalog-management epic, Sprint 3 · Story 3.1. Staged bulk-action state is
-- operational/presentation data, not commerce truth (AGENTS rule 2) — the
-- actual product mutation happens through Medusa's updateSellerProduct() per
-- item; these tables only track "what did the seller/agent stage and what
-- happened when they applied it." Modeled on supply_batches/supply_items
-- (the existing staged-import pattern) rather than admin_audit_log (which is
-- Clerk-admin-actor-scoped with a redacted-summary shape, not before/after).

CREATE TABLE catalog_bulk_batches (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id      TEXT        NOT NULL,                          -- Clerk user id (owning identity — same scoping key marketplace_shops.clerk_user_id already uses; not a Medusa FK)
  actor_type     TEXT        NOT NULL DEFAULT 'seller',          -- 'seller' | 'agent'
  actor_id       TEXT,                                           -- Clerk user id (seller) or agent token id
  action         JSONB       NOT NULL,                           -- the BulkActionPayload, for replay/audit
  status         TEXT        NOT NULL DEFAULT 'staging',         -- staging|ready|applying|applied|partially_failed
  total_count    INTEGER     NOT NULL DEFAULT 0,
  valid_count    INTEGER     NOT NULL DEFAULT 0,
  applied_count  INTEGER     NOT NULL DEFAULT 0,
  failed_count   INTEGER     NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT catalog_bulk_batches_status_check
    CHECK (status IN ('staging', 'ready', 'applying', 'applied', 'partially_failed')),
  CONSTRAINT catalog_bulk_batches_actor_type_check
    CHECK (actor_type IN ('seller', 'agent'))
);

CREATE INDEX idx_catalog_bulk_batches_seller ON catalog_bulk_batches(seller_id, created_at DESC);

CREATE TABLE catalog_bulk_batch_items (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id       UUID        NOT NULL REFERENCES catalog_bulk_batches(id) ON DELETE CASCADE,
  product_id     TEXT        NOT NULL,                           -- Medusa product id
  title          TEXT        NOT NULL,
  before         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  after          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  patch          JSONB,                                          -- the SellerProductUpdateBody to apply (null if invalid)
  valid          BOOLEAN     NOT NULL DEFAULT true,
  error_message  TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending',         -- pending|applying|applied|failed
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  -- 'applying' is the atomic-claim state: apply() flips pending→applying via a
  -- single UPDATE...WHERE status='pending' RETURNING (never a plain read-then-
  -- write), so two concurrent apply calls on the same batch can't both claim
  -- the same row — Postgres' row-level locking on the UPDATE makes the claim
  -- itself atomic (cross-agent review catch: the original read-then-process-
  -- then-write pattern had a TOCTOU race between concurrent requests).
  CONSTRAINT catalog_bulk_batch_items_status_check
    CHECK (status IN ('pending', 'applying', 'applied', 'failed'))
);

CREATE INDEX idx_catalog_bulk_batch_items_batch ON catalog_bulk_batch_items(batch_id);
CREATE INDEX idx_catalog_bulk_batch_items_status ON catalog_bulk_batch_items(batch_id, status);

-- ── Audit log — one row per item-apply-attempt ───────────────────────────────
-- Distinct from admin_audit_log: seller/agent-actor-scoped, real before/after
-- (not a redacted payload summary) — the "audit log with actor + before/after"
-- Story 3.1 acceptance requires.

CREATE TABLE catalog_bulk_audit_log (
  id             UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id       UUID        NOT NULL REFERENCES catalog_bulk_batches(id) ON DELETE CASCADE,
  item_id        UUID        REFERENCES catalog_bulk_batch_items(id) ON DELETE SET NULL,
  product_id     TEXT        NOT NULL,
  actor_type     TEXT        NOT NULL,                           -- 'seller' | 'agent'
  actor_id       TEXT,
  action         TEXT        NOT NULL,                           -- action type, e.g. 'price_set'
  before         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  after          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  result         TEXT        NOT NULL,                           -- applied|failed|skipped
  error_message  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CONSTRAINT catalog_bulk_audit_log_actor_type_check
    CHECK (actor_type IN ('seller', 'agent')),
  CONSTRAINT catalog_bulk_audit_log_result_check
    CHECK (result IN ('applied', 'failed', 'skipped'))
);

CREATE INDEX idx_catalog_bulk_audit_batch ON catalog_bulk_audit_log(batch_id);
CREATE INDEX idx_catalog_bulk_audit_created ON catalog_bulk_audit_log(created_at DESC);

-- ── RLS: ON, no policies ─────────────────────────────────────────────────────
-- Same pattern as platform_flags/platform_copy_overrides (the newest
-- precedent in this migration history, not the older supply_batches/
-- admin_audit_log tables these were otherwise modeled on) — this Supabase
-- project is SHARED across despachobonsai tenants, and these rows carry
-- seller-scoped product ids + before/after commerce values + mutation
-- intent. RLS ON with zero policies means the anon key gets zero rows from
-- any of these tables regardless of query; only the service-role client
-- (both apps' server-side `db`) can read/write. Ownership itself is still
-- enforced at the application layer (getBulkBatch's seller_id check) — this
-- is defense in depth on the shared-project boundary, not a replacement for
-- it (cross-agent review catch).
ALTER TABLE catalog_bulk_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_bulk_batch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_bulk_audit_log ENABLE ROW LEVEL SECURITY;
