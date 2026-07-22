-- Golden Beans event-destination-router · Story 3.1 — turn the emit-side claim table
-- into a real OUTBOX. Additive; apply BY HAND before merging.
--
-- WHY (cross-agent review, Codex, PR 298 — two findings, one root cause):
--
-- The first design claimed a (merchant_id, event_type) slot, sent, and DELETED the
-- claim if the send failed. Two holes:
--
--   1. An AMBIGUOUS failure is indistinguishable from a real one. If Golden Beans
--      accepted the event but the response timed out, we released the claim and a later
--      call sent a SECOND event with a new canonical id — double-counting the funnel.
--   2. If the release DELETE itself failed, the claim survived a genuinely failed send,
--      and the milestone was burned forever: every future attempt read "already emitted"
--      while Golden Beans had never received anything.
--
-- The fix is to stop deleting. The claim is now permanent and carries its own delivery
-- state, so a failed send stays PENDING and is retried by the daily sweep. Retrying is
-- safe because the payload is stored and replayed VERBATIM under a stable
-- `context.idempotencyKey`: Golden Beans enforces UNIQUE (project_id, idempotency_key)
-- and returns the existing event, so an ambiguous send resolves to the same canonical
-- event and therefore the same single milestone.
--
-- Golden Beans also FINGERPRINTS the payload when an idempotency key is present and
-- rejects a mismatch — which is exactly why the payload is persisted rather than
-- rebuilt. A rebuild would carry a fresh `occurredAt` and be refused as a conflicting
-- reuse of the key.

ALTER TABLE merchant_lifecycle_emissions
  -- The exact bytes to send. Built once at claim time and replayed unchanged.
  ADD COLUMN IF NOT EXISTS payload      JSONB,
  -- NULL = still owed. This, not the row's existence, is what "already emitted" means.
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempts     INTEGER NOT NULL DEFAULT 0,
  -- Last failure, for an operator looking at a milestone that never arrived.
  ADD COLUMN IF NOT EXISTS last_error   TEXT,
  ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT now();

-- The sweep's drain query: everything still owed, oldest first. Partial index, because
-- the pending set is tiny and permanently so while the delivered set only grows.
CREATE INDEX IF NOT EXISTS merchant_lifecycle_emissions_pending_idx
  ON merchant_lifecycle_emissions (emitted_at)
  WHERE delivered_at IS NULL;

-- Rows written before this migration were claimed under the old delete-on-failure
-- scheme, so their existence already meant "sent successfully" — the failure path
-- removed them. Marking them delivered preserves that meaning; leaving them NULL would
-- make the new drain re-send every historical milestone with no payload to send.
UPDATE merchant_lifecycle_emissions
   SET delivered_at = emitted_at
 WHERE delivered_at IS NULL
   AND payload IS NULL;
