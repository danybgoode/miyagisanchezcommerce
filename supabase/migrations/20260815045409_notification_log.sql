-- notification_log — a durable record of every outbound notification.
--
-- WHY: on 2026-08-15 an audit of one order had to reconstruct "who was told what"
-- from Cloud Run access logs, because nothing recorded it. The Resend API key in
-- production is send-only (reads 401), so even the provider's own log was closed.
-- Four separate delivery failures had been silent for weeks; none was discoverable
-- after the fact.
--
-- This is written at the three real TRANSPORTS (lib/email.ts `sendWithResult`,
-- lib/notify.ts `notify`, lib/telegram.ts `tgSend`) rather than at each of the ~65
-- senders, so a new sender is covered for free and none can forget.
--
-- It records SKIPS and FAILURES, not just sends. "We never tried" and "we tried and
-- it bounced" are different facts, and collapsing them into an absent row would
-- reproduce exactly the ambiguity this table exists to remove.

create table if not exists public.notification_log (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),

  channel      text not null check (channel in ('email', 'push', 'telegram')),

  -- The address actually used: an email, a Telegram chat id, or the Clerk id whose
  -- push subscriptions were targeted. Null only when there was nobody to address.
  recipient    text,
  -- The person, when known. Email sends to a guest have a recipient and no id.
  clerk_user_id text,

  -- Email subject / push title. The human-readable "which notification was this".
  subject      text,

  outcome      text not null check (outcome in ('sent', 'skipped', 'failed')),
  -- Why, when outcome is not 'sent': 'unconfigured', 'rejected', 'too_soon',
  -- 'no_subscription', 'not_linked', 'channel_off', 'no_recipient', …
  reason       text,

  -- The provider's own id (Resend message id), when it gave one back.
  provider_id  text,

  -- Anything else worth keeping: event group, conversation/order id, error detail.
  context      jsonb
);

create index if not exists notification_log_created_at_idx
  on public.notification_log (created_at desc);

create index if not exists notification_log_clerk_user_idx
  on public.notification_log (clerk_user_id, created_at desc)
  where clerk_user_id is not null;

create index if not exists notification_log_recipient_idx
  on public.notification_log (recipient, created_at desc)
  where recipient is not null;

-- Service-role only: every write comes from a server route, and nothing in the
-- browser has any business reading who was emailed what.
alter table public.notification_log enable row level security;
