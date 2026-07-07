-- Custom print products — Sprint 4, Story 4.1: lightweight proof via messaging.
--
-- Two additions:
--  1. Two new conversation event types so a seller's proof photo + a buyer's
--     approval ride the existing immutable event log like every other
--     conversation moment (offers, stamps, shipment).
--  2. `marketplace_conversations.medusa_order_id` — a buy-now (non-negotiated)
--     purchase creates NO offer at all, so the existing `offer_id` chain that
--     `resolveConversationLedger` uses to find the linked order never resolves
--     for the common configurator case. This column lets a conversation be
--     linked directly to the real Medusa order that started it, independent
--     of whether a negotiation ever happened.

ALTER TABLE marketplace_conversation_events
  DROP CONSTRAINT marketplace_conversation_events_event_type_check;

ALTER TABLE marketplace_conversation_events
  ADD CONSTRAINT marketplace_conversation_events_event_type_check
  CHECK (event_type IN (
    'offer_sent', 'offer_countered', 'offer_accepted', 'offer_declined',
    'offer_withdrawn', 'offer_expired',
    'purchase_complete', 'shipped', 'delivered', 'feedback_left',
    'stamp_sent',
    'proof_sent', 'proof_approved'
  ));

ALTER TABLE marketplace_conversations
  ADD COLUMN IF NOT EXISTS medusa_order_id TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_medusa_order
  ON marketplace_conversations(medusa_order_id);
