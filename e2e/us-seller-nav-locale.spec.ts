import { readFileSync } from 'fs'
import { join } from 'path'
import { expect, test } from '@playwright/test'
import {
  SELLER_NAV,
  SELLER_NAV_MOBILE_OVERFLOW_GROUPS,
  SELLER_NAV_MOBILE_PRIMARY,
  localizeSellerNav,
  localizeSellerNavEntries,
  sellerNavLabels,
} from '../lib/seller-nav'

/**
 * us-marketplace S5.1 (D17) — the seller rail is the frame a merchant sees on EVERY
 * page of their portal, so it is where an untranslated portal is most obviously
 * untranslated.
 *
 * Localizing is a TRANSFORM over the one nav tree, never a parallel English tree: a
 * second tree would drift the moment someone added a page to only one of them, and the
 * drift would be invisible because each renders fine alone.
 */

const source = (rel: string) => readFileSync(join(process.cwd(), ...rel.split('/')), 'utf8')

test.describe('seller nav localization', () => {
  test('a US shop gets English labels', () => {
    const groups = localizeSellerNav(SELLER_NAV, 'us')
    const labels = groups.flatMap((g) => [g.label, ...g.entries.map((e) => e.label)])
    expect(labels).toContain('Orders')
    expect(labels).toContain('Overview')
    expect(labels).toContain('Settings')
    expect(labels).toContain('Earnings')
    // No Spanish leaks into a US merchant's own chrome.
    expect(labels.join(' ')).not.toMatch(/[áéíóúñ¿¡]/i)
  })

  test('a Mexican shop is unchanged, character for character', () => {
    // `/mx` copy must not move. Compared against the ORIGINAL constants, so this
    // fails if the transform touches anything at all for MX.
    expect(localizeSellerNav(SELLER_NAV, 'mx')).toEqual(SELLER_NAV)
    expect(localizeSellerNavEntries(SELLER_NAV_MOBILE_PRIMARY, 'mx')).toEqual(SELLER_NAV_MOBILE_PRIMARY)
    expect(localizeSellerNav(SELLER_NAV_MOBILE_OVERFLOW_GROUPS, 'mx')).toEqual(SELLER_NAV_MOBILE_OVERFLOW_GROUPS)
  })

  test('structure, hrefs, icons and flag gating are identical across languages', () => {
    // The whole reason this is a transform: only the words may differ.
    const es = localizeSellerNav(SELLER_NAV, 'mx')
    const en = localizeSellerNav(SELLER_NAV, 'us')
    expect(en.length).toBe(es.length)
    for (const [i, group] of en.entries()) {
      expect(group.key).toBe(es[i].key)
      expect(group.entries.map((e) => e.href)).toEqual(es[i].entries.map((e) => e.href))
      expect(group.entries.map((e) => e.icon)).toEqual(es[i].entries.map((e) => e.icon))
      expect(group.entries.map((e) => e.flag)).toEqual(es[i].entries.map((e) => e.flag))
      expect(group.entries.map((e) => e.key)).toEqual(es[i].entries.map((e) => e.key))
    }
  })

  test('every label has a translation — no half-English rail', () => {
    const en = localizeSellerNav(SELLER_NAV, 'us')
      .flatMap((g) => [g.label, ...g.entries.map((e) => e.label)])
    const es = new Set<string>(Object.values(sellerNavLabels('mx')))
    // A missing key would pass the untranslated Spanish through silently.
    for (const label of en) {
      // "Mercado Libre" is a brand and stays as authored (AGENTS.md rule 5).
      if (label === 'Mercado Libre') continue
      expect({ label, untranslated: es.has(label) }).toEqual({ label, untranslated: false })
    }
  })

  test('both label tables cover exactly the same keys', () => {
    expect(Object.keys(sellerNavLabels('us')).sort()).toEqual(Object.keys(sellerNavLabels('mx')).sort())
  })

  test('an unknown market falls back to es — the documented default', () => {
    expect(sellerNavLabels()).toEqual(sellerNavLabels('mx'))
  })
})

test.describe('the market reaches the rail from Medusa', () => {
  test('the shell reads the seller projection, not the Supabase mirror', () => {
    // The mirror is explicitly not authoritative for `operating_market`; reading it
    // would make the portal's language depend on whether a sync had run.
    const chrome = source('app/(shell)/shop/manage/_components/SellerShellChrome.tsx')
    expect(chrome).toMatch(/const seller = await getMySeller\(\)/)
    expect(chrome).toMatch(/const market = seller\?\.market \?\? 'mx'/)
    expect(chrome).toMatch(/market=\{market\}/)
  })

  test('the rail localizes what it renders, not a separate tree', () => {
    const nav = source('app/(shell)/shop/manage/SellerNav.tsx')
    expect(nav).toMatch(/localizeSellerNav\(filterNavByEnabledFlags\(SELLER_NAV, enabledFlags\), market\)/)
    // The aria-label is chrome too — a screen-reader user gets their own language.
    expect(nav).toMatch(/market === 'us' \? 'Seller navigation' : 'Navegación de vendedor'/)
  })
})
