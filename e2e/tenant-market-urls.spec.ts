import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  listingUrlFor,
  marketplaceUrl,
  shopUrlFor,
} from '../lib/market-url'

const ROOT = path.resolve(import.meta.dirname, '..')
const PAYMENT_SUCCESS = readFileSync(
  path.join(ROOT, 'app/(shell)/payment/success/page.tsx'),
  'utf8',
)
const SITEMAP = readFileSync(path.join(ROOT, 'app/sitemap.ts'), 'utf8')

test.describe('tenant-aware catalog URLs', () => {
  test('the shared seam prefixes platform URLs but never tenant URLs', () => {
    const platform = 'https://miyagisanchez.com'
    const tenant = 'https://tienda.example'

    expect(listingUrlFor(platform, 'prod_123')).toBe(
      'https://miyagisanchez.com/mx/l/prod_123',
    )
    expect(shopUrlFor(platform, 'bonsai')).toBe(
      'https://miyagisanchez.com/mx/s/bonsai',
    )
    expect(marketplaceUrl(platform, '/l')).toBe(
      'https://miyagisanchez.com/mx/l',
    )

    expect(listingUrlFor(tenant, 'prod_123')).toBe(
      'https://tienda.example/l/prod_123',
    )
    expect(shopUrlFor(tenant, 'bonsai')).toBe(
      'https://tienda.example/s/bonsai',
    )
    expect(marketplaceUrl(tenant, '/l')).toBe(
      'https://tienda.example/l',
    )
  })

  test('tenant sitemap delegates every emitted URL to the origin-aware seam', () => {
    expect(SITEMAP).toContain("marketplaceUrl(base, '/')")
    expect(SITEMAP).toContain('listingUrlFor(base, l.id)')
    expect(SITEMAP).toContain('marketplaceUrl(base, `/c/${shortCollectionSlug(c.handle, shopSlug)}`)')
    expect(SITEMAP).toContain('marketplaceUrl(base, p)')
    expect(SITEMAP).not.toContain('`${base}/mx/l/${l.id}`')
  })

  test('all three payment-success catalog branches use the current channel origin', () => {
    expect(PAYMENT_SUCCESS).toContain("from '@/lib/market-url'")
    expect(PAYMENT_SUCCESS).toContain("const onChannel = requestHeaders.get('x-miyagi-channel') === 'custom'")
    expect(PAYMENT_SUCCESS).toContain("const channelDomain = requestHeaders.get('x-miyagi-domain')")
    expect(PAYMENT_SUCCESS).toContain(
      "const marketOrigin = onChannel && channelDomain\n    ? `https://${channelDomain.split(':')[0]}`\n    : SITE_ORIGIN",
    )

    expect(PAYMENT_SUCCESS.match(/listingUrlFor\(marketOrigin, listingId\)/g)).toHaveLength(2)
    expect(PAYMENT_SUCCESS).toContain('shopUrlFor(marketOrigin, sellerSlug)')
    expect(PAYMENT_SUCCESS.match(/marketplaceUrl\(marketOrigin, '\/l'\)/g)).toHaveLength(2)

    expect(PAYMENT_SUCCESS).not.toMatch(/href=\{`\/mx\/l\/\$\{listingId\}`\}/)
    expect(PAYMENT_SUCCESS).not.toMatch(/href=\{`\/mx\/s\/\$\{sellerSlug\}`\}/)
    expect(PAYMENT_SUCCESS).not.toContain('href="/mx/l"')
  })
})
