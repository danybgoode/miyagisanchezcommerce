/**
 * lib/subdomain-switch.ts
 *
 * Switch a live subdomain subscription between the monthly and yearly cadence
 * (epic 07 · subdomain-pricing, Sprint 3) — WITHOUT a double charge or an
 * entitlement gap.
 *
 * The switch is a Stripe price swap on the SAME subscription:
 *   stripe.subscriptions.update(subId, { items:[{ id, price:targetPriceId }],
 *                                        proration_behavior:'create_prorations' })
 * Because it's the same `stripe_subscription_id`:
 *   - entitlement is CONTINUOUS — the subscription never leaves LIVE_STATUSES, so
 *     the middleware gate keeps serving the white-label subdomain (no 301 gap);
 *   - Stripe PRORATES — the unused portion of the current cadence is credited
 *     against the new one, so there is no double charge (monthly→yearly charges the
 *     prorated difference now; yearly→monthly banks a credit against future months).
 * The existing `customer.subscription.updated` webhook re-syncs the status (stays
 * `active`), so no Medusa row rewrite is needed — the entitlement read is
 * liveness-based, interval-agnostic.
 *
 * server-only (reaches Medusa via the subscription bridge + Stripe). One shared
 * builder for the seller route + the MCP tool, so they can't drift.
 */
import 'server-only'
import { stripe } from '@/lib/stripe'
import { getSubdomainSubscription } from '@/lib/subdomain-subscription'
import {
  coerceSubdomainInterval,
  subdomainPriceIdForInterval,
  decideCadenceSwitch,
  cadenceSwitchRefusalMessage,
  type SubdomainInterval,
} from '@/lib/subdomain-billing'

export type SwitchCadenceResult =
  | { ok: true; switched: boolean; interval: SubdomainInterval }
  | { ok: false; error: string; status: number }

/** Read the current billing interval off a live Stripe subscription's price. */
function intervalOf(sub: import('stripe').Stripe.Subscription): SubdomainInterval | null {
  const recurring = sub.items.data[0]?.price?.recurring
  return recurring?.interval === 'month' ? 'month' : recurring?.interval === 'year' ? 'year' : null
}

/**
 * Switch the seller's subdomain subscription to `targetInterval`. Only possible on
 * an ACTIVE RECURRING subscription (a one-time grant has no Stripe subscription to
 * prorate); switching to the current cadence is a no-op that never re-charges.
 */
export async function switchSubdomainCadence(input: {
  sellerClerkId: string
  targetInterval: SubdomainInterval | string | null
}): Promise<SwitchCadenceResult> {
  const target = coerceSubdomainInterval(input.targetInterval)

  const sub = await getSubdomainSubscription(input.sellerClerkId)
  const targetPriceId = subdomainPriceIdForInterval(target, {
    yearly: sub.stripe_price_id,
    monthly: sub.monthly_stripe_price_id,
  })

  // Refuse before touching Stripe when there's no live subscription to switch.
  if (!sub.active || !sub.subscription_id) {
    return { ok: false, status: 409, error: cadenceSwitchRefusalMessage('no_subscription') }
  }
  if (!targetPriceId) {
    return { ok: false, status: 422, error: cadenceSwitchRefusalMessage('no_price') }
  }

  let stripeSub: import('stripe').Stripe.Subscription
  try {
    stripeSub = await stripe.subscriptions.retrieve(sub.subscription_id)
  } catch {
    return { ok: false, status: 502, error: 'No se pudo leer tu suscripción. Intenta más tarde.' }
  }
  const item = stripeSub.items.data[0]
  const current = intervalOf(stripeSub)

  const decision = decideCadenceSwitch({
    current,
    target,
    hasActiveRecurring: true,
    targetPriceId,
  })
  if (decision.action === 'refuse') {
    return { ok: false, status: 422, error: cadenceSwitchRefusalMessage(decision.reason) }
  }
  if (decision.action === 'noop' || !item) {
    // Already on the target cadence (or no item to swap) — nothing to charge.
    return { ok: true, switched: false, interval: target }
  }

  try {
    await stripe.subscriptions.update(sub.subscription_id, {
      items: [{ id: item.id, price: targetPriceId }],
      proration_behavior: 'create_prorations',
      metadata: { ...(stripeSub.metadata ?? {}), interval: target },
    })
  } catch {
    return { ok: false, status: 502, error: 'No se pudo cambiar tu plan. Intenta más tarde.' }
  }

  return { ok: true, switched: true, interval: target }
}
