import { test, expect } from '@playwright/test'
import { derivePdpBarMode, barHasPrimaryPurchase, type PdpBarInput, type PdpBarMode } from '../lib/pdp-bar'

/**
 * PDP redesign (epic 01) — Sprint 1, S1.1 + S1.3.
 *
 * Pure-logic guards on the PDP action-region state machine. No network, no auth,
 * no `next/*` — runs in the `api` gate. This is the single source of truth that
 * makes "one state at a time" (S1.1) and "one clear primary action" (S1.3)
 * spec-provable: the region renders the block for exactly the ONE mode this returns.
 */

const BUY: PdpBarInput = { showBuyButtons: true, isPrintPlacement: false, activeDealStatus: null }

test.describe('pdp-bar · one state at a time (S1.1)', () => {
  test('hidden when the buy region should not render', () => {
    expect(derivePdpBarMode({ ...BUY, showBuyButtons: false })).toBe('hidden')
    // a falsy `showBuyButtons` wins even with an active deal or print placement
    expect(derivePdpBarMode({ showBuyButtons: false, isPrintPlacement: true, activeDealStatus: 'pending' })).toBe('hidden')
  })

  test('a print placement funnels to the ad builder, not checkout', () => {
    expect(derivePdpBarMode({ ...BUY, isPrintPlacement: true })).toBe('print_placement')
  })

  test('each active-deal state maps to its own single mode', () => {
    expect(derivePdpBarMode({ ...BUY, activeDealStatus: 'accepted_unpaid' })).toBe('offer_accepted')
    expect(derivePdpBarMode({ ...BUY, activeDealStatus: 'pending' })).toBe('offer_pending')
    expect(derivePdpBarMode({ ...BUY, activeDealStatus: 'countered' })).toBe('offer_countered')
  })

  test('no in-flight offer → the buy path', () => {
    for (const status of [null, 'none', 'paid', 'expired'] as const) {
      expect(derivePdpBarMode({ ...BUY, activeDealStatus: status })).toBe('buy')
    }
  })

  test('returns exactly one known mode for every input (never stacked)', () => {
    const modes: PdpBarMode[] = ['offer_accepted', 'offer_pending', 'offer_countered', 'print_placement', 'buy', 'hidden']
    const statuses = [null, 'none', 'pending', 'countered', 'accepted_unpaid', 'paid', 'expired'] as const
    for (const showBuyButtons of [true, false]) {
      for (const isPrintPlacement of [true, false]) {
        for (const activeDealStatus of statuses) {
          const mode = derivePdpBarMode({ showBuyButtons, isPrintPlacement, activeDealStatus })
          expect(modes).toContain(mode)
        }
      }
    }
  })
})

test.describe('pdp-bar · one clear primary action (S1.3)', () => {
  test('only buy + accepted-offer expose a primary purchase CTA', () => {
    expect(barHasPrimaryPurchase('buy')).toBe(true)
    expect(barHasPrimaryPurchase('offer_accepted')).toBe(true)
  })

  test('an offer in flight shows NO buy button (status only)', () => {
    expect(barHasPrimaryPurchase('offer_pending')).toBe(false)
    expect(barHasPrimaryPurchase('offer_countered')).toBe(false)
    expect(barHasPrimaryPurchase('print_placement')).toBe(false)
    expect(barHasPrimaryPurchase('hidden')).toBe(false)
  })
})
