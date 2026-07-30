import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  MARKET_LANDING_PAGES,
  marketCatalogCanonical,
  marketLandingMetadata,
  selectorMetadata,
} from '../lib/market-seo'
import { platformSitemapUrls } from '../lib/market-sitemap'

const ROOT = path.resolve(import.meta.dirname, '..')

test.describe('market SEO contract', () => {
  test('landing alternates name only real pages and keep locale separate from market', () => {
    expect(MARKET_LANDING_PAGES).toEqual(['mx', 'us'])
    for (const market of MARKET_LANDING_PAGES) {
      expect(existsSync(path.join(ROOT, `app/(site)/${market}/page.tsx`)), market).toBe(true)
    }

    const root = selectorMetadata().alternates
    expect(root?.canonical).toBe('https://miyagisanchez.com/')
    expect(root?.languages).toEqual({
      'es-MX': 'https://miyagisanchez.com/mx',
      'en-US': 'https://miyagisanchez.com/us',
      'x-default': 'https://miyagisanchez.com/',
    })
    expect(marketLandingMetadata('mx').alternates?.canonical).toBe('https://miyagisanchez.com/mx')
    expect(marketLandingMetadata('us').alternates?.canonical).toBe('https://miyagisanchez.com/us')
    expect(existsSync(path.join(ROOT, 'app/(site)/us-eng'))).toBe(false)
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
    expect(urls).not.toContain('https://miyagisanchez.com/l')
    expect(urls.some((url) => /^https:\/\/miyagisanchez\.com\/s(?:\/|$)/.test(url))).toBe(false)
  })
})
