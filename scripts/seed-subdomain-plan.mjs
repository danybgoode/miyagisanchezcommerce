/**
 * One-off cutover seed (epic: subdomain-pricing, Sprint 2, US-4). A faithful clone
 * of scripts/seed-custom-domain-plan.mjs for the cheaper subdomain SKU.
 *
 * Provisions the PLATFORM-owned subdomain subscription SKU end to end:
 *   1. Create (or reuse) a Stripe Product + annual Price — $199 MXN/yr — on the
 *      PLATFORM Stripe account. The platform is the payee (no connected account,
 *      no 97% transfer). Idempotent via a stable Price `lookup_key`.
 *   2. POST the resulting `stripe_price_id` to the backend seed route, which
 *      upserts the one Medusa SubscriptionPlan (metadata.kind=subdomain_plan)
 *      that the entitlement read route + webhook resolve.
 *
 * ⚠️  RUN ORDER: run this AFTER the backend deploy that ships
 *     /internal/setup-subdomain-plan, and with PROD creds (Cloud Run URL +
 *     sk_live + the prod MEDUSA_INTERNAL_SECRET), not the dev .env.local.
 *     `subdomain.paywall_enabled` is already ON (Sprint 1 cutover); seeding the
 *     plan is what makes the paid path purchasable.
 *
 * Run:  node --env-file=.env.local scripts/seed-subdomain-plan.mjs
 * Idempotent — re-runs reuse the same Stripe Price + update the same Medusa plan.
 *
 * Env: STRIPE_SECRET_KEY, MEDUSA_STORE_URL, MEDUSA_INTERNAL_SECRET.
 */

import Stripe from 'stripe'

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY
const MEDUSA_BASE = process.env.MEDUSA_STORE_URL
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET

if (!STRIPE_SECRET_KEY || !MEDUSA_BASE || !INTERNAL_SECRET) {
  console.error('Missing STRIPE_SECRET_KEY / MEDUSA_STORE_URL / MEDUSA_INTERNAL_SECRET')
  process.exit(1)
}

const PRICE_CENTS = 19900 // $199 MXN
const CURRENCY = 'mxn'
const LOOKUP_KEY = 'subdomain_annual'

const stripe = new Stripe(STRIPE_SECRET_KEY)

// ── 1. Stripe Product + annual Price (idempotent via lookup_key) ──────────────
let price
const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 })
if (existing.data.length > 0) {
  price = existing.data[0]
  console.log(`Reusing existing Stripe price ${price.id} (lookup_key=${LOOKUP_KEY}).`)
} else {
  const product = await stripe.products.create({
    name: 'Subdominio propio — Miyagi Sánchez',
    description: 'Tu tienda en tu-tienda.miyagisanchez.com (sitio independiente). $199 MXN/año.',
    metadata: { kind: 'subdomain_plan' },
  })
  price = await stripe.prices.create({
    product: product.id,
    unit_amount: PRICE_CENTS,
    currency: CURRENCY,
    recurring: { interval: 'year' },
    lookup_key: LOOKUP_KEY,
    metadata: { kind: 'subdomain_plan' },
  })
  console.log(`Created Stripe product ${product.id} + price ${price.id}.`)
}

// ── 2. Upsert the Medusa SubscriptionPlan via the backend seed route ──────────
const res = await fetch(`${MEDUSA_BASE}/internal/setup-subdomain-plan`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
  body: JSON.stringify({ stripe_price_id: price.id, price_cents: PRICE_CENTS }),
})
if (!res.ok) {
  console.error('Backend seed failed:', res.status, await res.text())
  process.exit(1)
}
const { plan, created } = await res.json()
console.log(`Medusa plan ${created ? 'created' : 'updated'}: ${plan?.id} (stripe_price_id=${plan?.stripe_price_id}).`)
console.log('\nDone. The subdomain SKU is now purchasable (subdomain.paywall_enabled is already ON).')
