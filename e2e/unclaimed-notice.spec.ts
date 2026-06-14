import { test, expect } from '@playwright/test'
import { unclaimedNoticeModel } from '../lib/unclaimed-notice'

/**
 * PDP redesign (epic 01) — Sprint 5, S5.4 (unclaimed / imported listings).
 *
 * Pure-logic gate for the honest-notice copy + the claim href. No network / no
 * `next/*` — runs in the `api` gate. Buy/Offer/Cart suppression is owned upstream
 * by `isShopClaimed` (unchanged); this only proves the notice copy + that the
 * claim link matches SellerTrustCard's nudge href (`/s/<slug>/claim`).
 */

test.describe('unclaimed-notice · honest notice + claim (S5.4)', () => {
  test('builds the "aún no reclamada" notice with an honest body', () => {
    const m = unclaimedNoticeModel('mi-tienda')
    expect(m.title).toBe('Tienda aún no reclamada')
    expect(m.body).toContain('se importó')
    expect(m.body).toContain('se activan cuando el dueño reclame')
  })

  test('claim href targets the shop claim flow (matches SellerTrustCard)', () => {
    expect(unclaimedNoticeModel('mi-tienda').claimHref).toBe('/s/mi-tienda/claim')
    expect(unclaimedNoticeModel('otra').claimHref).toBe('/s/otra/claim')
  })

  test('claim label is the gratis nudge', () => {
    expect(unclaimedNoticeModel('x').claimLabel).toBe('¿Es tuya esta tienda? Reclama gratis')
  })
})
