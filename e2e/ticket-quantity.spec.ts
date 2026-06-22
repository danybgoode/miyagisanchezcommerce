import { test, expect } from '@playwright/test'
import { clampTicketQuantity, ticketQuantityCap, ticketTotalLabel } from '../lib/ticket-quantity'

/**
 * Events: quantity selector · S1.2 — the pure clamp/cap/label seam shared by the
 * PDP stepper, the /checkout page, and the UCP checkout-session. Proving the math
 * here means the web buyer and an AI agent can never disagree on the cap. Pure;
 * no network/auth.
 */
test.describe('ticket-quantity · cap + clamp', () => {
  test('flag OFF caps everything at 1 (today\'s behavior)', () => {
    expect(ticketQuantityCap({ available: 99, enabled: false })).toBe(1)
    expect(clampTicketQuantity(5, { available: 99, enabled: false })).toBe(1)
  })

  test('flag ON: cap = remaining seats', () => {
    expect(ticketQuantityCap({ available: 5, enabled: true })).toBe(5)
    expect(clampTicketQuantity(3, { available: 5, enabled: true })).toBe(3)
  })

  test('clamps a request above the remaining seats down to the cap', () => {
    expect(clampTicketQuantity(8, { available: 5, enabled: true })).toBe(5)
  })

  test('floors at 1 — zero, negative, or junk become 1', () => {
    expect(clampTicketQuantity(0, { available: 5, enabled: true })).toBe(1)
    expect(clampTicketQuantity(-3, { available: 5, enabled: true })).toBe(1)
    expect(clampTicketQuantity('abc', { available: 5, enabled: true })).toBe(1)
  })

  test('1 seat left → cap 1 (no over-stock option)', () => {
    expect(ticketQuantityCap({ available: 1, enabled: true })).toBe(1)
    expect(clampTicketQuantity(2, { available: 1, enabled: true })).toBe(1)
  })

  test('sold out (0 left) still floors the cap at 1', () => {
    // The PDP suppresses the stepper at cap <= 1; the clamp never returns < 1.
    expect(ticketQuantityCap({ available: 0, enabled: true })).toBe(1)
  })

  test('untracked inventory (null) is unbounded but ≥ 1 when enabled', () => {
    expect(ticketQuantityCap({ available: null, enabled: true })).toBe(Number.MAX_SAFE_INTEGER)
    expect(clampTicketQuantity(50, { available: null, enabled: true })).toBe(50)
  })
})

test.describe('ticket-quantity · label math', () => {
  test('quantity 1 → just the unit price', () => {
    expect(ticketTotalLabel(25000, 1, 'MXN')).toBe('$250.00')
  })

  test('quantity N → spells out N × unit = total', () => {
    expect(ticketTotalLabel(25000, 3, 'MXN')).toBe('3 × $250.00 = $750.00')
  })
})
