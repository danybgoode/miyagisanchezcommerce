import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { listingUrlFor, shopUrlFor } from '../lib/market-url'
import { isBoundaryDeniedPath } from '../lib/route-shape'

const ROOT = path.resolve(import.meta.dirname, '..')

const SHOP_LINK_SURFACES = [
  'app/(shell)/shop/manage/canal-propio/CanalPropioClient.tsx',
  'app/(shell)/shop/manage/SellerNav.tsx',
  'app/(shell)/shop/manage/ManageDashboard.tsx',
  'app/(shell)/shop/manage/orders/OrdersInbox.tsx',
  'app/(shell)/shop/manage/offers/OfferInbox.tsx',
  'app/(shell)/shop/manage/settings/pagos/wizard/CobrosWizardClient.tsx',
] as const

const LISTING_LINK_SURFACES = [
  'app/(shell)/sell/edit/[id]/page.tsx',
  'app/(shell)/shop/manage/orders/[id]/OrderDetail.tsx',
  'app/(shell)/shop/manage/offers/OfferInbox.tsx',
] as const

function source(file: string): string {
  return readFileSync(path.join(ROOT, file), 'utf8')
}

test.describe('seller-management public catalog URLs', () => {
  test('canonical seller actions use absolute platform destinations', () => {
    const shopUrl = shopUrlFor('https://miyagisanchez.com', 'tienda-demo')
    const listingUrl = listingUrlFor('https://miyagisanchez.com', 'prod_123')

    expect(shopUrl).toBe('https://miyagisanchez.com/mx/s/tienda-demo')
    expect(listingUrl).toBe('https://miyagisanchez.com/mx/l/prod_123')
    // These are deliberately platform links. Their market-prefixed shapes are
    // denied on tenant hosts, so a relative href would be broken there.
    expect(isBoundaryDeniedPath(new URL(shopUrl).pathname)).toBe(true)
    expect(isBoundaryDeniedPath(new URL(listingUrl).pathname)).toBe(true)
  })

  test('shop actions deliberately leave tenant-reachable management surfaces', () => {
    for (const file of SHOP_LINK_SURFACES) {
      const content = source(file)
      expect(content, file).toContain("from '@/lib/market-url'")
      expect(content, file).toContain("from '@/lib/market-seo'")
      expect(content, file).toContain('shopUrlFor(SITE_ORIGIN,')
      expect(content, file).not.toMatch(/href=\{`\/mx\/s\//)
      expect(content, file).not.toContain('window.location.origin')
    }
  })

  test('listing actions deliberately leave tenant-reachable management surfaces', () => {
    for (const file of LISTING_LINK_SURFACES) {
      const content = source(file)
      expect(content, file).toContain("from '@/lib/market-url'")
      expect(content, file).toContain("from '@/lib/market-seo'")
      expect(content, file).toContain('listingUrlFor(SITE_ORIGIN,')
      expect(content, file).not.toMatch(/href=\{`\/mx\/l\//)
      expect(content, file).not.toContain('window.location.origin')
    }
  })
})
