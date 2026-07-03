import { test, expect } from '@playwright/test'
import { buildMerchantCloseReceipt } from '../lib/promoter-close-receipt'

/**
 * Promoter Funnel v2 · Sprint 5 (US-5.5) — the merchant close-receipt content
 * builder (api project: pure logic, no network, no Supabase, no Resend).
 */

test.describe('promoter close receipt · buildMerchantCloseReceipt', () => {
  test('single item — subject + intro carry the shop name, item passes through', () => {
    const r = buildMerchantCloseReceipt({
      shopName: 'Café Don Memo',
      items: [{ label: 'Dominio propio (1 año)', amountMxn: '$499.00' }],
      claimUrl: 'https://dashboard.despachobonsai.com/onboarding/claim?token=abc',
      toMerchantDirectly: true,
    })
    expect(r.subject).toContain('Café Don Memo')
    expect(r.intro).toContain('Café Don Memo')
    expect(r.items).toHaveLength(1)
    expect(r.items[0].amountMxn).toBe('$499.00')
    expect(r.claimUrl).toBe('https://dashboard.despachobonsai.com/onboarding/claim?token=abc')
  })

  test('multiple items pass through in order (bundle-adjacent close)', () => {
    const r = buildMerchantCloseReceipt({
      shopName: 'Tienda Uno',
      items: [
        { label: 'Dominio propio (1 año)', amountMxn: '$499.00' },
        { label: 'Sincronización Mercado Libre (1 año)', amountMxn: '$299.00' },
      ],
      claimUrl: 'https://example.com/claim',
      toMerchantDirectly: true,
    })
    expect(r.items).toHaveLength(2)
    expect(r.items.map((i) => i.label)).toEqual(['Dominio propio (1 año)', 'Sincronización Mercado Libre (1 año)'])
  })

  test('a $0/free item carries amountMxn: null (UI renders GRATIS)', () => {
    const r = buildMerchantCloseReceipt({
      shopName: 'Tienda Gratis',
      items: [{ label: 'Subdominio propio (1 año)', amountMxn: null, note: 'Primer año GRATIS por promotor' }],
      claimUrl: 'https://example.com/claim',
      toMerchantDirectly: true,
    })
    expect(r.items[0].amountMxn).toBeNull()
    expect(r.items[0].note).toContain('GRATIS')
  })

  test('a print item carries edition-date / coverage-note fields via `note`', () => {
    const r = buildMerchantCloseReceipt({
      shopName: 'Tienda Impresa',
      items: [{
        label: 'Anuncio impreso — Plana completa',
        amountMxn: '$1,200.00',
        note: 'Distribución: 2026-08-01. Diseño pendiente de revisión.',
      }],
      claimUrl: 'https://example.com/claim',
      toMerchantDirectly: true,
    })
    expect(r.items[0].note).toContain('2026-08-01')
  })

  test('promoter-fallback copy adapts to "share with your merchant" framing', () => {
    const direct = buildMerchantCloseReceipt({
      shopName: 'Tienda X', items: [], claimUrl: 'https://x', toMerchantDirectly: true,
    })
    const fallback = buildMerchantCloseReceipt({
      shopName: 'Tienda X', items: [], claimUrl: 'https://x', toMerchantDirectly: false,
    })
    expect(direct.intro).not.toBe(fallback.intro)
    expect(fallback.intro).toMatch(/comerciante/i)
  })

  test('blank shop name falls back to a generic label, never empty', () => {
    const r = buildMerchantCloseReceipt({ shopName: '   ', items: [], claimUrl: 'https://x', toMerchantDirectly: true })
    expect(r.subject).toContain('tu tienda')
  })

  test('a promoter-typed shop name with HTML-special characters is escaped in the (raw-HTML) intro, never injected verbatim', () => {
    const r = buildMerchantCloseReceipt({
      shopName: '<img src=x onerror=alert(1)>Café & Co',
      items: [],
      claimUrl: 'https://x',
      toMerchantDirectly: true,
    })
    expect(r.intro).not.toContain('<img')
    expect(r.intro).toContain('&lt;img')
    expect(r.intro).toContain('Café &amp; Co')
  })
})
