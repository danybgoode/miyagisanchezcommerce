import { test, expect } from '@playwright/test'
import { applyPaymentKillSwitches } from '../lib/checkout-killswitch'

/**
 * Feature flags & kill-switches · Sprint 1.
 * The pure transform behind the `checkout.stripe_enabled` kill-switch: given the
 * options payload Medusa returned + the resolved flag value, it drops the Stripe
 * rail when the flag is OFF. The flag *value* (and its fail-open default) is
 * Flagsmith's job (lib/flags.ts); this proves the application logic. No network.
 */
const sampleOptions = () => ({
  payment_methods: [
    { id: 'stripe', kind: 'online', label: 'Tarjeta' },
    { id: 'mercadopago', kind: 'online', label: 'Mercado Pago' },
    { id: 'spei', kind: 'manual', label: 'SPEI' },
    { id: 'cash', kind: 'manual', label: 'Efectivo' },
  ],
  payment_default: 'stripe',
  delivery_methods: [{ id: 'shipping' }],
  only_coordinated: false,
})

test.describe('checkout kill-switch · checkout.stripe_enabled', () => {
  test('flag ON → payload is untouched (Stripe present, same default)', () => {
    const input = sampleOptions()
    const out = applyPaymentKillSwitches(input, { stripeEnabled: true }) as typeof input
    // Nothing removed → returns the input untouched.
    expect(out).toBe(input)
    expect(out.payment_methods.map(m => m.id)).toEqual(['stripe', 'mercadopago', 'spei', 'cash'])
    expect(out.payment_default).toBe('stripe')
  })

  test('flag OFF → Stripe removed and the default falls back to the next rail', () => {
    const out = applyPaymentKillSwitches(sampleOptions(), { stripeEnabled: false }) as ReturnType<typeof sampleOptions>
    expect(out.payment_methods.map(m => m.id)).toEqual(['mercadopago', 'spei', 'cash'])
    expect(out.payment_default).toBe('mercadopago')
    // Other parts of the payload are preserved.
    expect(out.delivery_methods).toEqual([{ id: 'shipping' }])
    expect(out.only_coordinated).toBe(false)
  })

  test('flag OFF with Stripe as the only rail → empty list, null default (never crashes)', () => {
    const out = applyPaymentKillSwitches(
      { payment_methods: [{ id: 'stripe' }], payment_default: 'stripe' },
      { stripeEnabled: false },
    ) as { payment_methods: unknown[]; payment_default: string | null }
    expect(out.payment_methods).toEqual([])
    expect(out.payment_default).toBeNull()
  })

  test('malformed / error bodies pass through untouched', () => {
    expect(applyPaymentKillSwitches(null, { stripeEnabled: false })).toBeNull()
    const err = { error: 'sellerId requerido.' }
    expect(applyPaymentKillSwitches(err, { stripeEnabled: false })).toBe(err)
  })
})
