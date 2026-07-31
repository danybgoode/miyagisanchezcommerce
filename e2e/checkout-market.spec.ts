import { expect, test } from '@playwright/test'
import { isCheckoutListingAdmitted, isVariantOwnedByProduct } from '../lib/checkout-market'

const mxDetail = {
  market_code: 'mx',
  listing: { id: 'prod_mx', medusa_product_id: 'prod_mx' },
}

test.describe('checkout market admission', () => {
  test('admits only an exact product under a confirmed marketplace market', () => {
    expect(isCheckoutListingAdmitted(mxDetail, 'mx', 'prod_mx')).toBe(true)
  })

  test('refuses an absent/mismatched echo or a different product id', () => {
    expect(isCheckoutListingAdmitted({ listing: mxDetail.listing }, 'mx', 'prod_mx')).toBe(false)
    expect(isCheckoutListingAdmitted({ ...mxDetail, market_code: 'us' }, 'mx', 'prod_mx')).toBe(false)
    expect(isCheckoutListingAdmitted(mxDetail, 'mx', 'prod_other')).toBe(false)
  })
})

test.describe('checkout variant ownership · the proof must cover what is BOUGHT', () => {
  // The admission gate above proves a PRODUCT is published to this market; a cart
  // line buys a VARIANT. Both come from the caller, so a divergence would let an
  // admitted productId escort a variant of an unpublished product past the gate.
  const variants = [{ id: 'variant_a1' }, { id: 'variant_a2' }]

  test('admits a variant that belongs to the admitted product', () => {
    expect(isVariantOwnedByProduct('variant_a1', variants)).toBe(true)
    expect(isVariantOwnedByProduct('variant_a2', variants)).toBe(true)
  })

  test('refuses a variant belonging to a DIFFERENT product (the bypass)', () => {
    expect(isVariantOwnedByProduct('variant_from_unpublished_product', variants)).toBe(false)
  })

  test('fails closed when the product exposes no variants', () => {
    // "I could not see the variants" is not "the variant is fine".
    expect(isVariantOwnedByProduct('variant_a1', [])).toBe(false)
  })
})
