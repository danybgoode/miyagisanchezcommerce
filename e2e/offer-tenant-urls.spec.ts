import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { listingUrlFor } from '../lib/market-url'

const ROOT = path.resolve(import.meta.dirname, '..')
const SELLER_RESPOND = readFileSync(path.join(ROOT, 'lib/offer-respond.ts'), 'utf8')
const BUYER_RESPOND = readFileSync(
  path.join(ROOT, 'app/api/offers/[id]/buyer-respond/route.ts'),
  'utf8',
)

test.describe('offer response URLs respect the current channel', () => {
  test('the shared listing seam keeps /mx on platform and off tenant domains', () => {
    expect(listingUrlFor('https://miyagisanchez.com', 'prod_123')).toBe(
      'https://miyagisanchez.com/mx/l/prod_123',
    )
    expect(listingUrlFor('https://seller.example', 'prod_123')).toBe(
      'https://seller.example/l/prod_123',
    )
  })

  test('seller acceptance delegates dynamic-origin listing URLs to the shared seam', () => {
    expect(SELLER_RESPOND).toContain("import { listingUrlFor } from './market-url'")
    expect(SELLER_RESPOND).toContain('const listingUrl = listingUrlFor(origin, listing.id)')
    expect(SELLER_RESPOND).toContain('cancel_url: `${listingUrl}?offer=cancelled`')
    expect(SELLER_RESPOND).not.toContain('`${origin}/mx/l/${listing.id}`')
  })

  test('buyer counter-acceptance delegates dynamic-origin listing URLs to the shared seam', () => {
    expect(BUYER_RESPOND).toContain("import { listingUrlFor } from '@/lib/market-url'")
    expect(BUYER_RESPOND).toContain('const listingUrl = listingUrlFor(origin, listing.id)')
    expect(BUYER_RESPOND).toContain('cancel_url: `${listingUrl}?offer=cancelled`')
    expect(BUYER_RESPOND).not.toContain('`${origin}/mx/l/${listing.id}`')
  })
})
