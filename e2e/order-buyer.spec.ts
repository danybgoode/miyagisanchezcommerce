import { expect, test } from '@playwright/test'
import { resolveBuyerClerkId } from '../lib/order-buyer'

/**
 * Pure-seam coverage for buyer-id resolution at Medusa-order dispatch sites
 * (epic 05 · buyer-notifications-money-path S1.2). No browser, no network —
 * proves the flag-off short-circuit and null-safety the ship-manual/ship/
 * return-request[requestId] routes rely on.
 */

test.describe('order-buyer · resolveBuyerClerkId', () => {
  test('flag off → null regardless of the raw value', () => {
    expect(resolveBuyerClerkId('user_abc123', false)).toBeNull()
    expect(resolveBuyerClerkId(null, false)).toBeNull()
    expect(resolveBuyerClerkId(undefined, false)).toBeNull()
  })

  test('flag on + a real value → the value', () => {
    expect(resolveBuyerClerkId('user_abc123', true)).toBe('user_abc123')
  })

  test('flag on + null/undefined (guest, or pre-S1.1 normalizer) → null', () => {
    expect(resolveBuyerClerkId(null, true)).toBeNull()
    expect(resolveBuyerClerkId(undefined, true)).toBeNull()
  })
})
