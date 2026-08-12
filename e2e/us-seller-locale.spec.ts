import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from '@playwright/test'
import { resolveMarketPresentation } from '../lib/market-presentation'

/**
 * us-marketplace S5.1 (D17) — the seller's locale comes from MEDUSA, not the browser.
 *
 * The canonical seller projection carried no market at all, so any seller surface that
 * wanted to know reached for a locale instead. That is the defect D9 names outright:
 * `normalizeLocale('en-US')` returns `es`, so a US merchant's own dashboard would have
 * concluded it was Mexican. The market is a fact about the shop; the language is
 * derived from it, never the reverse.
 */

const root = process.cwd()
const source = (rel: string) => readFileSync(join(root, ...rel.split('/')), 'utf8')

/**
 * Source with comments removed.
 *
 * A ban on a code shape must never fire on the comment that EXPLAINS why the shape is
 * banned — the first version of the guard below reddened on this projection's own
 * docblock, which cites `normalizeLocale('en-US')` as the defect it closes. A guard
 * that rejects correct output is worse than one that misses a rare fault: it teaches
 * people to delete it (LEARNINGS).
 */
const code = (rel: string) =>
  source(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

test.describe('the seller projection carries its market', () => {
  test('MySeller exposes market, locale and currency', () => {
    const projection = source('lib/get-my-seller.ts')
    for (const field of ['market: MarketCode', 'locale: string', 'currency: string']) {
      expect(projection, field).toContain(field)
    }
  })

  test('the market is read from Medusa metadata, and derives the presentation', () => {
    const projection = source('lib/get-my-seller.ts')
    expect(projection).toMatch(/isMarketCode\(seller\.metadata\?\.operating_market\)/)
    expect(projection).toMatch(/resolveMarketPresentation\(market\)/)
    // The defect this closes: never infer the market from a locale, an
    // accept-language header, or a currency. Matched on CODE, not prose — the
    // projection's own docblock names `normalizeLocale` as the thing it fixes.
    expect(code('lib/get-my-seller.ts'))
      .not.toMatch(/normalizeLocale\(|headers\s*\[\s*['"]accept-language/i)
  })

  test('an unreadable market falls back to the documented default, not to a guess', () => {
    const projection = source('lib/get-my-seller.ts')
    expect(projection).toMatch(/:\s*DEFAULT_MARKET/)
  })
})

test.describe('presentation follows the market', () => {
  test('a US shop is en-US/USD and a Mexican shop is es-MX/MXN', () => {
    expect(resolveMarketPresentation('us')).toMatchObject({ language: 'en', currency: 'USD' })
    expect(resolveMarketPresentation('mx')).toMatchObject({ language: 'es', currency: 'MXN' })
  })

  test('the two markets never share a presentation', () => {
    const us = resolveMarketPresentation('us')
    const mx = resolveMarketPresentation('mx')
    expect(us.htmlLang).not.toBe(mx.htmlLang)
    expect(us.currency).not.toBe(mx.currency)
  })
})
