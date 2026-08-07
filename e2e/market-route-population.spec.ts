import { test, expect } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  MARKET_PREFIXED_PATH_FAMILIES,
  isMarketPrefixablePath,
} from '../lib/market-url'
import { MARKET_CODES, marketBasePath } from '../lib/markets'

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
    // The honest no-catalog proof is the absence of a data import. This spec used
    // to ALSO assert `not.toMatch(/export const revalidate/)`, using "no
    // revalidate" as a proxy for "no data reads" — and that proxy pinned a live
    // defect in place: no `revalidate` means Next serves `s-maxage=31536000`, the
    // edge pinned `/` for a week, and its build-hashed CSS 404'd into an unstyled
    // homepage. Data-freshness and asset-freshness are different needs; only the
    // import check speaks to the first.
    expect(source).not.toMatch(/from ['"]@\/lib\/(?:listings|medusa|supabase)['"]/)
  })

  test('every static market surface bounds its CDN TTL', () => {
    // Guard the population, not just the page that broke. A prerendered page with
    // no `revalidate` is served with a ONE-YEAR `s-maxage`, so a CDN can keep
    // serving HTML that references `/_next/static/chunks/*` hashes deleted by the
    // next deploy. `/` shipped that way and broke in production 2026-08-06; `/us`
    // had the identical defect and was spared only by edge-cache luck.
    //
    // A page that genuinely must render per-request opts out with `dynamic` —
    // banning one thing without allowing its negation trains people to bypass the
    // guard (Roadmap/LEARNINGS.md).
    const offenders = filesBelow('app/(site)')
      .filter((file) => file.endsWith('/page.tsx'))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8')
        const relative = path.relative(ROOT, file).replace(/\\/g, '/')
        if (/export const dynamic\s*=/.test(source)) return []
        const declared = /export const revalidate\s*=\s*(\d+)/.exec(source)
        if (!declared) return [`${relative} (no revalidate — inherits s-maxage=31536000)`]
        // An hour is already far longer than a deploy takes to delete the old chunks.
        const seconds = Number(declared[1])
        return seconds > 3600 ? [`${relative} (revalidate=${seconds} exceeds 3600)`] : []
      })
    expect(offenders).toEqual([])
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

test.describe('post-authentication destination', () => {
  // `/` is the country SELECTOR. Clerk's signInFallbackRedirectUrl defaults to
  // `/`, so omitting it silently lands every freshly-signed-in user on a country
  // picker — which is what production did until 2026-08-06. The env var that
  // looked like it configured this (NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL) does not
  // exist in @clerk/nextjs v7, so the value must live in the layout.
  test('sign-in lands on a market, never back on the selector', () => {
    const source = readFileSync(path.join(ROOT, 'app/layout.tsx'), 'utf8')

    const home = /const POST_AUTH_HOME = '([^']+)'/.exec(source)
    expect(home, 'POST_AUTH_HOME must stay a single named destination').not.toBeNull()
    expect(home![1]).not.toBe('/')
    expect(MARKET_CODES.some((code) => home![1] === marketBasePath(code))).toBe(true)

    // Both halves wired, or a signed-up user still strands on the selector.
    expect(source).toContain('signInFallbackRedirectUrl={POST_AUTH_HOME}')
    expect(source).toContain('signUpFallbackRedirectUrl={POST_AUTH_HOME}')

    // FALLBACK, not FORCE — force overrides `redirect_url` and would break the
    // "sign in to continue" hop back into checkout.
    expect(source).not.toMatch(/sign(?:In|Up)ForceRedirectUrl/)
  })
})
