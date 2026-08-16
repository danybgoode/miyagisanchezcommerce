import { expect, test } from '@playwright/test'
import { normalizeLocale } from '../lib/dictionary'
import {
  formatPresentationCurrency,
  formatPresentationDate,
  presentationCalendarDate,
  resolveMarketPresentation,
} from '../lib/market-presentation'

test.describe('market presentation · one market-derived locale context', () => {
  test('maps Mexico to the complete es-MX presentation contract', () => {
    expect(resolveMarketPresentation('mx')).toEqual({
      market: 'mx',
      htmlLang: 'es-MX',
      language: 'es',
      currency: 'MXN',
      timezone: 'America/Mexico_City',
    })
  })

  test('maps the United States to the complete en-US presentation contract', () => {
    expect(resolveMarketPresentation('us')).toEqual({
      market: 'us',
      htmlLang: 'en-US',
      language: 'en',
      currency: 'USD',
      timezone: 'America/New_York',
    })
  })

  test('rejects unknown markets instead of presenting them as Mexico', () => {
    expect(() => resolveMarketPresentation('ca')).toThrow(/Unsupported market/)
    expect(() => resolveMarketPresentation('en-US')).toThrow(/LOCALE/)
  })

  test('normalizes full BCP-47 tags without turning locale into a market decision', () => {
    expect(normalizeLocale('es-MX')).toBe('es')
    expect(normalizeLocale('en-US')).toBe('en')
    expect(normalizeLocale('en_US')).toBe('en')
    expect(normalizeLocale('fr-CA')).toBe('es')
  })

  test('currency and timezone remain market facts when locale-like values change', () => {
    const mx = resolveMarketPresentation('mx')
    const us = resolveMarketPresentation('us')
    expect(mx.currency).toBe('MXN')
    expect(us.currency).toBe('USD')
    expect(mx.timezone).not.toBe(us.timezone)
  })

  test('formats buyer money and dates from market presentation facts', () => {
    const mx = resolveMarketPresentation('mx')
    const us = resolveMarketPresentation('us')
    expect(formatPresentationCurrency(mx, 123400, 'MXN', { maximumFractionDigits: 0 })).toContain('$1,234')
    expect(formatPresentationCurrency(us, 123400, 'USD', { maximumFractionDigits: 0 })).toBe('$1,234')
    const instant = '2026-01-01T05:30:00.000Z'
    expect(presentationCalendarDate(mx, instant)).toBe('2025-12-31')
    expect(presentationCalendarDate(us, instant)).toBe('2026-01-01')
    expect(formatPresentationDate(us, instant, { year: 'numeric', month: 'short', day: 'numeric' })).toContain('Jan')
  })
})
