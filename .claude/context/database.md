# Database

## Client

```ts
import { db } from '@/lib/supabase'
// db = Supabase service-role client — bypasses RLS, safe for server-only code
// NEVER expose in client components or return to browser
```

## Core tables

### `marketplace_shops`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `clerk_user_id` | TEXT | Clerk user ID; `pending:xxx` = unclaimed |
| `slug` | TEXT | URL slug (`/s/[slug]`) |
| `name`, `description`, `location` | TEXT | |
| `logo_url` | TEXT | R2 or Supabase Storage URL |
| `mp_enabled` | BOOLEAN | Show MercadoPago buttons (default true) |
| `metadata` | JSONB | See shape below |
| `calcom_api_key` | TEXT | Cal.com API key (encrypted) |
| `ucp_webhook_url` | TEXT | Seller's order webhook URL |
| `ucp_webhook_secret` | TEXT | HMAC secret for webhook signing |

**`metadata` JSONB shape**:
```ts
{
  settings: {
    stripe: {
      account_id: string          // Stripe Connect Express account
      charges_enabled: boolean    // true once onboarding complete
      onboarding_complete: boolean
      enabled: boolean            // seller toggle (default true)
    }
    checkout: {
      escrow_mode: 'off' | 'optional' | 'required'
      show_phone: boolean
      whatsapp_cta: boolean
      bank_transfer: {
        enabled: boolean
        clabe: string             // 18-digit CLABE (SPEI)
        bank_name: string
        account_holder: string
      }
    }
    shipping: { mercado_envios: boolean, local_pickup: boolean }
    notifications: { email_new_view: boolean, email_new_message: boolean }
    offers: {
      min_buyer_trust_level: 'unverified'|'basic'|'trusted'|'verified'|'elite'
      negotiation: { enabled: boolean, auto_accept_pct: number, auto_decline_pct: number }
    }
    theme: { banner_url, accent_color, tagline, social: { instagram, facebook, whatsapp, tiktok } }
    calcom: { connected: boolean, username, booking_url, event_type_title }
    scheduling: { links: Array<{ label, url }> }
  }
}
```

**Get Stripe settings**:
```ts
import { getShopStripe } from '@/lib/stripe'
const stripeSettings = getShopStripe(shop.metadata)
// → { account_id?, charges_enabled?, onboarding_complete?, enabled? }
```

---

### `marketplace_listings`

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `shop_id` | UUID | FK → marketplace_shops |
| `title`, `description` | TEXT | |
| `price_cents` | INT | All prices in cents (MXN default) |
| `currency` | TEXT | Default 'MXN' |
| `listing_type` | TEXT | `'product'|'digital'|'subscription'|'service'|'rental'` |
| `category` | TEXT | `'general'|'autos'|'inmuebles'|…` |
| `status` | TEXT | `'active'|'draft'|'sold'|'expired'` |
| `images` | JSONB | `Array<{ url: string, alt?: string }>` |
| `tags` | TEXT[] | |
| `views` | INT | Incremented on page load |
| `metadata` | JSONB | See shapes below |

**`metadata` JSONB shapes by listing_type**:
```ts
// listing_type === 'digital'
{
  digital_file: { key: string, name: string, size: number, label: string }
}

// listing_type === 'subscription' (Phase B multi-tier)
{
  subscription_tiers: Array<{
    id: string            // uuid
    label: string         // "Plan Básico"
    price_cents: number
    interval: 'month' | 'year'
    features: string[]
    is_highlighted: boolean
    stripe_price_id?: string     // set when Stripe Price is created
    mp_preapproval_plan_id?: string  // set when MP plan is created
  }>
}

// listing_type === 'subscription' (Phase A single-tier legacy)
{
  subscription: {
    interval: 'month' | 'year'
    content_description: string
    stripe_price_id?: string
    mp_preapproval_plan_id?: string
  }
}

// listing_type === 'service' / 'rental' / 'product'
{
  phone?: string
  repuve?: { status: string, folio: string, verified_at: string }  // autos only
  brand?, year?, km?, transmission?, fuel?  // autos metadata
  rooms?, bathrooms?, area?, land_area?     // inmuebles metadata
}
```

