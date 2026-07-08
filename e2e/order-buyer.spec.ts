import { expect, test } from '@playwright/test'
import { resolveBuyerClerkId, stripBuyerClerkId } from '../lib/order-buyer'

/**
 * Pure-seam coverage for buyer-id resolution at Medusa-order dispatch sites
 * (epic 05 · buyer-notifications-money-path S1.2). No browser, no network —
 * proves the flag-off short-circuit and null-safety the ship-manual/ship/
 * return-request[requestId] routes rely on, and the client-boundary strip
 * the seller orders list/detail pages rely on (cross-agent review finding).
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

test.describe('order-buyer · stripBuyerClerkId', () => {
  test('removes buyer_clerk_user_id, keeps every other field', () => {
    const out = stripBuyerClerkId({ id: 'order_1', buyer_clerk_user_id: 'user_abc123', buyer_email: 'a@b.com' })
    expect(out).toEqual({ id: 'order_1', buyer_email: 'a@b.com' })
    expect('buyer_clerk_user_id' in out).toBe(false)
  })

  test('is a no-op when the field is already absent', () => {
    const out = stripBuyerClerkId({ id: 'order_1', buyer_email: 'a@b.com' })
    expect(out).toEqual({ id: 'order_1', buyer_email: 'a@b.com' })
  })
})
