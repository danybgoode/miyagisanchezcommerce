import { test, expect } from '@playwright/test'
import {
  orderStatusToToken,
  offerStatusToToken,
  offerQualityToToken,
  returnStatusToToken,
} from '../lib/status-badge'

/**
 * seller-portal-rails-foundation S1 · Story 1.1 — pure order-status→token
 * mapping (R1). No network; mirrors `ml-order-badge.spec.ts`'s pure-logic pattern.
 * Extended in S2 · Story 2.1 (adoption sweep) for the offer/quality/return
 * mappers the sweep added alongside — same file, same pure-logic pattern.
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

// The real vocabulary OfferInbox.tsx's `statusLabel`/`effectiveStatus` resolves to.
test.describe('status-badge · offerStatusToToken', () => {
  test('maps every known offer lifecycle status to a token', () => {
    expect(offerStatusToToken('pending')).toBe('warning')
    expect(offerStatusToToken('countered')).toBe('info')
    expect(offerStatusToToken('accepted')).toBe('success')
    expect(offerStatusToToken('declined')).toBe('neutral')
    expect(offerStatusToToken('expired')).toBe('neutral')
    expect(offerStatusToToken('paid')).toBe('success')
  })

  test('unknown statuses read as neutral, never a raw color', () => {
    expect(offerStatusToToken('some_future_status')).toBe('neutral')
    expect(offerStatusToToken('')).toBe('neutral')
  })
})

// `lib/offers.ts`'s `offerQuality()` green/amber/red → the same 5 semantic tokens.
test.describe('status-badge · offerQualityToToken', () => {
  test('maps every offer-quality color to a token', () => {
    expect(offerQualityToToken('green')).toBe('success')
    expect(offerQualityToToken('amber')).toBe('warning')
    expect(offerQualityToToken('red')).toBe('danger')
  })
})

// The real vocabulary OrderDetail.tsx's `RETURN_STATUS_META` resolves to.
test.describe('status-badge · returnStatusToToken', () => {
  test('maps every known return-request status to a token', () => {
    expect(returnStatusToToken('pending')).toBe('warning')
    expect(returnStatusToToken('accepted')).toBe('success')
    expect(returnStatusToToken('partial_refund')).toBe('info')
    expect(returnStatusToToken('declined')).toBe('danger')
    expect(returnStatusToToken('refunded')).toBe('success')
  })

  test('unknown statuses read as neutral, never a raw color', () => {
    expect(returnStatusToToken('some_future_status')).toBe('neutral')
    expect(returnStatusToToken('')).toBe('neutral')
  })
})
