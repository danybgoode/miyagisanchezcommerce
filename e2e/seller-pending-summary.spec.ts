import { test, expect } from '@playwright/test'
import { pendingSummary, pendingSummaryText } from '../lib/seller-pending-summary'

/**
 * Pending-summary line (api gate, no browser). When seller-nav-consolidation S1.2
 * removed the dashboard's redundant nav row, the Pedidos/Ofertas pending badges
 * became this single compact es-MX line. The wording is pure, so its
 * singular/plural agreement and the "nothing pending → null" case are covered here
 * instead of in the JSX.
 */

test.describe('seller-pending-summary · pendingSummaryText', () => {
  test('returns null when nothing is pending', () => {
    expect(pendingSummaryText(0, 0)).toBeNull()
  })

  test('orders only — singular and plural', () => {
    expect(pendingSummaryText(1, 0)).toBe('1 pedido pendiente')
    expect(pendingSummaryText(3, 0)).toBe('3 pedidos pendientes')
  })

  test('offers only — singular and plural', () => {
    expect(pendingSummaryText(0, 1)).toBe('1 oferta pendiente')
    expect(pendingSummaryText(0, 4)).toBe('4 ofertas pendientes')
  })

  test('both present — joined with the combined plural suffix', () => {
    expect(pendingSummaryText(2, 1)).toBe('2 pedidos · 1 oferta pendientes')
    expect(pendingSummaryText(1, 1)).toBe('1 pedido · 1 oferta pendientes')
  })

  test('bad inputs coerce to zero (NaN / negative / fractional)', () => {
    expect(pendingSummaryText(Number.NaN, 0)).toBeNull()
    expect(pendingSummaryText(-5, 0)).toBeNull()
    expect(pendingSummaryText(2.9, 0)).toBe('2 pedidos pendientes')
  })
})

test.describe('seller-pending-summary · pendingSummary (routing)', () => {
  test('null when nothing is pending', () => {
    expect(pendingSummary(0, 0)).toBeNull()
  })

  test('each segment routes to its own section (offers → /offers, not /orders)', () => {
    expect(pendingSummary(0, 1)).toEqual({
      segments: [{ text: '1 oferta', href: '/shop/manage/offers' }],
      suffix: 'pendiente',
    })
    expect(pendingSummary(2, 0)).toEqual({
      segments: [{ text: '2 pedidos', href: '/shop/manage/orders' }],
      suffix: 'pendientes',
    })
  })

  test('both present — orders first, offers second, combined plural suffix', () => {
    expect(pendingSummary(2, 1)).toEqual({
      segments: [
        { text: '2 pedidos', href: '/shop/manage/orders' },
        { text: '1 oferta', href: '/shop/manage/offers' },
      ],
      suffix: 'pendientes',
    })
  })
})
