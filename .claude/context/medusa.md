# Medusa Backend

## Overview

`apps/backend` is the Medusa v2 commerce engine. It owns all commerce concerns: products, vendors, cart, orders, payments, fulfillment, returns, subscriptions. The Next.js frontend is a pure consumer of its Store API.

**Medusa v2 version**: 2.15.3  
**Store API base**: `MEDUSA_STORE_URL/store` (default `http://localhost:9000/store`)  
**Admin API base**: `MEDUSA_STORE_URL/admin` (internal use only)  
**Dev command**: `cd apps/backend && npx medusa dev`

---

## Deployment (production)

| Service | URL | Notes |
|---|---|---|
| Medusa API (Render) | `https://miyagi-medusa-api.onrender.com` | Service ID: `srv-d8bh3b9kh4rs739fpe5g` |
| Database (Neon) | `DATABASE_URL` env var | Postgres, all migrations applied |
| Frontend (Vercel) | `https://miyagisanchez.com` | Auto-deploy from `main` |
| Backend repo | `https://github.com/danybgoode/medusa-bonsai-backend` | Separate repo, push triggers Render deploy |

**Seeded production data**:
- Publishable key: `pk_bac9...` (set in `MEDUSA_PUBLISHABLE_KEY` on Vercel)
- MXN region: `reg_01KSK1HZAWN5ZCSPZ74ER97HD9`
- Sales channel: `sc_01KSK1J0V81P4EPY9G0JAPX353`

**Stripe webhooks**:
- Frontend (`/api/webhooks/stripe`): handles `invoice.*`, `customer.subscription.*`, `payment_intent.*`
- Medusa backend (`/hooks/payment/pp_stripe-connect_stripe-connect`): handles `payment_intent.succeeded`, `charge.refunded`, `checkout.session.completed`

---

## Backend file structure

```
apps/backend/src/
├── modules/
│   ├── seller/            ← Custom multi-vendor seller module (NOT @medusajs/marketplace)
│   ├── auth-clerk/        ← Custom Clerk JWT auth provider
│   ├── subscriptions/     ← Custom subscription module (not native in Medusa v2)
│   ├── payment-stripe-connect/ ← Stripe Connect Express payment provider
│   └── payment-mercadopago/    ← MercadoPago Checkout Pro provider
├── api/
│   ├── store/             ← Custom store API extensions
│   │   ├── _utils/
│   │   │   ├── clerk-auth.ts   ← extractClerkUserId(), resolveSeller() — use these, never inline JWT decode
│   │   │   └── listing.ts      ← toListingShape(), toSellerShape() — canonical listing normalisation
│   │   ├── listings/      ← GET /store/listings, /store/listings/:id
│   │   ├── sellers/       ← GET /store/sellers/:slug, /store/sellers/:slug/products
│   │   ├── customers/     ← customer sync, order history
│   │   └── ...
│   └── admin/             ← Custom admin API extensions
├── workflows/             ← Medusa workflows (saga-style multi-step operations)
├── links/                 ← Module links (foreign keys between Medusa modules)
├── subscribers/           ← Event subscribers (webhooks, notifications)
└── jobs/                  ← Scheduled background jobs
medusa-config.ts           ← DB, CORS, plugins, modules config
```

---

## Installed plugins and modules

| Plugin / Module | Purpose |
|---|---|
| Custom `seller` module | Multi-vendor: sellers own products, have slugs, metadata |
| `@medusajs/payment-stripe` | Base Stripe; extended by custom Stripe Connect provider |
| Custom `payment-stripe-connect` | Stripe Connect Express for seller payouts |
| Custom `payment-mercadopago` | MP Checkout Pro + Preapproval (subscriptions) |
| Custom Envia.com fulfillment | Mexican shipping carrier integration |
| Custom `auth-clerk` module | Validates Clerk JWTs for customer identification |
| Custom `subscriptions` module | Recurring billing, tiers, content gating |

**Note**: This project uses a **custom seller module** at `src/modules/seller/`, NOT `@medusajs/marketplace`. The seller model is `model.define()` + `MedusaService()` with a Medusa link to Products.

---

## Medusa data model → marketplace concepts

| Marketplace concept | Medusa entity |
|---|---|
| Seller shop | Custom Seller model (seller module) |
| Listing (product/digital/service/rental) | Product + ProductType + metadata |
| Subscription listing | Product with subscription metadata + custom Subscriptions module |
| Price | ProductVariant + Price (with region MXN) |
| Purchase | Cart → Order flow |
| Order management | Order + Fulfillment |
| Shipping | Fulfillment via Envia.com provider |
| Return / refund request | Return (Medusa Returns module) |
| Payment | PaymentCollection → PaymentSession → Payment |

---

## Custom listing shape

