import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import {
  DEFAULT_SELLER_FORMAT_CONTEXT,
  createSellerFormat,
  sellerFormatContextForMarket,
} from '../lib/seller-format'

/**
 * The seller portal's numbers, dates and prices in BOTH languages.
 *
 * These assert the RENDERED STRING, never "a formatter was called": the defect
 * this module closes was invisible to every green gate precisely because the
 * formatters were being called — with `es-MX` welded into them, so an English
 * portal said "15 ago 2026" and "USD 1,234" under English labels.
 */

const MX_ES = sellerFormatContextForMarket('es', 'mx')
const MX_EN = sellerFormatContextForMarket('en', 'mx')
const US_ES = sellerFormatContextForMarket('es', 'us')
const US_EN = sellerFormatContextForMarket('en', 'us')

test.describe('seller format · the language moves, the money does not', () => {
  test('a date renders in the language the merchant chose', () => {
    const opts = { day: 'numeric', month: 'short', year: 'numeric' } as const
    expect(createSellerFormat(MX_ES).date('2026-08-15T18:30:00Z', opts)).toBe('15 ago 2026')
    expect(createSellerFormat(MX_EN).date('2026-08-15T18:30:00Z', opts)).toBe('Aug 15, 2026')
  })

  test('a price renders in the language, in the amount’s OWN currency', () => {
    const digits = { maximumFractionDigits: 0 } as const
    // Same pesos, two languages. `MX$` is en-US disambiguating a peso from a
    // dollar — the number and the denomination are both unchanged.
    expect(createSellerFormat(MX_ES).money(123_450, 'MXN', digits)).toBe('$1,235')
    expect(createSellerFormat(MX_EN).money(123_450, 'MXN', digits)).toBe('MX$1,235')
    // The reported symptom, in reverse: dollars under a Spanish portal are
    // disambiguated the same way, and under English they get the bare `$`.
    // es-MX separates the code from the digits with a NON-BREAKING space (U+00A0),
    // not an ASCII one. Spelling it out keeps the next reader from "fixing" it.
    expect(createSellerFormat(US_ES).money(123_450, 'USD', digits)).toBe('USD\u00a01,235')
    expect(createSellerFormat(US_EN).money(123_450, 'USD', digits)).toBe('$1,235')
  })

  test('THE REDENOMINATION GUARD: switching language never changes the currency', () => {
    // The failure this exists to catch is silent and total — an MX merchant
    // reading English must still be quoted pesos. Compare the resolved currency,
    // not the rendered string, so the assertion cannot pass on a symbol collision.
    expect(sellerFormatContextForMarket('en', 'mx').currency).toBe('MXN')
    expect(sellerFormatContextForMarket('es', 'us').currency).toBe('USD')
    expect(createSellerFormat(MX_EN).currency).toBe('MXN')
    expect(createSellerFormat(US_ES).currency).toBe('USD')

    // And the amount is not silently converted: 1234.50 of the shop's money is
    // the same 1234.50 in either language.
    for (const context of [MX_ES, MX_EN]) {
      expect(createSellerFormat(context).money(123_450)).toContain('1,234.50')
    }
  })

  test('the clock follows the market too, never the language', () => {
    expect(sellerFormatContextForMarket('en', 'mx').timeZone).toBe('America/Mexico_City')
    expect(sellerFormatContextForMarket('es', 'us').timeZone).toBe('America/New_York')

    // An MX shop's 18:30Z event is 12:30 local whichever language reads it.
    const at = (locale: 'es' | 'en') => {
      const fmt = createSellerFormat(sellerFormatContextForMarket(locale, 'mx'))
      return fmt.date('2026-08-15T18:30:00Z', { timeZone: fmt.timeZone, timeStyle: 'short', hour12: false })
    }
    expect(at('es')).toContain('12:30')
    expect(at('en')).toContain('12:30')
  })

  test('an explicit currency argument always beats the shop default', () => {
    // How the print edition and the promoter quote stay priced in pesos on a US
    // shop: they pass MXN, and nothing about the shop or the language overrides it.
    expect(createSellerFormat(US_EN).money(50_000, 'MXN', { maximumFractionDigits: 0 })).toBe('MX$500')
    expect(createSellerFormat(US_EN).money(50_000)).toBe('$500.00')
  })

  test('Spanish is the IDENTITY case — byte for byte what the hardcoded call sites produced', () => {
    // Every assertion below is the literal expression that lived at a call site
    // before this seam existed. If any of them drifts, the Spanish portal —
    // which is every merchant on the platform today — has silently changed.
    const es = createSellerFormat(MX_ES)
    expect(es.money(123_450, 'MXN', { maximumFractionDigits: 0 }))
      .toBe(new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(1234.5))
    expect(es.money(123_450, 'USD'))
      .toBe(new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'USD' }).format(1234.5))
    expect(es.date('2026-08-15T18:30:00Z', { day: 'numeric', month: 'long' }))
      .toBe(new Date('2026-08-15T18:30:00Z').toLocaleDateString('es-MX', { day: 'numeric', month: 'long' }))
    expect(es.date('2026-08-15T18:30:00Z', { dateStyle: 'medium', timeStyle: 'short' }))
      .toBe(new Date('2026-08-15T18:30:00Z').toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }))
    expect(es.number(1_234_567)).toBe((1_234_567).toLocaleString('es-MX'))
  })

  test('a relative time reads in the merchant\u2019s language, and only Spanish is unchanged', () => {
    const NOW = Date.parse('2026-08-15T12:00:00Z')
    const ago = (minutes: number) => new Date(NOW - minutes * 60_000)
    const es = createSellerFormat(MX_ES)
    const en = createSellerFormat(MX_EN)

    expect(es.relativeShort(ago(3), NOW)).toBe('Hace 3m')
    expect(en.relativeShort(ago(3), NOW)).toBe('3m ago')
    expect(es.relativeShort(ago(150), NOW)).toBe('Hace 2h')
    expect(en.relativeShort(ago(150), NOW)).toBe('2h ago')
    // Spanish pluralizes the noun, English the noun and nothing else \u2014 and the
    // singular day must not read "1 days".
    expect(es.relativeShort(ago(60 * 24), NOW)).toBe('Hace 1 día')
    expect(en.relativeShort(ago(60 * 24), NOW)).toBe('1 day ago')
    expect(es.relativeShort(ago(60 * 24 * 3), NOW)).toBe('Hace 3 días')
    expect(en.relativeShort(ago(60 * 24 * 3), NOW)).toBe('3 days ago')

    // Past the cutoff there is no useful relative phrasing \u2014 an absolute date,
    // still in the reader's language.
    expect(es.relativeShort(ago(60 * 24 * 40), NOW)).toBe('6 jul')
    expect(en.relativeShort(ago(60 * 24 * 40), NOW)).toBe('Jul 6')
  })

  test('an unparseable date degrades instead of throwing mid-render', () => {
    // `Intl.DateTimeFormat.format` throws a RangeError on an invalid Date; the
    // `toLocaleDateString` call sites this replaces returned "Invalid Date". A
    // crashed order page is a worse answer than an ugly one.
    expect(() => createSellerFormat(MX_ES).date('not-a-date', { day: 'numeric' })).not.toThrow()
  })

  test('a blank or missing currency falls back to the shop, never to a literal MXN', () => {
    for (const blank of [undefined, null, '', '  ']) {
      expect(createSellerFormat(US_EN).money(1_000, blank)).toBe('$10.00')
    }
    expect(createSellerFormat(US_EN).money(1_000, 'mxn')).toBe('MX$10.00')
  })

  test('the fallback context is the authored identity, not a fresh guess', () => {
    expect(DEFAULT_SELLER_FORMAT_CONTEXT).toEqual({
      locale: 'es', currency: 'MXN', timeZone: 'America/Mexico_City',
    })
    expect(createSellerFormat().date('2026-08-15T18:30:00Z', { day: 'numeric', month: 'short' }))
      .toBe('15 ago')
  })
})

