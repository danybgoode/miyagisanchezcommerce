/**
 * lib/domain-subscription.ts
 *
 * Server-side bridge to the Medusa custom-domain subscription (epic 07 ·
 * custom-domain-paywall, Sprint 2). The Medusa subscriptions module is the
 * SOURCE OF TRUTH for "does this seller have a live custom-domain subscription?"
 * (AGENTS rule #1). This module reads/writes it via the internal backend routes.
 *
 * Consumed by:
 *  - the domain-mutation routes + Canal UI → `hasActiveCustomDomainSubscription`
 *    feeds the Sprint-1 entitlement seam's `hasActiveSubscription` input.
 *  - the buy route → `getCustomDomainSubscription` resolves the plan's Stripe
 *    price id to build the checkout.
 *  - the Stripe webhook lapse handlers → `setCustomDomainSubscriptionStatus`
 *    flips the Medusa row off so the entitlement gate re-closes.
 *
 * server-only (holds MEDUSA_INTERNAL_SECRET). Every read fails CLOSED to
 * "not active" so a backend hiccup keeps the paywall gated, never wrongly grants.
 */
import 'server-only'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

/** Metadata `kind` stamped on the Stripe checkout session + subscription so the
 *  webhook can tell a custom-domain purchase apart from a seller-listing one. */
export const CUSTOM_DOMAIN_CHECKOUT_KIND = 'custom_domain'

export type CustomDomainSubscription = {
  /** Backend-computed liveness: true for the backend's LIVE_STATUSES, which
   *  INCLUDE `past_due` as a deliberate grace window (not just active/trialing).
   *  Source of truth is the Medusa route; don't re-derive it here. */
  active: boolean
  stripe_price_id: string | null
  price_cents: number | null
  plan_id: string | null
}

const EMPTY: CustomDomainSubscription = {
  active: false,
  stripe_price_id: null,
  price_cents: null,
  plan_id: null,
}

/** Read the seller's custom-domain subscription state + the plan's Stripe price. */
export async function getCustomDomainSubscription(
  sellerClerkId: string,
): Promise<CustomDomainSubscription> {
  if (!sellerClerkId || !INTERNAL_SECRET) return EMPTY
  try {
    const res = await fetch(
      `${MEDUSA_BASE}/internal/custom-domain-subscription?seller_clerk_id=${encodeURIComponent(sellerClerkId)}`,
      { headers: { 'x-internal-secret': INTERNAL_SECRET }, cache: 'no-store' },
    )
    if (!res.ok) return EMPTY
    const d = (await res.json()) as Partial<CustomDomainSubscription>
    return {
      active: !!d.active,
      stripe_price_id: d.stripe_price_id ?? null,
      price_cents: d.price_cents ?? null,
      plan_id: d.plan_id ?? null,
    }
  } catch {
    return EMPTY
  }
}

/** Convenience: just the boolean that feeds the entitlement seam. */
export async function hasActiveCustomDomainSubscription(sellerClerkId: string): Promise<boolean> {
  return (await getCustomDomainSubscription(sellerClerkId)).active
}

/** Flip the Medusa subscription status by its Stripe id (webhook lapse path). */
export async function setCustomDomainSubscriptionStatus(
  stripeSubscriptionId: string,
  status: 'active' | 'trialing' | 'past_due' | 'canceled',
): Promise<void> {
  if (!INTERNAL_SECRET || !stripeSubscriptionId) return
  try {
    await fetch(`${MEDUSA_BASE}/internal/custom-domain-subscription`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ stripe_subscription_id: stripeSubscriptionId, status }),
    })
  } catch (e) {
    console.error('[domain-subscription] status update failed:', e)
  }
}
