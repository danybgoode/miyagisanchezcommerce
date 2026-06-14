import { test, expect } from '@playwright/test'
import { eventHeroModel, MY_TICKETS_HREF } from '../lib/event-hero'

/**
 * PDP redesign (epic 01) — Sprint 5, S5.3 (events / boletos).
 *
 * Pure-logic gate for the event hero copy + the my-tickets link target. No
 * network / no `next/*` — runs in the `api` gate. The QR is reached by LINKING to
 * the buyer's order surface (not resolved inline on the PDP — see lib/event-hero.ts);
 * the purchase + QR after payment are a money/auth path owed to Daniel.
 */

test.describe('event-hero · ticket buy framing (S5.3)', () => {
  test('relabels the buy CTA to "Comprar boleto" + signed-out variant', () => {
    const m = eventHeroModel()
    expect(m.buyLabel).toBe('Comprar boleto')
    expect(m.signInLabel).toBe('Inicia sesión para comprar boleto')
  })

  test('"Ver mi boleto" points at the buyer order/ticket surface', () => {
    expect(eventHeroModel().myTicketsHref).toBe('/account/orders')
    expect(MY_TICKETS_HREF).toBe('/account/orders')
  })
})
