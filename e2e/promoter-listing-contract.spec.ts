import { test, expect } from '@playwright/test'
import { normalizePromoterListingContract, optionalTrimmedText } from '../lib/promoter-listing-contract'

test.describe('promoter close listing contract', () => {
  test('preserves the historic MXN-only caller', () => {
    expect(normalizePromoterListingContract({ price_mxn: 65 })).toEqual({
      currency: 'MXN', priceCents: 6500, quantity: 1,
    })
  })

  test('uses an explicit USD price and hydrated stock for a private preview', () => {
    expect(normalizePromoterListingContract({ price_mxn: 65, price: 29.99, currency: 'USD', quantity: 4 })).toEqual({
      currency: 'USD', priceCents: 2999, quantity: 4,
    })
  })

  test('does not create false inventory or a malformed price', () => {
    expect(normalizePromoterListingContract({ price: Infinity, currency: 'USD', quantity: -1 })).toEqual({
      currency: 'USD', priceCents: null, quantity: 1,
    })
    expect(normalizePromoterListingContract({ quantity: 0 })).toMatchObject({ quantity: 0 })
    expect(normalizePromoterListingContract(null)).toEqual({ currency: 'MXN', priceCents: null, quantity: 1 })
  })

  test('drops non-string or blank catalog decoration', () => {
    expect(optionalTrimmedText('  source value  ')).toBe('source value')
    expect(optionalTrimmedText('   ')).toBeNull()
    expect(optionalTrimmedText(123)).toBeNull()
  })
})
