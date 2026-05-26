# Medusa Backend

## Overview

`apps/backend` is the Medusa v2 commerce engine. It owns all commerce concerns: products, vendors, cart, orders, payments, fulfillment, returns, subscriptions. The Next.js frontend is a pure consumer of its Store API.

**Medusa v2 version**: 2.15.2  
**Store API base**: `MEDUSA_STORE_URL/store` (default `http://localhost:9000/store`)  
**Admin API base**: `MEDUSA_STORE_URL/admin` (internal use only)  
**Dev command**: `cd apps/backend && npx medusa dev`

---

## Backend file structure

```
apps/backend/src/
├── modules/
│   ├── auth-clerk/        ← Custom Clerk JWT auth provider
│   ├── subscriptions/     ← Custom subscription module (not native in Medusa v2)
│   └── envia/             ← Envia.com fulfillment provider
├── api/
│   ├── store/             ← Custom store API extensions (beyond built-in Store API)
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
| `@medusajs/marketplace` | Multi-vendor: sellers become vendors with isolated products/orders |
| `@medusajs/payment-stripe` | Stripe Connect Express for seller payouts |
| MercadoPago provider (custom) | MP Checkout Pro + Preapproval (subscriptions) |
| SPEI provider (custom) | Manual bank transfer via CLABE |
| Envia.com fulfillment (custom) | Mexican shipping carrier integration |
| Clerk auth provider (custom) | Validates Clerk JWTs for customer identification |
| Subscriptions module (custom) | Recurring billing, tiers, content gating |

---

## Medusa data model → marketplace concepts

| Marketplace concept | Medusa entity |
|---|---|
| Seller shop | Vendor (marketplace plugin) |
| Listing (product/digital/service/rental) | Product + ProductType + metadata |
| Subscription listing | Product with subscription metadata + custom Subscriptions module |
| Price | ProductVariant + Price (with region MXN) |
| Purchase | Cart → Order flow |
| Order management | Order + Fulfillment |
| Shipping | Fulfillment via Envia.com provider |
| Return / refund request | Return (Medusa Returns module) |
| Payment | PaymentCollection → PaymentSession → Payment |

---

## Auth: Clerk + Medusa bridge

**How it works**:
1. User authenticates with Clerk on the frontend (normal Clerk flow)
2. Frontend gets Clerk JWT from `await currentUser()` / `useAuth()`
3. For Medusa Store API calls requiring auth (orders, account), frontend passes Clerk JWT as `Authorization: Bearer <clerk_jwt>`
4. Custom auth provider at `apps/backend/src/modules/auth-clerk/` validates the JWT against Clerk's JWKS endpoint
5. On first validated call, Medusa creates/syncs a Customer record keyed to the Clerk user ID
6. Medusa returns its own short-lived JWT for subsequent Store API calls

**Frontend helper** (in `lib/medusa.ts`):
```ts
// Authenticated Store API call
await medusa.store.order.list({}, { Authorization: `Bearer ${clerkToken}` })
```

---

## Store API usage patterns

```ts
import { medusa } from '@/lib/medusa'

// Products (listings)
const { products } = await medusa.store.product.list({ limit: 20, region_id: MXN_REGION_ID })
const { product } = await medusa.store.product.retrieve(productId)

// Cart + checkout
const { cart } = await medusa.store.cart.create({ region_id: MXN_REGION_ID })
await medusa.store.cart.addLineItem(cartId, { variant_id: variantId, quantity: 1 })
await medusa.store.cart.complete(cartId)  // → creates Order

// Orders (authenticated)
const { orders } = await medusa.store.order.list({}, { Authorization: `Bearer ${token}` })

// Vendor (shop) storefront
const { products } = await medusa.store.product.list({ vendor_id: vendorId })
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

## Adding a new fulfillment provider

```ts
// apps/backend/src/modules/envia/index.ts
import { ModuleProvider, Modules } from '@medusajs/framework/utils'
export default ModuleProvider(Modules.FULFILLMENT, {
  services: [EnviaFulfillmentService],  // extends AbstractFulfillmentProviderService
})
```

---

## Webhooks

Stripe and MercadoPago webhooks are handled **inside Medusa** (the payment providers fire internal events). The frontend does NOT have webhook routes for payments — those are in `apps/backend/src/subscribers/`.

The frontend only has:
- `POST /api/webhooks/envia` — shipping status updates from Envia.com (forwards to Medusa fulfillment)

---

## Medusa Admin Dashboard

Available at `http://localhost:9000/app` in dev, `your-backend-url/app` in prod. Ships for free with Medusa. Sellers access a scoped vendor view (marketplace plugin); Daniel accesses the full admin.

Do not build custom admin UIs for order management, product management, or fulfillment — use the Medusa dashboard.
