import { expect, test } from '@playwright/test'
import {
  isActionable,
  deriveOfferAlerts,
  MAX_OFFER_ALERTS,
  type OfferAlertInput,
} from '../lib/home-offer-alert'

/**
 * Homepage Polish — Dirección B · Sprint 4: the pending-offer alert rules live in
 * the next-free `lib/home-offer-alert.ts` seam, so this proves "is-actionable / max 2
 * / buyer-vs-seller" without auth/network — the homepage only adds the Supabase reads
 * that feed `deriveOfferAlerts`.
 */

const NOW = Date.parse('2026-06-12T12:00:00Z')
const HOUR = 3_600_000

function makeInput(p: Partial<OfferAlertInput> & { offerId: string }): OfferAlertInput {
  return {
    offerId: p.offerId,
    conversationId: p.conversationId === undefined ? `conv_${p.offerId}` : p.conversationId,
    perspective: p.perspective ?? 'buyer',
    status: p.status ?? 'pending',
    expiresAt: p.expiresAt ?? new Date(NOW + 24 * HOUR).toISOString(),
    amountCents: p.amountCents ?? 50000,
    currency: p.currency ?? 'MXN',
    listingTitle: p.listingTitle ?? 'Bicicleta de montaña',
    shopName: p.shopName ?? 'Tienda de Ana',
  }
}

test.describe('home-offer-alert · is-actionable', () => {
  test('a pending, not-expired offer is actionable (buyer and seller)', () => {
    expect(isActionable(makeInput({ offerId: 'b', perspective: 'buyer' }), NOW)).toBe(true)
    expect(isActionable(makeInput({ offerId: 's', perspective: 'seller' }), NOW)).toBe(true)
  })

  test('a pending offer past its expires_at is NOT actionable', () => {
    const expired = makeInput({ offerId: 'x', expiresAt: new Date(NOW - HOUR).toISOString() })
    expect(isActionable(expired, NOW)).toBe(false)
  })

  test('terminal/non-pending statuses are never actionable', () => {
    for (const status of ['accepted', 'declined', 'countered', 'paid', 'withdrawn', 'expired'] as const) {
      expect(isActionable(makeInput({ offerId: status, status }), NOW)).toBe(false)
    }
  })
})

test.describe('home-offer-alert · deriveOfferAlerts', () => {
  test('filters out non-actionable and keeps actionable ones', () => {
    const alerts = deriveOfferAlerts([
      makeInput({ offerId: 'live' }),
      makeInput({ offerId: 'paid', status: 'paid' }),
      makeInput({ offerId: 'gone', expiresAt: new Date(NOW - HOUR).toISOString() }),
    ], NOW)
    expect(alerts.map(a => a.offerId)).toEqual(['live'])
  })

  test('caps at MAX_OFFER_ALERTS (2), soonest-deadline first', () => {
    const inputs = [
      makeInput({ offerId: 'late', expiresAt: new Date(NOW + 40 * HOUR).toISOString() }),
      makeInput({ offerId: 'soon', expiresAt: new Date(NOW + 2 * HOUR).toISOString() }),
      makeInput({ offerId: 'mid', expiresAt: new Date(NOW + 10 * HOUR).toISOString() }),
    ]
    const alerts = deriveOfferAlerts(inputs, NOW)
    expect(alerts.length).toBe(MAX_OFFER_ALERTS)
    expect(alerts.map(a => a.offerId)).toEqual(['soon', 'mid'])
  })

  test('renders nothing when nothing is actionable', () => {
    expect(deriveOfferAlerts([makeInput({ offerId: 'paid', status: 'paid' })], NOW)).toEqual([])
    expect(deriveOfferAlerts([], NOW)).toEqual([])
  })
})

test.describe('home-offer-alert · buyer vs seller copy', () => {
  test('buyer copy says "sigue pendiente" and includes the shop in the subtitle', () => {
    const [alert] = deriveOfferAlerts([
      makeInput({ offerId: 'b', perspective: 'buyer', amountCents: 50000, listingTitle: 'Bici', shopName: 'Tienda de Ana' }),
    ], NOW)
    expect(alert.title).toContain('sigue pendiente')
    expect(alert.title).toContain('$500')
    expect(alert.subtitle).toBe('Bici · Tienda de Ana')
  })

  test('seller copy says "por responder" and omits the shop from the subtitle', () => {
    const [alert] = deriveOfferAlerts([
      makeInput({ offerId: 's', perspective: 'seller', listingTitle: 'Bici', shopName: 'Mi tienda' }),
    ], NOW)
    expect(alert.title).toContain('por responder')
    expect(alert.subtitle).toBe('Bici')
  })

  test('deep-links to the conversation thread when present, else the inbox', () => {
    const [withConv] = deriveOfferAlerts([makeInput({ offerId: 'c', conversationId: 'conv_42' })], NOW)
    expect(withConv.href).toBe('/messages/conv_42')

    const [sellerNoConv] = deriveOfferAlerts([
      makeInput({ offerId: 's', perspective: 'seller', conversationId: null }),
    ], NOW)
    expect(sellerNoConv.href).toBe('/shop/manage/offers')
  })
})
