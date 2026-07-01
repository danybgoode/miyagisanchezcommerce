/**
 * lib/ml-sync-subscription.ts
 *
 * Server-side bridge to the Medusa ML-sync subscription (epic 03 · mercadolibre-sync,
 * Sprint 6). A faithful clone of `lib/subdomain-subscription.ts`. The Medusa
 * subscriptions module is the SOURCE OF TRUTH for "does this seller have a live
 * ML-sync subscription?" (AGENTS rule #1); this reads/writes it via the internal
 * backend routes.
 *
 * Consumed by:
 *  - the ML-sync entitlement composer (`lib/ml-sync-entitlement-server.ts`) →
 *    `hasActiveMlSyncSubscription` feeds the pure seam's `hasActiveSubscription`.
 *  - the buy route → `getMlSyncSubscription` resolves the plan's Stripe price ids.
 *  - the Stripe webhook lapse handlers → `setMlSyncSubscriptionStatus` flips the
 *    Medusa row off so the entitlement gate re-closes.
 *
 * server-only (holds MEDUSA_INTERNAL_SECRET). Every read fails CLOSED to "not
 * active" so a backend hiccup keeps the gate closed, never wrongly grants.
 */
import 'server-only'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

/** Metadata `kind` stamped on the Stripe checkout session + subscription so the
 *  webhook can tell an ML-sync purchase apart from the other SKUs. */
export const ML_SYNC_CHECKOUT_KIND = 'ml_sync'

export type MlSyncSubscription = {
  active: boolean
  stripe_price_id: string | null
  price_cents: number | null
  monthly_stripe_price_id: string | null
  monthly_price_cents: number | null
  plan_id: string | null
  subscription_id: string | null
}

const EMPTY: MlSyncSubscription = {
  active: false,
  stripe_price_id: null,
  price_cents: null,
  monthly_stripe_price_id: null,
  monthly_price_cents: null,
  plan_id: null,
  subscription_id: null,
}

/** Read the seller's ML-sync subscription state + the plan's Stripe prices. */
export async function getMlSyncSubscription(sellerClerkId: string): Promise<MlSyncSubscription> {
  if (!sellerClerkId || !INTERNAL_SECRET) return EMPTY
  try {
    const res = await fetch(
      `${MEDUSA_BASE}/internal/ml-sync-subscription?seller_clerk_id=${encodeURIComponent(sellerClerkId)}`,
      { headers: { 'x-internal-secret': INTERNAL_SECRET }, cache: 'no-store' },
    )
    if (!res.ok) return EMPTY
    const d = (await res.json()) as Partial<MlSyncSubscription>
    return {
      active: !!d.active,
      stripe_price_id: d.stripe_price_id ?? null,
      price_cents: d.price_cents ?? null,
      monthly_stripe_price_id: d.monthly_stripe_price_id ?? null,
      monthly_price_cents: d.monthly_price_cents ?? null,
      plan_id: d.plan_id ?? null,
      subscription_id: d.subscription_id ?? null,
    }
  } catch {
    return EMPTY
  }
}

/** Convenience: just the boolean that feeds the entitlement seam. */
export async function hasActiveMlSyncSubscription(sellerClerkId: string): Promise<boolean> {
  return (await getMlSyncSubscription(sellerClerkId)).active
}

/** Flip the Medusa subscription status by its Stripe id (webhook lapse path). */
export async function setMlSyncSubscriptionStatus(
  stripeSubscriptionId: string,
  status: 'active' | 'trialing' | 'past_due' | 'canceled',
): Promise<void> {
  if (!INTERNAL_SECRET || !stripeSubscriptionId) return
  try {
    await fetch(`${MEDUSA_BASE}/internal/ml-sync-subscription`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ stripe_subscription_id: stripeSubscriptionId, status }),
    })
  } catch (e) {
    console.error('[ml-sync-subscription] status update failed:', e)
  }
}
