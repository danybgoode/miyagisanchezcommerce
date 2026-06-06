/**
 * lib/checkout-killswitch.ts
 *
 * Pure transform: apply the checkout payment kill-switches to the options
 * payload Medusa returned. Kept free of `next/*` and `server-only` so it is
 * directly unit-testable (the route + lib/flags.ts that wrap it are not).
 *
 * The flag *values* are resolved elsewhere (lib/flags.ts → Flagsmith, fail-open);
 * this function just applies them. See the spike decision §6.
 */

export type PaymentMethod = { id: string; [k: string]: unknown }

export type CheckoutKillSwitches = {
  /** `checkout.stripe_enabled` — when false, the Stripe card rail is removed. */
  stripeEnabled: boolean
}

type OptionsPayload = {
  payment_methods?: PaymentMethod[]
  payment_default?: string | null
  [k: string]: unknown
}

/**
 * Returns the options payload with disabled rails removed. Non-mutating where it
 * matters (returns the input untouched when there's nothing to filter), and
 * safe on malformed / error bodies (no `payment_methods` array → passthrough).
 */
export function applyPaymentKillSwitches(data: unknown, flags: CheckoutKillSwitches): unknown {
  if (!data || typeof data !== 'object') return data
  const obj = data as OptionsPayload
  if (!Array.isArray(obj.payment_methods)) return data

  let methods = obj.payment_methods
  let paymentDefault = obj.payment_default ?? null

  if (!flags.stripeEnabled) {
    methods = methods.filter(m => m?.id !== 'stripe')
    if (paymentDefault === 'stripe') paymentDefault = methods[0]?.id ?? null
  }

  if (methods === obj.payment_methods) return data // nothing removed → untouched
  return { ...obj, payment_methods: methods, payment_default: paymentDefault }
}
