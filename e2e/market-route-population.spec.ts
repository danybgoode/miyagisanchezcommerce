import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  MARKET_PREFIXED_PATH_FAMILIES,
  isMarketPrefixablePath,
} from '../lib/market-url'

const ROOT = path.resolve(import.meta.dirname, '..')

function filesBelow(relativeDir: string): string[] {
  const root = path.join(ROOT, relativeDir)
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const absolute = path.join(root, entry)
    if (statSync(absolute).isDirectory()) out.push(...filesBelow(path.relative(ROOT, absolute)))
    else if (/\.(?:ts|tsx)$/.test(entry)) out.push(absolute)
  }
  return out
}

test.describe('market route population', () => {
  test('literal MX routes share the legacy page system while tenant routes remain present', () => {
    const required = [
      'app/(site)/page.tsx',
      'app/(site)/mx/page.tsx',
      'app/(site)/us/page.tsx',
      'app/(shell)/l/[id]/page.tsx',
      'app/(shell)/s/[slug]/page.tsx',
      'app/(shell)/c/[collection]/page.tsx',
      'app/(shell)/mx/l/page.tsx',
      'app/(shell)/mx/l/[id]/page.tsx',
      'app/(shell)/mx/s/[slug]/page.tsx',
    ]
    for (const file of required) expect(existsSync(path.join(ROOT, file)), file).toBe(true)

    expect(existsSync(path.join(ROOT, 'app/(shell)/mx/c/[collection]/page.tsx'))).toBe(false)
    expect(MARKET_PREFIXED_PATH_FAMILIES).toEqual(['/l', '/s'])
    expect(isMarketPrefixablePath('/c/editorial')).toBe(false)
  })

  test('the invitation market has exactly one static route, never a catalog subtree', () => {
    const usRoutes = filesBelow('app')
      .map((file) => path.relative(ROOT, file).replace(/\\/g, '/'))
      .filter((file) => /\/(?:us)(?:\/|$)/.test(file))
      .sort()

    // D9: directory absence is the guard. A later `/us/l`, `/us/s`, search, or
    // category folder cannot quietly become a plausible-but-empty US marketplace.
    expect(usRoutes).toEqual(['app/(site)/us/page.tsx'])
  })

  test('the root selector is a zero-catalog static surface', () => {
    const source = readFileSync(path.join(ROOT, 'app/(site)/page.tsx'), 'utf8')
    expect(source).toContain('data-testid="market-selector"')
    expect(source).toContain("href: marketBasePath('mx')")
    expect(source).toContain("href: marketBasePath('us')")
    expect(source).not.toMatch(/from ['"]@\/lib\/(?:listings|medusa|supabase)['"]/)
    expect(source).not.toMatch(/export const revalidate\s*=/)
  })

  test('platform-emitted absolute URLs never point at redirect sources', () => {
    const offenders = filesBelow('app').concat(filesBelow('lib')).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return /https:\/\/miyagisanchez\.com\/(?:l|s)(?:\/|['"`])|miyagisanchez\.com\/s\//.test(source)
        ? [path.relative(ROOT, file)]
        : []
    })
    expect(offenders).toEqual([])
  })

  test('platform component links never point at bare marketplace redirect sources', () => {
    const offenders = filesBelow('app').flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      return /href="\/l"|href=\{`\/l\/|href=\{`\/s\//.test(source)
        ? [path.relative(ROOT, file)]
        : []
    })
    expect(offenders).toEqual([])
  })

  test('the global cart always hops from tenant channels to canonical platform destinations', () => {
    const source = readFileSync(path.join(ROOT, 'app/components/CartDrawer.tsx'), 'utf8')
    expect(source).toContain('shopUrlFor(SITE_ORIGIN, seller.sellerSlug)')
    expect(source).toContain("marketplaceUrl(SITE_ORIGIN, '/l')")
    expect(source).toContain('`${SITE_ORIGIN}/checkout/bundle?sellerId=${encodeURIComponent(sellerId)}`')
    expect(source).not.toMatch(/href=\{?['"`]\/mx\//)
    expect(source).not.toMatch(/href=\{`\/checkout\/bundle/)
  })

  test('seller management success surfaces emit canonical marketplace shop URLs', () => {
    const seamBacked = [
      'app/(shell)/shop/manage/import/ImportClient.tsx',
      'app/(shell)/shop/manage/comparte/ComparteClient.tsx',
    ]
    for (const file of seamBacked) {
      const source = readFileSync(path.join(ROOT, file), 'utf8')
      expect(source, file).toContain('shopUrlFor(SITE_ORIGIN,')
      expect(source, file).not.toContain('window.location.origin')
    }

    const convocatoria = readFileSync(
      path.join(ROOT, 'app/(shell)/shop/manage/convocatoria/page.tsx'),
      'utf8',
    )
    expect(convocatoria).toContain(
      'marketplaceUrl(SITE_ORIGIN, `/s/${shop.slug}/convocatoria`)',
    )
    expect(convocatoria).not.toContain('publicUrl={`/mx/s/')

    const comparte = readFileSync(
      path.join(ROOT, 'app/(shell)/shop/manage/comparte/ComparteClient.tsx'),
      'utf8',
    )
    expect(comparte).not.toMatch(/(?:^|\s)\/s\/\{shopSlug\}/)
  })

  test('every literal MX shop route passes a market decision, not only a URL prefix', () => {
    const wrappers = filesBelow('app/(shell)/mx/s')
      .filter((file) => file.endsWith('/page.tsx'))
    expect(wrappers.length).toBeGreaterThan(5)
    const offenders = wrappers
      .filter((file) => !readFileSync(file, 'utf8').includes("market: 'mx'"))
      .map((file) => path.relative(ROOT, file))
    expect(offenders).toEqual([])
  })
})
