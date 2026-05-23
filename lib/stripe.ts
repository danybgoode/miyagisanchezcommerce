import Stripe from 'stripe'

// Lazy singleton — throws at request time (not build time) if key is missing
let _stripe: Stripe | null = null
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY
    if (!key) throw new Error('Missing STRIPE_SECRET_KEY environment variable')
    _stripe = new Stripe(key, { apiVersion: '2026-04-22.dahlia' })
  }
  return _stripe
}

// Convenience alias used by existing imports
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return (getStripe() as unknown as Record<string | symbol, unknown>)[prop]
  },
})

// ── Helper: get shop's Stripe settings from metadata ─────────────────────────

export interface ShopStripeSettings {
  account_id?: string
  charges_enabled?: boolean
  details_submitted?: boolean
  onboarding_complete?: boolean
  enabled?: boolean
}

export function getShopStripe(metadata: Record<string, unknown> | null): ShopStripeSettings {
  const settings = (metadata?.settings ?? {}) as Record<string, unknown>
  return (settings.stripe ?? {}) as ShopStripeSettings
}

// ── Helper: build Connect account link ───────────────────────────────────────

export async function createAccountLink(accountId: string, origin: string): Promise<string> {
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}/api/stripe/connect/refresh?account_id=${accountId}`,
    return_url: `${origin}/api/stripe/connect/return?account_id=${accountId}`,
    type: 'account_onboarding',
  })
  return link.url
}
