import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  MARKET_LANDING_PAGES,
  marketCatalogCanonical,
  marketLandingMetadata,
  rootSelectorMetadata,
  selectorMetadata,
} from '../lib/market-seo'
import { platformSitemapUrls } from '../lib/market-sitemap'

const ROOT = path.resolve(import.meta.dirname, '..')

test.describe('market SEO contract', () => {
  test('landing alternates name only real pages and keep locale separate from market', () => {
    expect(MARKET_LANDING_PAGES).toEqual(['mx', 'us'])
    expect(existsSync(path.join(ROOT, 'app/(mx-site)/mx/page.tsx')), 'mx').toBe(true)
    expect(existsSync(path.join(ROOT, 'app/(us-site)/us/page.tsx')), 'us').toBe(true)

    const root = selectorMetadata().alternates
    expect(root?.canonical).toBe('https://miyagisanchez.com/')
    // Two levels, and the difference is the contract: a bare language names a
    // SELECTOR document (a reader, no country yet), a language-REGION pair names a
    // market landing (a country, with its currency, payments and shipping).
    expect(root?.languages).toEqual({
      es: 'https://miyagisanchez.com/',
      en: 'https://miyagisanchez.com/en',
      'es-MX': 'https://miyagisanchez.com/mx',
      'en-US': 'https://miyagisanchez.com/us',
      'x-default': 'https://miyagisanchez.com/',
    })
    expect(marketLandingMetadata('mx').alternates?.canonical).toBe('https://miyagisanchez.com/mx')
    expect(marketLandingMetadata('us').alternates?.canonical).toBe('https://miyagisanchez.com/us')
    expect(existsSync(path.join(ROOT, 'app/(us-site)/us-eng'))).toBe(false)
  })

  test('the two selector documents are self-canonical and reciprocal, never one canonicalized onto the other', () => {
    // `/en` is a translation of `/`, not a duplicate of it. Pointing its canonical at
    // `/` would ask Google to drop the English document from the index — which is the
    // page an English-reading merchant needs — so each names itself and both publish
    // the same alternates map.
    expect(existsSync(path.join(ROOT, 'app/(en-site)/en/page.tsx')), 'en').toBe(true)

    expect(rootSelectorMetadata('es').alternates?.canonical).toBe('https://miyagisanchez.com/')
    expect(rootSelectorMetadata('en').alternates?.canonical).toBe('https://miyagisanchez.com/en')
    expect(rootSelectorMetadata('en').alternates?.languages)
      .toEqual(rootSelectorMetadata('es').alternates?.languages)

    // `x-default` stays the Spanish selector: it is where a locale we do not operate
    // in belongs, and it carries the switcher.
    expect(rootSelectorMetadata('en').alternates?.languages?.['x-default'])
      .toBe('https://miyagisanchez.com/')
  })

  test('catalog pages self-canonicalize without inventing a US alternate', () => {
    expect(marketCatalogCanonical('/mx/l/prod_123')).toEqual({
      alternates: { canonical: 'https://miyagisanchez.com/mx/l/prod_123' },
    })
    expect(marketCatalogCanonical('/mx/l/prod_123').alternates?.languages).toBeUndefined()
  })

  test('platform sitemap contains canonical markets and excludes redirect sources', () => {
    const urls = platformSitemapUrls()
    expect(urls).toContain('https://miyagisanchez.com/')
    expect(urls).toContain('https://miyagisanchez.com/mx')
    expect(urls).toContain('https://miyagisanchez.com/mx/l')
    expect(urls).toContain('https://miyagisanchez.com/us')
    expect(urls).toContain('https://miyagisanchez.com/us/l')
    expect(urls).not.toContain('https://miyagisanchez.com/l')
    expect(urls.some((url) => /^https:\/\/miyagisanchez\.com\/s(?:\/|$)/.test(url))).toBe(false)
  })
})
