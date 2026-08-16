import { expect, test } from '@playwright/test'
import { formatOrderCurrency } from '../lib/market-presentation'

/**
 * us-marketplace S4.3 — order, receipt, refund and email amounts render in the
 * currency's OWN locale (D9).
 *
 * The order surfaces had no `MarketPresentation` in hand, only an order row with a
 * `currency_code`, and they passed that currency to a HARDCODED `es-MX` locale with
 * `maximumFractionDigits: 0`. Under those options a $12.50 US receipt renders as
 * `USD 13` — Mexican convention, a currency code where a US buyer expects a symbol,
 * and the cents rounded away. A receipt that disagrees with the card statement is not
 * a formatting nit.
 *
 * One refund site was worse still: it hardcoded `currency: 'MXN'` outright, so a US
 * refund email would have quoted the buyer a peso figure for a dollar refund.
 */

test.describe('order amounts follow the money', () => {
  test('USD keeps its cents and its symbol', () => {
    expect(formatOrderCurrency(1250, 'usd')).toBe('$12.50')
    expect(formatOrderCurrency(1250, 'USD')).toBe('$12.50')
    // The exact shape the old hardcoding produced, now impossible.
    expect(formatOrderCurrency(1250, 'usd')).not.toMatch(/USD\s?13/)
  })

  test('a US refund is never quoted in pesos', () => {
    expect(formatOrderCurrency(4999, 'usd')).toBe('$49.99')
  })

  test('MXN keeps the whole-peso convention every existing call site asked for', () => {
    // `/mx` copy must not change. Whole pesos, no forced cents.
    expect(formatOrderCurrency(125000, 'mxn')).not.toMatch(/\.\d\d/)
    expect(formatOrderCurrency(125000, 'mxn')).toMatch(/1,?250/)
  })

  test('an absent currency stays MXN — the documented default, not a guess', () => {
    for (const empty of [null, undefined, '', '   ']) {
      expect(formatOrderCurrency(125000, empty)).toBe(formatOrderCurrency(125000, 'mxn'))
    }
  })

  test('callers may still override the digits without losing the locale', () => {
    expect(formatOrderCurrency(1250, 'usd', { maximumFractionDigits: 0 })).toBe('$13')
  })
})
