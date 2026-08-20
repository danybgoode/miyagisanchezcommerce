import { test, expect } from '@playwright/test'
import { readPromoterSetupMarket } from '../lib/promoter-setup-market'

test.describe('promoter shop setup operating market', () => {
  test('preserves the established default only when the market is omitted', () => {
    expect(readPromoterSetupMarket(undefined)).toBeNull()
  })

  test('normalizes each supported operating market for the seller mint seam', () => {
    expect(readPromoterSetupMarket(' mx ')).toBe('mx')
    expect(readPromoterSetupMarket('US')).toBe('us')
  })

  test('refuses an explicit unknown market instead of defaulting it to Mexico', () => {
    expect(readPromoterSetupMarket('ca')).toBe('invalid')
    expect(readPromoterSetupMarket('en-US')).toBe('invalid')
    expect(readPromoterSetupMarket(null)).toBe('invalid')
  })
})
