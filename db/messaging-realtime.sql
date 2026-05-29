-- Messaging realtime hardening — applied via: supabase db query -f db/messaging-realtime.sql --linked
-- Idempotent. See tasks/messaging-realtime.md (Phase 0.4, 0.5, 2.4).
-- Browser gets READ-ONLY realtime via anon key + Clerk JWT (role=authenticated, sub=clerk user id).
-- All WRITES stay server-side via the service-role client (which bypasses RLS).

-- ── RLS + read-only participant policies ────────────────────────────────────
alter table marketplace_conversations        enable row level security;
alter table marketplace_conversation_events  enable row level security;

drop policy if exists "participant reads conversation" on marketplace_conversations;
create policy "participant reads conversation"
  on marketplace_conversations for select to authenticated
  using ( auth.jwt()->>'sub' in (buyer_clerk_user_id, seller_clerk_user_id) );

drop policy if exists "participant reads events" on marketplace_conversation_events;
create policy "participant reads events"
  on marketplace_conversation_events for select to authenticated
  using ( exists (
    select 1 from marketplace_conversations c
    where c.id = marketplace_conversation_events.conversation_id
      and auth.jwt()->>'sub' in (c.buyer_clerk_user_id, c.seller_clerk_user_id)
  ) );

-- ── Realtime publication + replica identity (for UPDATE payloads e.g. unread) ─
alter table marketplace_conversations replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='marketplace_conversation_events') then
    execute 'alter publication supabase_realtime add table marketplace_conversation_events';
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname='supabase_realtime' and tablename='marketplace_conversations') then
    execute 'alter publication supabase_realtime add table marketplace_conversations';
  end if;
end $$;

-- ── Web push subscriptions (server-only: RLS on, no authenticated policies) ───
create table if not exists push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  ua           text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_push_subscriptions_user on push_subscriptions(clerk_user_id);
alter table push_subscriptions enable row level security;
