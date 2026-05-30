# Payments

## ⚠️ All payment logic lives in the Medusa backend

Payment providers (Stripe Connect, MercadoPago) are Medusa payment provider modules in `apps/backend/src/modules/`. The frontend calls Medusa's cart/checkout flow; it does NOT contain payment logic.

**Do not add Stripe or MercadoPago API calls to the Next.js frontend.** If a payment concern arises, extend `apps/backend/src/modules/` as a Medusa payment provider.

---

## ⚠️ Real checkout flow (as of 2026-05-30) — READ THIS FIRST

The **live checkout path** is:
1. `CheckoutExperience.tsx` → `lib/cart.ts startCheckout()` → creates Medusa cart + line items
2. `POST /store/carts/:id/start-checkout` (Medusa backend, `src/api/store/carts/[id]/start-checkout/route.ts`)  
   — creates Stripe Checkout Session OR MP Preference  
   — creates Medusa PaymentCollection + PaymentSession  
   — links payment collection to cart (via `remoteLink`)  
   — stores Envia shipping quote in `cart.metadata`  
3. Buyer redirects to Stripe/MP hosted page  
4. On return: `POST /store/carts/:id/complete` (Medusa built-in) → creates Order  
5. Frontend webhook confirms + mirrors to Supabase + sends emails

**The legacy routes `/api/stripe/checkout` and `/api/mp/checkout` are DEAD CODE for one-time purchases.** They still exist (webhook legacy branches) but are no longer called by the PDP buy flow.

**Fulfillment** is stored in `order.metadata.fulfillment_method` + `metadata.shipment` (E-lite) and now also in native Medusa `Fulfillment` objects via `createOrderFulfillmentWorkflow` (E-full, wired post Section 3). Envia label creation happens in the frontend ship route (`/api/orders/[id]/ship`).

**SPEI / manual payments** are currently display-only (seller shows CLABE, buyer wires manually — NO order is created). Section 4 will replace this with a real Medusa `manual` payment provider creating a pending order.

---

## Auth heuristic — critical

| Flow | Auth required? | Why |
|---|---|---|
| One-time purchase (Stripe, MP) | ❌ Guest OK | Stripe Checkout / MP Checkout collects buyer email |
| Subscription checkout | ✅ Must be logged in | Buyer identity needed for lifecycle (cancel, portal, content access) |
| SPEI manual subscription | ✅ Optional but stored if available | Buyer provides email in SPEI form |

API routes enforce this:
- `/api/stripe/checkout` — calls `auth()`, no 401 guard
- `/api/stripe/subscription-checkout` — calls `currentUser()`, returns 401 if null
- `/api/mp/subscription-checkout` — calls `currentUser()`, returns 401 if null

Client side (`SubscriptionSection.tsx`) also short-circuits before hitting the API:
```ts
if (!isSignedIn) {
  window.location.href = `/sign-in?redirect_url=${encodeURIComponent(window.location.pathname)}`
  return
}
```

---

## Stripe Connect Express

Sellers connect via Express (not Standard). Platform takes 0% commission.

**Connect flow**:
1. `GET /api/stripe/connect` — creates Express account, generates `account_link`, redirects to Stripe
2. Stripe redirects to `GET /api/stripe/connect/return?account_id=...` on completion
3. Return handler calls `stripe.accounts.retrieve()`, saves `{ account_id, charges_enabled, onboarding_complete }` to `metadata.settings.stripe`
4. Incomplete: `GET /api/stripe/connect/refresh` regenerates the link

**Express Dashboard** (for seller to manage their account):
- `GET /api/stripe/connect/dashboard` — calls `stripe.accounts.createLoginLink(accountId)`, redirects seller
- ShopSettings "Gestionar →" link points here

**Seller has Stripe check**:
```ts
import { getShopStripe } from '@/lib/stripe'
const s = getShopStripe(shopMeta)  // reads metadata.settings.stripe
const sellerHasStripe = !!(s.charges_enabled && s.account_id && s.enabled !== false)
```

**Webhook** (`/api/webhooks/stripe`):
- `checkout.session.completed` → call `handleSubscriptionCheckoutComplete()` or record one-time sale
- `customer.subscription.updated/deleted` → update subscription status in DB
- Webhook secret: `STRIPE_WEBHOOK_SECRET`

---

## Stripe one-time checkout

Route: `POST /api/stripe/checkout`

