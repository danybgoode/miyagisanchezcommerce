/**
 * One-off cutover seed (epic: custom-domain-paywall, Sprint 2, Story 2.1).
 *
 * Provisions the PLATFORM-owned custom-domain subscription SKU end to end:
 *   1. Create (or reuse) a Stripe Product + annual Price — $499 MXN/yr — on the
 *      PLATFORM Stripe account. The platform is the payee (no connected account,
 *      no 97% transfer). Idempotent via a stable Price `lookup_key`.
 *   2. POST the resulting `stripe_price_id` to the backend seed route, which
 *      upserts the one Medusa SubscriptionPlan (metadata.kind=custom_domain_plan)
 *      that the entitlement read route + webhook resolve.
 *
 * ⚠️  RUN ORDER: run this AFTER the backend deploy that ships
 *     /internal/setup-custom-domain-plan, and BEFORE flipping
 *     `domain.paywall_enabled` on in Flagsmith.
 *
 * Run:  node --env-file=.env.local scripts/seed-custom-domain-plan.mjs
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

const PRICE_CENTS = 49900 // $499 MXN
const CURRENCY = 'mxn'
const LOOKUP_KEY = 'custom_domain_annual'

const stripe = new Stripe(STRIPE_SECRET_KEY)

// ── 1. Stripe Product + annual Price (idempotent via lookup_key) ──────────────
let price
const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1 })
if (existing.data.length > 0) {
  price = existing.data[0]
  console.log(`Reusing existing Stripe price ${price.id} (lookup_key=${LOOKUP_KEY}).`)
} else {
  const product = await stripe.products.create({
    name: 'Dominio propio — Miyagi Sánchez',
    description: 'Conecta tu propio dominio a tu tienda. $499 MXN/año.',
    metadata: { kind: 'custom_domain_plan' },
  })
  price = await stripe.prices.create({
    product: product.id,
    unit_amount: PRICE_CENTS,
    currency: CURRENCY,
    recurring: { interval: 'year' },
    lookup_key: LOOKUP_KEY,
    metadata: { kind: 'custom_domain_plan' },
  })
  console.log(`Created Stripe product ${product.id} + price ${price.id}.`)
}

// ── 2. Upsert the Medusa SubscriptionPlan via the backend seed route ──────────
const res = await fetch(`${MEDUSA_BASE}/internal/setup-custom-domain-plan`, {
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
console.log('\nDone. Next: flip domain.paywall_enabled ON in Flagsmith when ready.')
