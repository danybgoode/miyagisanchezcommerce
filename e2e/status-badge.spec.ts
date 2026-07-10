import { test, expect } from '@playwright/test'
import { orderStatusToToken } from '../lib/status-badge'

/**
 * seller-portal-rails-foundation S1 · Story 1.1 — pure order-status→token
 * mapping (R1). No network; mirrors `ml-order-badge.spec.ts`'s pure-logic pattern.
 */

test.describe('status-badge · orderStatusToToken', () => {
  test('maps every known order lifecycle status to its R1 token', () => {
    expect(orderStatusToToken('pending_payment')).toBe('warning')
    expect(orderStatusToToken('paid')).toBe('success')
    expect(orderStatusToToken('processing')).toBe('info')
    expect(orderStatusToToken('shipped')).toBe('info')
    expect(orderStatusToToken('in_transit')).toBe('info')
    expect(orderStatusToToken('delivered')).toBe('success')
    expect(orderStatusToToken('fulfilled')).toBe('success')
    expect(orderStatusToToken('completed')).toBe('neutral')
    expect(orderStatusToToken('refunded')).toBe('danger')
    expect(orderStatusToToken('canceled')).toBe('danger')
    expect(orderStatusToToken('cancelled')).toBe('danger')
  })

  test('unknown statuses read as neutral, never a raw color', () => {
    expect(orderStatusToToken('some_future_status')).toBe('neutral')
    expect(orderStatusToToken('')).toBe('neutral')
  })
})
