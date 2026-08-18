-- shop_wall_entries — the merchant-authored Wall: the own-shop homepage narrative.
--
-- APPLIED 2026-08-18 by the orchestrator via the Supabase MCP `apply_migration`,
-- recorded as version 20260818222814 — and this FILE was renamed to that version
-- so the local name and the remote record agree (the MCP stamps its own
-- timestamp; aligning the filename is cheaper and safer than rewriting a row in
-- `supabase_migrations.schema_migrations`, and it keeps the recorded instant
-- truthful about when the DDL actually ran).
--
-- Verified live the same session: every CHECK above was made to REFUSE the thing
-- it forbids (post-with-reference, product-without-reference, empty post,
-- scheduled-without-instant, second pin) inside a transaction that then aborted
-- on purpose, so the table came back empty. A constraint nobody has seen refuse
-- anything is not known to constrain anything.
--
-- Never `supabase db push` — local files are unrecorded remotely, so a push would
-- replay every one of them.
--
-- WHY A DEDICATED TABLE AND NOT `metadata.settings`: settings is presentation
-- config a seller edits as a whole; this is a growing list of authored rows with
-- their own publication lifecycle, ordering and per-row references. Living in
-- settings it would have no index, no constraint and no cheap public read.
--
-- WHY IT STORES A REFERENCE AND NEVER A COPY (epic D3): a Wall card for a product
-- shows price, availability and title. Those live in Medusa and change without
-- this table knowing. A snapshot here would be a stale ghost that still looks
-- buyable — so `reference_id` is all we keep, and the public read re-resolves the
-- canonical object every time. The same rule covers collections and events.
--
-- WHY THE CONSTRAINTS ARE STRICT FROM BIRTH (epic D1): the table is new and empty.
-- A CHECK that is free to add today costs a backfill and a grandfather clause the
-- moment one row exists, and that window closes the first time a seller posts.

create table if not exists public.shop_wall_entries (
  id            uuid primary key default gen_random_uuid(),

  -- Cascade: a deleted shop's Wall is meaningless, and leaving orphans would let a
  -- future slug reuse inherit somebody else's posts.
  shop_id       uuid not null references public.marketplace_shops(id) on delete cascade,

  kind          text not null check (kind in ('post', 'product', 'collection', 'event')),
  status        text not null default 'draft' check (status in ('draft', 'published', 'scheduled')),

  -- Post body. Bounded here as well as in the route: the route is one write path
  -- and the table is the last one.
  body          text check (body is null or char_length(body) <= 2000),

  -- Uploaded media: [{ url, alt }]. Bounded and platform-issued (epic D10 — the
  -- seller upload route, never an arbitrary remote fetch).
  media         jsonb not null default '[]'::jsonb check (jsonb_typeof(media) = 'array' and jsonb_array_length(media) <= 4),

  -- The canonical object this entry points at: a Medusa product id, a collection
  -- handle, or a marketplace_events slug. Deliberately `text` — the three id
  -- spaces have different shapes and none of them is a uuid in every case.
  reference_id  text,

  -- The grammar, enforced by the database rather than by a comment: a post never
  -- carries a reference, and the other three kinds are meaningless without one.
  constraint shop_wall_entries_reference_matches_kind check (
    (kind = 'post' and reference_id is null)
    or (kind <> 'post' and reference_id is not null and char_length(reference_id) between 1 and 255)
  ),

  -- A post with neither body nor media is an empty card. Referenced kinds may be
  -- bodyless — the object itself is the content.
  constraint shop_wall_entries_post_has_content check (
    kind <> 'post'
    or (coalesce(char_length(btrim(body)), 0) > 0 or jsonb_array_length(media) > 0)
  ),

  published_at  timestamptz,
  -- Timezone-aware by type. A `datetime-local` string plus server-local parsing is
  -- the ambiguity the scope names by hand; timestamptz removes it structurally.
  scheduled_for timestamptz,

  -- The scheduled state is only meaningful with an instant to become public at,
  -- and only the scheduled state may carry one.
  constraint shop_wall_entries_schedule_matches_status check (
    (status = 'scheduled' and scheduled_for is not null)
    or (status <> 'scheduled' and scheduled_for is null)
  ),
  constraint shop_wall_entries_published_has_instant check (
    status <> 'published' or published_at is not null
  ),

  pinned        boolean not null default false,

  -- Clerk user id of the author. Text, like every other Clerk reference here.
  created_by    text not null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Exactly one pinned entry per shop, and only a publicly-destined one may hold the
-- pin — pinning a draft would reserve the slot invisibly.
create unique index if not exists shop_wall_entries_one_pin_per_shop
  on public.shop_wall_entries (shop_id)
  where pinned and status in ('published', 'scheduled');

-- The public read: one shop, newest-first by effective instant. `coalesce` is not
-- indexable as an expression over two columns without this exact form, so the
-- read orders by the same expression this index materializes.
create index if not exists shop_wall_entries_public_read_idx
  on public.shop_wall_entries (shop_id, coalesce(published_at, scheduled_for) desc)
  where status in ('published', 'scheduled');

-- The seller's own management list: every status, newest edit first.
create index if not exists shop_wall_entries_seller_list_idx
  on public.shop_wall_entries (shop_id, created_at desc);

-- Reverse lookup for edge-state handling (S7.5): "which entries point at the
-- product that just got unpublished".
create index if not exists shop_wall_entries_reference_idx
  on public.shop_wall_entries (reference_id)
  where reference_id is not null;

-- Defence in depth, and explicitly NOT the ownership boundary (epic D2). This app
-- reaches Supabase through one service-role client, which bypasses RLS entirely —
-- so the real control is that every write resolves shop_id from the Clerk session
-- server-side and never from the request body. Enabling RLS with no policy means a
-- future anon/authed client cannot reach this table by accident.
alter table public.shop_wall_entries enable row level security;