```ts
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items: [{ quantity: 1, price_data: { currency: 'mxn', unit_amount: listing.price_cents, ... } }],
  payment_intent_data: {
    transfer_data: { destination: stripeSettings.account_id },  // zero-commission
    application_fee_amount: 0,
  },
  success_url: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${origin}/l/${listing.id}?payment=cancelled`,
  metadata: { listing_id, shop_id, buyer_clerk_id, listing_type },
})
```

---

<a name="subscriptions"></a>
## Stripe subscriptions

### Listing metadata storage

Multi-tier (Phase B) listings store tiers in `metadata.subscription_tiers`. Phase A single-tier uses `metadata.subscription`. Both are normalized to an array in `app/l/[id]/page.tsx` before passing to `SubscriptionSection`.

### Stripe Price IDs

When a seller creates a subscription listing via SellWizard, the create API (`/api/sell/create`) calls `stripe.prices.create()` for each tier and stores the `stripe_price_id` back into the tier metadata.

### Checkout

Route: `POST /api/stripe/subscription-checkout` (requires auth)

```ts
import { createSubscriptionCheckout } from '@/lib/stripe-subscriptions'

const url = await createSubscriptionCheckout({
  priceId,          // from tier.stripe_price_id
  successUrl: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}&type=subscription`,
  cancelUrl: `${origin}/l/${listing.id}?payment=cancelled`,
  buyerEmail,
  metadata: { listing_id, shop_id, listing_type: 'subscription', buyer_clerk_id, tier_id },
})
```

### Billing Portal

Route: `GET /api/stripe/billing-portal` — redirects buyer to Stripe Customer Portal to manage their subscription. Requires `stripe_customer_id` on the subscription record.

```ts
import { createBillingPortalSession } from '@/lib/stripe-subscriptions'
const url = await createBillingPortalSession(customerId, returnUrl)
```

---

## MercadoPago

### One-time checkout

Route: `POST /api/mp/checkout` — uses MP Checkout Pro (hosted page).  
Webhook: `POST /api/webhooks/mercadopago` — `payment.updated` topic.

### MercadoPago subscriptions (Preapproval)

MP doesn't natively support annual billing, so annual plans bill monthly at `price/12`.

**Two-step MP flow**:
1. Create a `PreApprovalPlan` (product definition, shareable across buyers)
2. Create a `PreApproval` per buyer (buyer-specific subscription instance)

Route: `POST /api/mp/subscription-checkout` (requires auth)

```ts
import { createMpPreapprovalPlan, createMpPreapproval } from '@/lib/mercadopago'

// Step 1 — idempotent, reuse stored planId if it exists in metadata
const { planId } = await createMpPreapprovalPlan({
  title: listing.title,
  priceCents: monthlyAmountCents,
  currency: 'MXN',
  frequency: 1,
  frequencyType: 'months',
})

// Step 2 — create per-buyer preapproval
const { preapprovalId, initPoint } = await createMpPreapproval({
  planId,
  buyerEmail,
  listingId: listing.id,
  shopId: listing.shop_id,
  tierId,
  origin,
  ...
})
// → redirect buyer to initPoint URL
```

Plan ID is persisted back to `listing.metadata` so future buyers reuse the same plan.

Webhook: `POST /api/webhooks/mercadopago` — handles `preapproval` topic, updates subscription status.

---

## SPEI (manual bank transfer)

Sellers configure a CLABE (18-digit interbank account number) in ShopSettings under `metadata.settings.checkout.bank_transfer`. Buyers submit their name + email and get the seller's CLABE to wire to.

Route: `POST /api/subscriptions/spei`  
Logic:
1. Validate `listingId`, `tierId`, `buyerName`, `buyerEmail`
2. Fetch shop's bank_transfer settings, verify CLABE is 18 digits
3. Insert subscription with `payment_method: 'spei'`, `status: 'pending_confirmation'`
4. Return `{ clabe, bank_name, account_holder, message }` to buyer

Seller confirms via `/shop/manage/subscriptions` → calls `POST /api/subscriptions/[id]` to set `status: 'active'`.

---

## Subscription cancel

Route: `DELETE /api/subscriptions/[id]/cancel` — cancels Stripe subscription at period end (`cancel_at_period_end: true`) or immediately for SPEI/MP. Updates DB status.

---

## Rate limiting

All checkout routes are rate-limited:

```ts
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'

const rl = await checkRateLimit('checkout', getClientIp(req))
if (!rl.allowed) {
  return NextResponse.json({ error: 'Demasiados intentos. Espera un momento.' },
    { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
}
```

Uses Upstash Redis. Key: `checkout:{ip}`. Limit: ~10 requests / minute.
