import { test, expect } from '@playwright/test'
import {
  MAX_PROMOTER_SHOP_DESCRIPTION_LENGTH,
  readPromoterSetupDescription,
  readPromoterSetupMarket,
} from '../lib/promoter-setup-market'

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

  test('accepts a trimmed description within the bounded Medusa contract', () => {
    expect(readPromoterSetupDescription('  Small-batch accessories.  ')).toEqual({ ok: true, value: 'Small-batch accessories.' })
    expect(readPromoterSetupDescription(undefined)).toEqual({ ok: true, value: null })
  })

  test('refuses malformed or oversized descriptions before they reach Medusa', () => {
    expect(readPromoterSetupDescription(42)).toEqual({ ok: false })
    expect(readPromoterSetupDescription('x'.repeat(MAX_PROMOTER_SHOP_DESCRIPTION_LENGTH + 1))).toEqual({ ok: false })
  })
})
