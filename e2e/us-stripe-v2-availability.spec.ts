import { expect, test } from '@playwright/test'
import { publicShopPaymentAvailability } from '../lib/public-shop-commerce'
import { resolveCommerceReadiness } from '../lib/commerce-readiness'

/**
 * us-marketplace S4 — the two account GENERATIONS describe the same fact with
 * different keys, and the storefront only understood one of them.
 *
 * MX shops are Stripe v1 Express and persist `connected` + `charges_enabled`. US shops
 * are Accounts v2 `merchant` (D14) and persist what `projectStripeV2Account` reads from
 * `/v2/core/accounts`: `api_generation`, `merchant_configuration`,
 * `card_payments_status` and the requirement lists — with NO `connected` and NO
 * `charges_enabled` key at all.
 *
 * Checking only the v1 keys meant a fully onboarded US seller with `card_payments:
 * active` read as "no payment method", so `resolveCommerceReadiness` answered
 * `seller_payment_unavailable` and every surface — storefront, UCP, MCP — suppressed
 * `buy_now` permanently. Browsable and unbuyable, with no error anywhere: the backend
 * was ready to charge and the frontend never offered the button.
 */

/** Exactly what `mergeStripeSettings(_, projectStripeV2Account(account))` persists. */
const v2Ready = {
  settings: {
    stripe: {
      account_id: 'acct_1U3RtJLloZe3XdZ1',
      api_generation: 'v2',
      account_country: 'us',
      merchant_configuration: 'active',
      card_payments_status: 'active',
      blocking_requirements: [],
      outstanding_requirements: [],
    },
  },
}

const v2With = (over: Record<string, unknown>) => ({
  settings: { stripe: { ...v2Ready.settings.stripe, ...over } },
})

test.describe('US Accounts v2 payment availability', () => {
  test('a fully onboarded US v2 seller is available for charges', () => {
    expect(publicShopPaymentAvailability(v2Ready).stripe).toBe(true)
  })

  test('and therefore reads as commerce-ready, which is what puts buy_now on the page', () => {
    expect(resolveCommerceReadiness({
      market: 'us', priceCents: 10_000, currency: 'USD',
      sellerPaymentAvailable: publicShopPaymentAvailability(v2Ready).stripe,
    })).toEqual({ ready: true, market_code: 'us', reason: 'ready' })
  })

  test('a v2 account short of the charge capability is NOT available', () => {
    for (const over of [
      { card_payments_status: 'inactive' },
      { card_payments_status: 'pending' },
      { card_payments_status: null },
      { merchant_configuration: 'absent' },
      // Stripe will refuse the charge, so offering buy_now sends the buyer to a failure.
      { blocking_requirements: ['identity.verification'] },
    ]) {
      expect(publicShopPaymentAvailability(v2With(over)).stripe, JSON.stringify(over)).toBe(false)
    }
  })

  test("the seller's own opt-out beats the capability, in both generations", () => {
    expect(publicShopPaymentAvailability(v2With({ enabled: false })).stripe).toBe(false)
    expect(publicShopPaymentAvailability({
      settings: { stripe: { connected: true, charges_enabled: true, enabled: false } },
    }).stripe).toBe(false)
  })

  test('MX v1 is unchanged — the v2 branch is entered only by api_generation', () => {
    expect(publicShopPaymentAvailability({
      settings: { stripe: { connected: true, charges_enabled: true } },
    }).stripe).toBe(true)
    expect(publicShopPaymentAvailability({
      settings: { stripe: { connected: true, charges_enabled: false } },
    }).stripe).toBe(false)
    expect(publicShopPaymentAvailability({
      settings: { stripe: { connected: false, charges_enabled: true } },
    }).stripe).toBe(false)
  })

  test('a v2-shaped account is not accepted through the v1 door, or vice versa', () => {
    // Without `api_generation` the v2 keys must NOT be enough — otherwise a partially
    // written row could look available on the strength of a status alone.
    expect(publicShopPaymentAvailability({
      settings: { stripe: { merchant_configuration: 'active', card_payments_status: 'active' } },
    }).stripe).toBe(false)
    // And a v2 row may not be rescued by stale v1 keys underneath it.
    expect(publicShopPaymentAvailability(
      v2With({ card_payments_status: 'inactive', connected: true, charges_enabled: true }),
    ).stripe).toBe(false)
  })

  test('an empty or absent shop is not available', () => {
    for (const meta of [null, undefined, {}, { settings: {} }, { settings: { stripe: {} } }]) {
      expect(publicShopPaymentAvailability(meta).stripe).toBe(false)
    }
  })
})
