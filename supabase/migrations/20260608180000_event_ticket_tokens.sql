-- Events & Ticketing S3 — free RSVP ticket token lookup.
--
-- Ticket state lives on marketplace_event_registrations.metadata.ticket.
-- This index keeps door scans fast and prevents a duplicate free-ticket token
-- from ever being accepted if a random collision happens.

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_event_registrations_ticket_token_uidx
  ON marketplace_event_registrations ((metadata->'ticket'->>'token'))
  WHERE metadata->'ticket'->>'token' IS NOT NULL;