---

### `marketplace_subscriptions`

Buyer subscription records — created on checkout, updated by webhooks.

| Column | Type | Notes |
|---|---|---|
| `listing_id` | UUID | FK |
| `shop_id` | UUID | FK |
| `buyer_clerk_user_id` | TEXT | Clerk user ID |
| `buyer_email` | TEXT | lowercased |
| `payment_method` | TEXT | `'stripe'|'spei'|'mercadopago'` |
| `status` | TEXT | `'active'|'canceled'|'past_due'|'pending_confirmation'|'trialing'|'pending_authorization'` |
| `stripe_subscription_id` | TEXT | Unique |
| `stripe_customer_id` | TEXT | |
| `mp_preapproval_id` | TEXT | |
| `tier_id` | TEXT | Tier ID from listing metadata |
| `metadata` | JSONB | Extra data (SPEI notes, tier info) |

---

### `marketplace_subscription_content`

Gated content posts by sellers.

| Column | Type | Notes |
|---|---|---|
| `shop_id` | UUID | FK |
| `listing_id` | UUID | null = visible to all shop subscribers |
| `title` | TEXT | |
| `body` | TEXT | Markdown |
| `file_url` | TEXT | R2 URL or presigned URL |
| `file_type` | TEXT | `'image'|'video'|'document'|'audio'` |
| `is_published` | BOOLEAN | |

---

### Other tables

| Table | Purpose |
|---|---|
| `marketplace_offers` | Make-an-offer flow; status: `pending\|accepted\|declined\|countered\|expired` |
| `marketplace_scrape_runs` | Admin scraper job tracking |
| `marketplace_scrape_run_items` | Individual scraped items per run |
| `supply_batches` + `supply_items` | Bulk import pipeline |
| `ucp_buyer_identities` | OmniReputation / trust score storage |

---

## Query patterns

```ts
// Basic fetch with join
const { data: listing } = await db
  .from('marketplace_listings')
  .select('*, shop:marketplace_shops!inner(id, name, metadata, clerk_user_id)')
  .eq('id', listingId)
  .eq('status', 'active')
  .maybeSingle()  // ← prefer over .single() to avoid throwing on not-found

// Update with metadata merge (don't overwrite — spread existing meta)
const { data: shop } = await db.from('marketplace_shops').select('metadata').eq('id', shopId).single()
const existingMeta = (shop.metadata ?? {}) as Record<string, unknown>
await db.from('marketplace_shops').update({
  metadata: { ...existingMeta, settings: { ...(existingMeta.settings as object), stripe: { ... } } }
}).eq('id', shopId)

// JSONB field filter
await db.from('marketplace_listings')
  .select('*')
  .eq('metadata->>payment_method', 'stripe')  // string comparison
  .gte('metadata->>price', '5000')             // numeric needs .gte on text

// ISR-cached query (use unstable_cache for listings read by buyers)
import { unstable_cache } from 'next/cache'
const cached = unstable_cache(async (id) => { ... }, ['listing', id], { revalidate: 60, tags: [`listing:${id}`] })
```

---

## Migrations

All migrations live in `supabase/migrations/`. Naming convention:
```
20260522300000_subscriptions.sql
YYYYMMDDHHMMSS_description.sql
```

Run locally: `npx supabase db push` (or apply manually in Supabase dashboard SQL editor).  
Never modify existing migration files — add new ones.

Latest migrations:
- `20260522300000_subscriptions.sql` — marketplace_subscriptions + marketplace_subscription_content
- `20260522500000_subscriptions_phase_b.sql` — tier_id, mp columns, indexes
- `20260523000000_subscription_listing_type.sql` — subscription listing_type constraint