/**
 * The source sweep.
 *
 * The pure factory above can be perfect while the portal ignores it — that is
 * exactly how the 31 hardcoded `es-MX` sites survived a fully translated portal
 * and 1902 dictionary keys. So this scans the SOURCE of every directory the
 * seller shell renders, not a manifest derived from it, and fails on a locale
 * welded into a call site.
 *
 * It allows the negation of what it bans: a call site that genuinely needs a
 * fixed locale (a machine-readable date, a spec fixture) says so with a
 * `seller-format-exempt` comment on the line or the line above, and passes. A
 * guard with no escape hatch is a guard people delete.
 */
const ROOT = path.resolve(import.meta.dirname, '..')
const PORTAL_DIRS = ['app/(shell)/shop/manage', 'app/(shell)/sell', 'components/seller']
const EXEMPT = 'seller-format-exempt'

/** `Intl.*Format('xx-YY'` / `.toLocale*String('xx-YY'` — a locale nailed to a call site. */
const HARDCODED_LOCALE = /(?:Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat)|\.toLocale(?:Date|Time)?String)\s*\(\s*['"`][a-z]{2}(?:[-_][A-Za-z0-9]+)?['"`]/
/** `.toLocaleDateString()` with NO locale — the BROWSER's language, which is nobody's decision. */
const IMPLICIT_LOCALE = /\.toLocale(?:Date|Time)?String\s*\(\s*\)/

function tsxFilesBelow(root: string): string[] {
  let stat
  try { stat = statSync(root) } catch { return [] }
  if (!stat.isDirectory()) return /\.tsx?$/.test(root) ? [root] : []
  return readdirSync(root).flatMap((name) => tsxFilesBelow(path.join(root, name)))
}

test.describe('seller format · no call site owns a locale of its own', () => {
  test('the portal source is swept, not a manifest derived from it', () => {
    const repoRoot = ROOT
    const scanned = PORTAL_DIRS.flatMap((dir) => tsxFilesBelow(path.join(repoRoot, dir)))
    // Three states, not two: an empty scan is "I could not check", never "clean".
    expect(scanned.length, 'portal directories moved — update PORTAL_DIRS').toBeGreaterThan(50)

    const offenders: string[] = []
    for (const file of scanned) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, index) => {
        if (!HARDCODED_LOCALE.test(line) && !IMPLICIT_LOCALE.test(line)) return
        if (line.includes(EXEMPT) || (lines[index - 1] ?? '').includes(EXEMPT)) return
        offenders.push(`${path.relative(repoRoot, file)}:${index + 1}  ${line.trim()}`)
      })
    }
    expect(offenders, `use useSellerFormat()/createSellerFormat() instead:\n${offenders.join('\n')}`).toEqual([])
  })

  test('the sweep actually detects both shapes it claims to', () => {
    // A guard nobody has seen reject anything is not known to guard anything.
    expect(HARDCODED_LOCALE.test("new Intl.NumberFormat('es-MX', { style: 'currency' })")).toBe(true)
    expect(HARDCODED_LOCALE.test("d.toLocaleDateString('en-US', { day: 'numeric' })")).toBe(true)
    expect(HARDCODED_LOCALE.test("n.toLocaleString('es-MX')")).toBe(true)
    expect(IMPLICIT_LOCALE.test('date.toLocaleTimeString()')).toBe(true)
    // …and passes the shape we are migrating TO, so it cannot reject correct code.
    expect(HARDCODED_LOCALE.test('fmt.money(cents, currency, { maximumFractionDigits: 0 })')).toBe(false)
    expect(HARDCODED_LOCALE.test("fmt.date(iso, { month: 'short' })")).toBe(false)
    expect(IMPLICIT_LOCALE.test('fmt.number(value)')).toBe(false)
  })
})
