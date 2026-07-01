/**
 * One-off cutover seed (epic: subdomain-pricing, Sprint 2, US-4). A faithful clone
 * of scripts/seed-custom-domain-plan.mjs for the cheaper subdomain SKU.
 *
 * Provisions the PLATFORM-owned subdomain subscription SKU end to end:
 *   1. Create (or reuse) a Stripe Product + annual Price — $199 MXN/yr — AND a
 *      monthly Price — $25 MXN/mo (Sprint 3) — on the PLATFORM Stripe account. The
 *      platform is the payee (no connected account, no 97% transfer). Idempotent via
 *      stable Price `lookup_key`s.
 *   2. POST each `stripe_price_id` to the backend seed route (yearly first, then
 *      monthly), which upserts the ONE Medusa SubscriptionPlan
 *      (metadata.kind=subdomain_plan) — the yearly price in its column, the monthly
 *      price in its metadata — that the entitlement read route + webhook resolve.
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

const PRICE_CENTS = 19900 // $199 MXN / year
const MONTHLY_CENTS = 2500 // $25 MXN / month
const CURRENCY = 'mxn'
const LOOKUP_KEY = 'subdomain_annual'
const MONTHLY_LOOKUP_KEY = 'subdomain_monthly'

const stripe = new Stripe(STRIPE_SECRET_KEY)

/** Find-or-create a recurring Stripe price by lookup_key (idempotent). */
async function ensurePrice({ lookupKey, unitAmount, interval, productName }) {
  const found = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  if (found.data.length > 0) {
    console.log(`Reusing existing Stripe price ${found.data[0].id} (lookup_key=${lookupKey}).`)
    return found.data[0]
  }
  const product = await stripe.products.create({
    name: productName,
    description: 'Tu tienda en tu-tienda.miyagisanchez.com (sitio independiente).',
    metadata: { kind: 'subdomain_plan' },
  })
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: unitAmount,
    currency: CURRENCY,
    recurring: { interval },
    lookup_key: lookupKey,
    metadata: { kind: 'subdomain_plan' },
  })
  console.log(`Created Stripe product ${product.id} + price ${price.id} (${interval}).`)
  return price
}

/** POST a price to the backend seed route for one cadence. */
async function seedPlan({ stripePriceId, priceCents, interval }) {
  const res = await fetch(`${MEDUSA_BASE}/internal/setup-subdomain-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
    body: JSON.stringify({ stripe_price_id: stripePriceId, price_cents: priceCents, interval }),
  })
  if (!res.ok) {
    console.error(`Backend seed (${interval}) failed:`, res.status, await res.text())
    process.exit(1)
  }
  return res.json()
}

// ── 1. Stripe prices (idempotent via lookup_key) — yearly + monthly ───────────
const yearly = await ensurePrice({
  lookupKey: LOOKUP_KEY,
  unitAmount: PRICE_CENTS,
  interval: 'year',
  productName: 'Subdominio propio — Miyagi Sánchez',
})
const monthly = await ensurePrice({
  lookupKey: MONTHLY_LOOKUP_KEY,
  unitAmount: MONTHLY_CENTS,
  interval: 'month',
  productName: 'Subdominio propio (mensual) — Miyagi Sánchez',
})

// ── 2. Upsert the ONE Medusa SubscriptionPlan — yearly first (creates/updates the
//       plan + its column), then monthly (merges the monthly price into metadata).
const { plan, created } = await seedPlan({ stripePriceId: yearly.id, priceCents: PRICE_CENTS, interval: 'year' })
console.log(`Medusa plan ${created ? 'created' : 'updated'}: ${plan?.id} (yearly stripe_price_id=${plan?.stripe_price_id}).`)

const { plan: withMonthly } = await seedPlan({ stripePriceId: monthly.id, priceCents: MONTHLY_CENTS, interval: 'month' })
const m = withMonthly?.metadata ?? {}
console.log(`Medusa plan updated with monthly price: ${withMonthly?.id} (monthly stripe_price_id=${m.monthly_stripe_price_id}).`)

console.log('\nDone. The subdomain SKU is now purchasable yearly ($199/yr) AND monthly ($25/mo) — subdomain.paywall_enabled is already ON.')
