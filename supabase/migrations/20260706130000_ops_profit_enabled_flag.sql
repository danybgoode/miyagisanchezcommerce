-- profit-analyzer · Sprint 1 — seed the seller profit/margins enablement flag
-- into the in-house flag store (epic 09 · feature-flags-inhouse). Behavior-
-- preserving: seeds OFF (= DEFAULT_FLAGS in both apps' lib/flags.ts), so this
-- is a no-op until an admin deliberately flips it in /admin/flags after
-- Daniel's COGS → sale → margin-row smoke passes.
--
-- ops.profit_enabled gates the WHOLE profit surface in both apps: the
-- backend's financial-events ledger writes (order.placed subscriber, ML
-- post-materialize hook, ship-route shipping event) + the seller profit read
-- API, and the frontend's /shop/manage/profit page. OFF ⇒ nothing writes,
-- nothing renders; the ledger is append-only and POST /internal/profit/backfill
-- heals any flag-off gap, so a late flip loses nothing.
-- ON CONFLICT DO NOTHING so re-running never clobbers a live flip.
INSERT INTO platform_flags (key, enabled, polarity, description) VALUES
  ('ops.profit_enabled', false, 'enablement', 'Seller profit/margins dashboard + append-only financial-events ledger (profit-analyzer S1). OFF ⇒ no ledger writes, no profit UI.')
ON CONFLICT (key) DO NOTHING;
