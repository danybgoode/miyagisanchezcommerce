# Database

## Two databases — know which one to use

**Medusa Postgres** (`apps/backend`) — commerce data: products, vendors, carts, orders, payments, fulfillment, returns, subscriptions. Access via Medusa Store API or Admin API. Never query this directly from the frontend.

**Supabase** (`apps/miyagisanchez`) — non-commerce marketplace data that Medusa has no concept of. The tables below are ALL that should be in Supabase.

---

## Supabase client

```ts
import { db } from '@/lib/supabase'
// db = Supabase service-role client — bypasses RLS, safe for server-only code
// NEVER expose in client components or return to browser
// NEVER use for products, orders, payments, or fulfillment — those go through Medusa
```

---

## Supabase tables (non-commerce only)

### `marketplace_conversations`

One conversation per (buyer, vendor) pair. The persistent thread for offers, order tracking, and agent access.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `buyer_clerk_user_id` | TEXT | Clerk user ID |
| `vendor_id` | TEXT | Medusa vendor ID |
| `product_id` | TEXT | Medusa product ID |
| `offer_id` | UUID | FK → marketplace_offers (active offer) |
| `created_at` | TIMESTAMPTZ | |

### `marketplace_conversation_events`

Immutable event log for a conversation. `event_type` mirrors offer state machine + lifecycle.

| Column | Type | Notes |
|---|---|---|
| `conversation_id` | UUID | FK |
| `actor` | TEXT | `'buyer'|'seller'|'system'` |
| `event_type` | TEXT | `'message'|'offer'|'counter'|'accept'|'decline'|'order_placed'|'shipped'|...` |
| `metadata` | JSONB | Type-specific payload (amounts, tracking numbers, etc.) |

### `marketplace_offers`

Offer/negotiation state machine.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `product_id` | TEXT | Medusa product ID |
| `vendor_id` | TEXT | Medusa vendor ID |
| `buyer_clerk_user_id` | TEXT | |
| `amount_cents` | INT | Offered amount |
| `currency` | TEXT | Default 'MXN' |
| `status` | TEXT | `'pending'|'accepted'|'declined'|'countered'|'expired'` |
| `counter_amount_cents` | INT | If seller countered |
| `expires_at` | TIMESTAMPTZ | 72h default |

### `marketplace_favorites`

Buyer saved items. `price_cents_at_save` enables price-drop alerts.

| Column | Type | Notes |
|---|---|---|
| `buyer_clerk_user_id` | TEXT | |
| `product_id` | TEXT | Medusa product ID |
| `price_cents_at_save` | INT | |

### `supply_batches` + `supply_items`

Bulk import staging. Keeps scraped/CSV data isolated until admin review + Medusa publish.

| Table | Purpose |
|---|---|
| `supply_batches` | One batch per import run |
| `supply_items` | Individual rows, normalized and validated |

After review, supply items are published as Medusa products via `POST /api/supply/import` → calls Medusa Admin API to create products.

### `marketplace_scrape_runs` + `marketplace_scrape_run_items`

Admin scraper job tracking. Raw scraper output stored here before supply review.

### `ucp_buyer_identities`

OmniReputation trust scores. Keyed by buyer identifier (email, Clerk ID, or phone hash).

---

## Query patterns (Supabase only)

```ts
// Basic fetch
const { data } = await db
  .from('marketplace_conversations')
  .select('*, events:marketplace_conversation_events(*)')
  .eq('buyer_clerk_user_id', userId)
  .order('created_at', { ascending: false })

// Prefer .maybeSingle() over .single() to avoid throwing on not-found
const { data } = await db
  .from('marketplace_offers')
  .select('*')
  .eq('id', offerId)
  .maybeSingle()
```

---

## Migrations

Supabase migrations live in `supabase/migrations/`. Only add migrations for tables in the non-commerce list above. Never add migrations for products, orders, payments, or any concern Medusa handles.

Naming: `YYYYMMDDHHMMSS_description.sql`  
Never modify existing migration files — add new ones.
