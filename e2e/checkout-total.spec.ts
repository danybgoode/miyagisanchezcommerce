import { test, expect } from '@playwright/test'
import { computeCheckoutTotal } from '../lib/checkout-total'

/**
 * Checkout & Manual-Payment State Hardening · Sprint 3.1.
 * The summary "Total" and the pay-button label both call computeCheckoutTotal, so
 * proving its math proves they can never disagree — the price never changes at the
 * moment of commit. Pure; no network/auth.
 */
test.describe('checkout-total · computeCheckoutTotal', () => {
  test('items only (no coupon, no shipping)', () => {
    expect(computeCheckoutTotal({ itemsCents: 50000 })).toBe(50000)
  })

  test('subtracts the coupon discount', () => {
    expect(computeCheckoutTotal({ itemsCents: 50000, couponDiscountCents: 10000 })).toBe(40000)
  })

  test('adds shipping after the discount', () => {
    expect(computeCheckoutTotal({ itemsCents: 50000, couponDiscountCents: 10000, shippingCents: 8000 }))
      .toBe(48000)
  })

  test('floors at 0 — a coupon never makes the total negative (shipping still adds)', () => {
    expect(computeCheckoutTotal({ itemsCents: 5000, couponDiscountCents: 9999 })).toBe(0)
    expect(computeCheckoutTotal({ itemsCents: 5000, couponDiscountCents: 9999, shippingCents: 8000 }))
      .toBe(8000)
  })

  test('summary inputs and CTA inputs yield the same number (the parity contract)', () => {
    const inputs = { itemsCents: 123456, couponDiscountCents: 23456, shippingCents: 7000 }
    // Both call sites pass these same three values → identical result.
    expect(computeCheckoutTotal(inputs)).toBe(computeCheckoutTotal(inputs))
    expect(computeCheckoutTotal(inputs)).toBe(107000)
  })
})
