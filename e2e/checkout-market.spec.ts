import { expect, test } from '@playwright/test'
import { isCheckoutListingAdmitted } from '../lib/checkout-market'

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
