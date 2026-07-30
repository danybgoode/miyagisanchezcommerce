import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { browseUrlFor, listingUrlFor, shopUrlFor } from '../lib/market-url'
import { SITE_ORIGIN } from '../lib/market-seo'
import { isBoundaryDeniedPath } from '../lib/route-shape'

const ROOT = path.resolve(import.meta.dirname, '..')

const BUYER_SHELL_FILES = [
  'app/(shell)/account/favorites/page.tsx',
  'app/(shell)/account/orders/AccountOrdersClient.tsx',
  'app/(shell)/account/orders/[id]/OrderTrackingClient.tsx',
  'app/(shell)/messages/page.tsx',
  'app/(shell)/messages/[id]/ConversationClient.tsx',
  'app/(shell)/checkout/bundle/BundleCheckoutClient.tsx',
] as const

function source(file: (typeof BUYER_SHELL_FILES)[number]): string {
  return readFileSync(path.join(ROOT, file), 'utf8')
}

test.describe('buyer shell public catalog links', () => {
  test('platform URL seams produce canonical cross-shop destinations', () => {
    const destinations = [
      browseUrlFor(SITE_ORIGIN),
      listingUrlFor(SITE_ORIGIN, 'prod_123'),
      shopUrlFor(SITE_ORIGIN, 'tienda-demo'),
    ]

    expect(destinations).toEqual([
      'https://miyagisanchez.com/mx/l',
      'https://miyagisanchez.com/mx/l/prod_123',
      'https://miyagisanchez.com/mx/s/tienda-demo',
    ])
    for (const destination of destinations) {
      const url = new URL(destination)
      expect(url.origin).toBe(SITE_ORIGIN)
      // These shapes are intentionally platform-only. The absolute origin is
      // what keeps a buyer who arrived through a tenant host out of its deny rail.
      expect(isBoundaryDeniedPath(url.pathname), destination).toBe(true)
    }
  })

  test('all six tenant-reachable buyer surfaces use the canonical platform origin', () => {
    for (const file of BUYER_SHELL_FILES) {
      const contents = source(file)
      expect(contents, file).toContain("from '@/lib/market-url'")
      expect(contents, file).toContain("from '@/lib/market-seo'")
      expect(contents, file).not.toMatch(/href=(?:"\/mx\/(?:l|s)|\{`\/mx\/(?:l|s))/)
      expect(contents, file).not.toContain('window.location.origin')
    }

    expect(source('app/(shell)/account/favorites/page.tsx')).toContain(
      'listingUrlFor(SITE_ORIGIN, listing.medusa_product_id!)',
    )
    expect(source('app/(shell)/account/favorites/page.tsx')).toContain(
      'browseUrlFor(SITE_ORIGIN)',
    )

    expect(source('app/(shell)/account/orders/AccountOrdersClient.tsx')).toContain(
      'browseUrlFor(SITE_ORIGIN)',
    )

    expect(
      source('app/(shell)/account/orders/[id]/OrderTrackingClient.tsx').match(
        /shopUrlFor\(SITE_ORIGIN, shop\.slug\)/g,
      ),
    ).toHaveLength(2)

    expect(source('app/(shell)/messages/page.tsx')).toContain(
      'browseUrlFor(SITE_ORIGIN)',
    )

    const conversation = source('app/(shell)/messages/[id]/ConversationClient.tsx')
    expect(conversation).toContain(
      'listingUrlFor(SITE_ORIGIN, listing.medusa_product_id ?? listing.id)',
    )
    expect(conversation).toContain('browseUrlFor(SITE_ORIGIN)')

    const bundle = source('app/(shell)/checkout/bundle/BundleCheckoutClient.tsx')
    expect(bundle.match(/browseUrlFor\(SITE_ORIGIN\)/g)).toHaveLength(3)
    expect(bundle).toContain('shopUrlFor(SITE_ORIGIN, seller.sellerSlug)')
    expect(bundle).toContain('listingUrlFor(SITE_ORIGIN, item.productId)')
  })
})