All `/store/listings` endpoints return the `ListingShape` type (from `src/api/store/_utils/listing.ts`), NOT raw Medusa Product objects. This shape is also the `Listing` type in `lib/types.ts` on the frontend:

```ts
{
  id, shop_id, medusa_product_id, title, description,
  price_cents, currency, condition, listing_type, category,
  state, municipio, location, metadata, images, tags,
  status, views, created_at,
  shop: { id, slug, name, description, location, logo_url, clerk_user_id, verified, metadata, ... }
}
```

Key endpoints:
- `GET /store/listings` — full catalog with filters: `q`, `category`, `condition`, `state`, `location`, `min_price`, `max_price`, `sort`, `seller_slug`, `listing_type`, and autos/inmuebles-specific filters
- `GET /store/listings/:id` — single listing
- `GET /store/sellers/:slug` — seller profile
- `GET /store/sellers/:slug/products` — raw Medusa products for a seller

---

## Auth: Clerk + Medusa bridge

**How it works**:
1. User authenticates with Clerk on the frontend (normal Clerk flow)
2. Frontend gets Clerk JWT from `await currentUser()` / `useAuth()`
3. For Medusa Store API calls requiring auth (orders, account), frontend passes Clerk JWT as `Authorization: Bearer <clerk_jwt>`
4. Custom auth provider at `apps/backend/src/modules/auth-clerk/` validates the JWT against Clerk's JWKS endpoint
5. On first validated call, Medusa creates/syncs a Customer record keyed to the Clerk user ID
6. Medusa returns its own short-lived JWT for subsequent Store API calls

**Shared auth utils** (always use these, never inline JWT decode):
```ts
// src/api/store/_utils/clerk-auth.ts
extractClerkUserId(req)           // → string | null  (from Authorization: Bearer header)
resolveSeller(req)                // → { sellerId, sellerName } | null
```

---

## Store API usage patterns

```ts
import { medusa } from '@/lib/medusa'

// Listings (use /store/listings, NOT /store/products — it returns the enriched shape)
const res = await fetch(`${MEDUSA_STORE_URL}/store/listings?limit=20`, {
  headers: { 'x-publishable-api-key': MEDUSA_PUBLISHABLE_KEY }
})

// Cart + checkout
const { cart } = await medusa.store.cart.create({ region_id: MXN_REGION_ID })
await medusa.store.cart.addLineItem(cartId, { variant_id: variantId, quantity: 1 })
await medusa.store.cart.complete(cartId)  // → creates Order

// Orders (authenticated)
const { orders } = await medusa.store.order.list({}, { Authorization: `Bearer ${token}` })
```

---

## Adding a new Medusa module

```ts
// apps/backend/src/modules/my-module/index.ts
import { Module } from '@medusajs/framework/utils'
import MyModuleService from './service'
export const MY_MODULE = 'myModule'
export default Module(MY_MODULE, { service: MyModuleService })

// Register in medusa-config.ts
modules: [{ resolve: './src/modules/my-module' }]
```

---

## Adding a new payment provider

```ts
// apps/backend/src/modules/my-payment/index.ts
import { ModuleProvider, Modules } from '@medusajs/framework/utils'
export default ModuleProvider(Modules.PAYMENT, {
  services: [MyPaymentProviderService],  // extends AbstractPaymentProvider
})
```

---

## Webhooks

Two separate Stripe webhook endpoints:
- **Frontend** `POST /api/webhooks/stripe` — subscription lifecycle, invoice events
- **Medusa backend** `POST /hooks/payment/pp_stripe-connect_stripe-connect` — payment intents, refunds, checkout sessions

MercadoPago webhooks: `POST /api/webhooks/mercadopago` (frontend) and Medusa's built-in MP provider handler.

---

## Medusa Admin Dashboard

**Current status: disabled in production** (Render free plan memory constraints).

**Why it's disabled**: `medusa-config.ts` has `admin: { disable: process.env.NODE_ENV === 'production' }`. The admin bundle requires ~512MB RAM at build time and adds overhead at runtime — the free Render plan (0.1 CPU / 512MB) can't support it reliably.

**How to access the admin**:

Option A — Local (free, works today):
```bash
cd apps/backend
# .env already points at production Neon DB
npx medusa dev   # admin available at http://localhost:9000/app
```
This gives you full admin access (orders, products, sellers, inventory) against the live production database.

Option B — Re-enable on Render (upgrade required):
1. Upgrade Render to Hobby plan ($7/mo) or Standard ($25/mo)
2. In `medusa-config.ts`, change to `admin: { disable: false }` or remove the condition
3. Push to backend repo → Render rebuilds + serves admin at `https://miyagi-medusa-api.onrender.com/app`

**Recommendation**: Use Option A for now. As the marketplace grows and Render gets upgraded, switch to Option B. The admin is the right tool for marketplace management — do not build custom UIs for order/product/seller management.
