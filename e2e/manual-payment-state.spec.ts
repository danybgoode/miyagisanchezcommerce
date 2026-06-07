import { test, expect } from '@playwright/test'
import {
  deriveManualPaymentState,
  manualPaymentStateFromOrder,
  canTransition,
  isManualPaymentMethod,
  whoActsNext,
  manualPaymentBadge,
  canSellerShip,
  SHIP_BLOCKED_REASON,
  type ManualPaymentState,
} from '../lib/manual-payment-state'

/**
 * Checkout & Manual-Payment State Hardening · Sprint 1.1.
 * Pure-logic guards on the manual-payment vocabulary every surface (buyer, seller,
 * inbox, agents) trusts. No network; deterministic.
 */

test.describe('manual-payment-state · method detection', () => {
  test('recognises the manual rail, rejects card rails', () => {
    for (const m of ['manual', 'spei', 'cash', 'dimo']) expect(isManualPaymentMethod(m)).toBe(true)
    for (const m of ['stripe', 'mp', '', null, undefined]) expect(isManualPaymentMethod(m)).toBe(false)
  })
})

test.describe('manual-payment-state · derivation precedence', () => {
  test('nothing reported or confirmed → pending_payment', () => {
    expect(deriveManualPaymentState({})).toBe('pending_payment')
  })

  test('buyer reported but not confirmed → buyer_reported_paid', () => {
    expect(deriveManualPaymentState({ buyerReportedPaid: true })).toBe('buyer_reported_paid')
  })

  test('confirmation wins over a buyer report → payment_confirmed', () => {
    expect(deriveManualPaymentState({ buyerReportedPaid: true, paymentConfirmed: true }))
      .toBe('payment_confirmed')
  })

  test('confirmed + fulfillment started → processing', () => {
    expect(deriveManualPaymentState({ paymentConfirmed: true, fulfillmentStarted: true }))
      .toBe('processing')
  })
})

test.describe('manual-payment-state · derive from a (normalized) order', () => {
  test('non-manual order → null (callers skip the manual UI)', () => {
    expect(manualPaymentStateFromOrder({ payment_method: 'stripe', status: 'paid' })).toBeNull()
  })

  test('manual order, unpaid → pending_payment', () => {
    expect(manualPaymentStateFromOrder({ payment_method: 'spei', status: 'pending_payment' }))
      .toBe('pending_payment')
  })

  test('reads buyer_reported_paid from the flat field OR metadata', () => {
    expect(manualPaymentStateFromOrder({ payment_method: 'spei', buyer_reported_paid: true }))
      .toBe('buyer_reported_paid')
    expect(manualPaymentStateFromOrder({ payment_method: 'spei', metadata: { buyer_reported_paid: true } }))
      .toBe('buyer_reported_paid')
  })

  test('seller confirmation surfaces as payment_confirmed', () => {
    expect(manualPaymentStateFromOrder({ payment_method: 'cash', payment_received: true }))
      .toBe('payment_confirmed')
  })

  test('confirmed + shipped → processing', () => {
    expect(manualPaymentStateFromOrder({ payment_method: 'spei', payment_received: true, status: 'shipped' }))
      .toBe('processing')
  })
})

test.describe('manual-payment-state · transition guards', () => {
  test('legal forward moves are allowed', () => {
    expect(canTransition('pending_payment', 'buyer_reported_paid')).toBe(true)
    expect(canTransition('pending_payment', 'payment_confirmed')).toBe(true) // seller confirms directly
    expect(canTransition('buyer_reported_paid', 'payment_confirmed')).toBe(true)
    expect(canTransition('payment_confirmed', 'processing')).toBe(true)
  })

  test('skipping confirmation is rejected (the core guard)', () => {
    expect(canTransition('pending_payment', 'processing')).toBe(false)
    expect(canTransition('buyer_reported_paid', 'processing')).toBe(false)
  })

  test('no moves out of the terminal processing state', () => {
    for (const to of ['pending_payment', 'buyer_reported_paid', 'payment_confirmed'] as ManualPaymentState[]) {
      expect(canTransition('processing', to)).toBe(false)
    }
  })

  test('a no-op (same state) is always allowed', () => {
    expect(canTransition('pending_payment', 'pending_payment')).toBe(true)
  })

  test('false-alarm revert is allowed', () => {
    expect(canTransition('buyer_reported_paid', 'pending_payment')).toBe(true)
  })
})

test.describe('manual-payment-state · copy is complete for every state + role', () => {
  const states: ManualPaymentState[] = [
    'pending_payment', 'buyer_reported_paid', 'payment_confirmed', 'processing',
  ]
  test('whoActsNext + badge resolve to non-empty es-MX strings', () => {
    for (const s of states) {
      expect(whoActsNext(s, 'buyer')).toBeTruthy()
      expect(whoActsNext(s, 'seller')).toBeTruthy()
      expect(manualPaymentBadge(s)).toBeTruthy()
    }
  })

  test('the spine copy matches the agreed vocabulary', () => {
    expect(whoActsNext('pending_payment', 'buyer')).toBe('Paga ahora')
    expect(whoActsNext('pending_payment', 'seller')).toBe('Esperando pago')
    expect(whoActsNext('buyer_reported_paid', 'buyer')).toBe('Avisaste — el vendedor verifica')
    expect(whoActsNext('buyer_reported_paid', 'seller')).toBe('Verifica el pago reportado')
  })
})

test.describe('manual-payment-state · ship gate (S2)', () => {
  test('card / MP orders are always shippable (captured at checkout)', () => {
    expect(canSellerShip({ payment_method: 'stripe' })).toBe(true)
    expect(canSellerShip({ payment_method: 'mp', payment_received: false })).toBe(true)
    expect(canSellerShip({})).toBe(true) // unknown method → not manual → not gated
  })

  test('a manual order is blocked until payment is confirmed', () => {
    expect(canSellerShip({ payment_method: 'spei' })).toBe(false)
    expect(canSellerShip({ payment_method: 'spei', payment_received: false })).toBe(false)
    // a buyer report alone does NOT unblock — only seller confirmation does
    expect(canSellerShip({ payment_method: 'spei', metadata: { buyer_reported_paid: true } })).toBe(false)
  })

  test('a confirmed manual order is shippable (flat field OR metadata)', () => {
    expect(canSellerShip({ payment_method: 'cash', payment_received: true })).toBe(true)
    expect(canSellerShip({ payment_method: 'dimo', metadata: { payment_received: true } })).toBe(true)
  })

  test('the blocked reason is a non-empty es-MX string', () => {
    expect(SHIP_BLOCKED_REASON).toContain('pago')
  })
})
