import { expect, test } from '@playwright/test'
import { admitMarketCheckout, marketCheckoutRefusalMessage } from '../lib/checkout-market-strategy'

/**
 * us-marketplace S4.2 (D16) — the storefront's OFFER gate for US checkout.
 *
 * The backend's `admitUsDelivery` is the authorization boundary; this copy exists so
 * the buyer is stopped before a cart write rather than after one. The two must agree,
 * so the refusal CODES here are deliberately the same strings the backend returns.
 */

const usAddress = {
  country: 'US', line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701',
}

const base = {
  market: 'us',
  provider: 'stripe' as const,
  fulfillmentMethod: 'manual_carrier' as const,
  shippingAddress: usAddress,
  hasClientShippingQuote: false,
}

test.describe('US checkout admission', () => {
  test('admits manual carrier + card, and states the seller-funded $0', () => {
    expect(admitMarketCheckout(base)).toEqual({ ok: true, market: 'us', shippingAmountCents: 0 })
  })

  test('refuses carrier-rated shipping — no US carrier exists to quote', () => {
    expect(admitMarketCheckout({ ...base, fulfillmentMethod: 'shipping' }))
      .toMatchObject({ ok: false, code: 'US_CARRIER_UNAVAILABLE' })
  })

  test('refuses a browser-supplied shipping quote', () => {
    expect(admitMarketCheckout({ ...base, hasClientShippingQuote: true }))
      .toMatchObject({ ok: false, code: 'US_CLIENT_SHIPPING_FORBIDDEN' })
  })

  test('requires a complete US address for an addressed delivery', () => {
    for (const bad of [
      null,
      { ...usAddress, country: 'MX' },
      { ...usAddress, line1: '' },
      { ...usAddress, city: '' },
      { ...usAddress, state: '' },
      { ...usAddress, postal_code: '' },
    ]) {
      expect(admitMarketCheckout({ ...base, shippingAddress: bad }))
        .toMatchObject({ ok: false, code: 'US_ADDRESS_REQUIRED' })
    }
  })

  test('does NOT demand an address for unaddressed US deliveries', () => {
    // An earlier draft required `manual_carrier` for every US checkout, which would
    // have refused a US digital good, service, rental and local pickup outright —
    // all of which the market supports. Always allow the negation of what you ban.
    for (const method of ['digital', 'service', 'rental', 'local_pickup'] as const) {
      expect(admitMarketCheckout({ ...base, fulfillmentMethod: method, shippingAddress: null }))
        .toMatchObject({ ok: true, market: 'us' })
    }
  })

  test('refuses the Mexican payment rails on a US order', () => {
    for (const provider of ['mercadopago', 'spei', 'cash', 'manual'] as const) {
      expect(admitMarketCheckout({ ...base, provider }))
        .toMatchObject({ ok: false, code: 'US_ONLINE_PAYMENT_REQUIRED' })
    }
  })

  test('coord stays manual-pay, in both markets', () => {
    expect(admitMarketCheckout({ ...base, fulfillmentMethod: 'coord', provider: 'stripe' }))
      .toMatchObject({ ok: false, code: 'COORD_REQUIRES_MANUAL_PAYMENT' })
    expect(admitMarketCheckout({ ...base, market: 'mx', fulfillmentMethod: 'coord', provider: 'stripe' }))
      .toMatchObject({ ok: false, code: 'COORD_REQUIRES_MANUAL_PAYMENT' })
    expect(admitMarketCheckout({ ...base, fulfillmentMethod: 'coord', provider: 'manual' }))
      .toMatchObject({ ok: true })
  })

  test('MX is admitted with no US rule applied, and no shipping opinion', () => {
    expect(admitMarketCheckout({
      market: 'mx', provider: 'mercadopago', fulfillmentMethod: 'shipping',
      shippingAddress: null, hasClientShippingQuote: true,
    })).toEqual({ ok: true, market: 'mx', shippingAmountCents: null })
  })

  const CODES = [
    'US_ONLINE_PAYMENT_REQUIRED', 'US_CARRIER_UNAVAILABLE', 'US_ADDRESS_REQUIRED',
    'US_CLIENT_SHIPPING_FORBIDDEN', 'COORD_REQUIRES_MANUAL_PAYMENT',
  ] as const

  test('no refusal shows a buyer a SCREAMING_SNAKE code', () => {
    for (const market of ['mx', 'us'] as const) {
      for (const code of CODES) {
        const message = marketCheckoutRefusalMessage(code, market)
        expect(message.length).toBeGreaterThan(20)
        expect(message).not.toContain(code)
        expect(message).not.toMatch(/[A-Z]{2,}_[A-Z]/)
      }
    }
  })

  test('an MX buyer is refused in Spanish — the coord rule fires on MX too', () => {
    // Found by the Codex cross-family pass on PR #359. `COORD_REQUIRES_MANUAL_PAYMENT`
    // is not US-only, and the first version answered it in English, putting hardcoded
    // English on an es-MX surface (AGENTS.md rule 5).
    for (const code of CODES) {
      const es = marketCheckoutRefusalMessage(code, 'mx')
      expect(es, code).toMatch(/[áéíóúñ¿]|vendedor|envío|pedidos|dirección|navegador|entrega/i)
    }
    // …and the default market is MX, so an omitted argument cannot leak English.
    expect(marketCheckoutRefusalMessage('COORD_REQUIRES_MANUAL_PAYMENT'))
      .toBe(marketCheckoutRefusalMessage('COORD_REQUIRES_MANUAL_PAYMENT', 'mx'))
  })

  test('a US buyer is refused in English', () => {
    for (const code of CODES) {
      expect(marketCheckoutRefusalMessage(code, 'us'), code).not.toMatch(/[áéíóúñ¿¡]/i)
    }
  })
})
