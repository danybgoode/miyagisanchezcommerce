# Seller portal

## ⚠️ Product and order data comes from Medusa

The seller portal UI reads and writes through the Medusa Store/Admin API. Products are Medusa products. Orders are Medusa orders. The seller is a Medusa vendor (marketplace plugin). Do not read/write `marketplace_listings` or `marketplace_orders` Supabase tables for any seller portal feature.

---

## /sell — listing creation (SellWizard)

File: `app/sell/SellWizard.tsx` — client component, multi-step wizard.

**Steps**: Category → Basic info → Type-specific fields → Pricing → Payment settings → Publish

**Listing types** the wizard supports:
- `product` — physical goods
- `digital` — downloadable files (PDF, ZIP, MP4, etc.)
- `service` — services with optional Cal.com booking
- `rental` — rentals (hourly/daily/weekly)
- `subscription` — recurring subscriptions with up to 3 tiers

**Subscription tiers state** (Phase B):
```ts
const [subTiers, setSubTiers] = useState<SubTier[]>([
  { id: uuid(), label: '', price_cents: 0, interval: 'month', features: [], is_highlighted: false }
])
// Max 3 tiers. Stripe Price ID is created server-side on submit.
```

**Create API**: `POST /api/sell/create`
- Validates all fields
- For `listing_type === 'subscription'`: calls `stripe.prices.create()` per tier if Stripe is connected, stores `stripe_price_id` in tier metadata
- Inserts into `marketplace_listings` with `status: 'active'`
- Fires `tg.newListing()` notification
- Returns `{ id: listingId }`

**Edit**: `app/sell/edit/[id]/page.tsx` + `SellWizard` with `mode="edit"` — same wizard, pre-populated.

---

## /shop/manage — seller dashboard

Protected by Clerk middleware (`/shop/manage/.*`).

| Page | File | Purpose |
|---|---|---|
| `/shop/manage` | `page.tsx` | Hub — links to all seller sections |
| `/shop/manage/settings` | `settings/page.tsx` + `ShopSettings.tsx` | Shop profile, payment methods, theme |
| `/shop/manage/analytics` | `analytics/page.tsx` | MRR/ARR charts, subscription metrics |
| `/shop/manage/subscriptions` | `subscriptions/page.tsx` | Subscriber list, SPEI confirmation |
| `/shop/manage/content` | `content/page.tsx` | Gated content upload |
| `/shop/manage/offers` | `offers/page.tsx` | Incoming offer inbox |

---

## ShopSettings

File: `app/shop/manage/settings/ShopSettings.tsx` — large client component.  
Server wrapper: `app/shop/manage/settings/page.tsx` — reads shop from DB, passes `initial` + `stripeError`.

**Save endpoint**: `PATCH /api/sell/shop` — deep-merges `settings` JSONB, updates `mp_enabled`, `stripe_enabled`, etc.

**Sections**:
1. Perfil — name, description, location, logo
2. Preset profiles — quick-apply checkout/shipping configs
3. Apariencia — banner, accent color, tagline, social links
4. Checkout — escrow mode, show_phone, WhatsApp CTA
5. Envíos — Mercado Envíos, local pickup
6. SPEI (bank transfer) — CLABE, bank name, account holder
7. Pagos en línea (Stripe) — connect flow + enable/disable toggle
8. MercadoPago — enable/disable toggle
9. Cal.com scheduling — API-connect tier + link-drop tier
10. Notificaciones — email preferences
11. Negociación / Ofertas — trust gate, auto-rules
12. Webhooks (UCP) — webhook URL + secret

**Adding a new toggle** (pattern):
```ts
// 1. Add to ShopSettingsData interface
stripe_new_feature?: boolean

// 2. Add useState
const [newFeature, setNewFeature] = useState(initial.stripe_new_feature ?? false)

// 3. Include in handleSave body
new_feature: newFeature,

// 4. Handle in /api/sell/shop PATCH route
if (body.new_feature !== undefined) updates.new_feature = body.new_feature

// 5. Use ToggleSwitch component
<ToggleSwitch checked={newFeature} onChange={setNewFeature} label="..." description="..." />
```

---

## Shop storefront (/s/[slug])

File: `app/s/[slug]/page.tsx`

Shows:
- Shop profile (logo, name, description, location)
- Active listings grid
- Theme customization (accent color, banner, social links)

**Claim flow**: `app/s/[slug]/claim/page.tsx` — generates a JWT claim token, sends email, seller clicks link to verify ownership. `app/api/claim/send/route.ts` + `lib/claimJwt.ts`.

---

## Listing detail page (/l/[id])

File: `app/l/[id]/page.tsx` — server component.  
Key logic:
- Fetches listing + shop with `getListing(id)` (ISR-cached, 60s)
- Fetches `clerkUser` for auth state
- Resolves payment options: `sellerHasStripe`, `sellerHasMp`, `hasClabe`
- Normalizes subscription tiers (Phase A/B → unified array)
- Passes `isSignedIn={!!clerkUser}` to `SubscriptionSection`

**Buy button routing**:
- `listing_type === 'digital'` → `<BuyButton>` (Stripe only, digital flag)
- `listing_type === 'subscription'` → `<SubscriptionSection>` (Stripe + MP + SPEI)
- `listing_type === 'product'|'service'|'rental'` → `<MercadoPagoButton>` + `<BuyButton>` + `<MakeOfferButton>`

---

## Content library (/shop/manage/content)

Sellers upload gated content (images, PDFs, videos) that active subscribers can access.

**Upload flow**:
1. `POST /api/sell/digital-upload` — uploads file to R2 private bucket, returns storage key
2. `POST /api/sell/content` — creates `marketplace_subscription_content` row with `file_url` (key or public URL)

**Buyer access** (`/account/subscriptions`):
- Verifies buyer has an active subscription for the shop
- Fetches published content items
- Presigned URLs generated on demand via `/api/sell/listing/[id]/download`

---

## Analytics (/shop/manage/analytics)

Shows subscription revenue metrics for the seller's shop:
- MRR (monthly recurring revenue)
- ARR (annual recurring revenue)  
- Active subscriber count by tier
- Revenue breakdown by payment method

Data source: `marketplace_subscriptions` filtered by `shop_id` and `status = 'active'`.

---

## Payment success page (/payment/success)

`app/payment/success/page.tsx` — handles post-checkout redirect for both Stripe and MP.

Reads `session_id` and `type` from query params:
- `type=subscription` → show subscription confirmation message
- Otherwise → show purchase confirmation + digital download link if applicable

For Stripe: calls `stripe.checkout.sessions.retrieve(session_id)` to get order details.
