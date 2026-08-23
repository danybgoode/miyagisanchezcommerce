import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8')

test.describe('public PDP viewer state · D8', () => {
  test('one fixed island performs exactly one no-store personalized read and fails disabled', () => {
    const island = read('app/components/PublicPdpViewerIsland.tsx')
    expect(island.match(/fetch\(`/g)).toHaveLength(1)
    expect(island).toContain('/api/public/pdp-viewer-state?')
    expect(island).toContain("cache: 'no-store'")
    expect(island).toContain('started.current = requestKey')
    expect(island).toContain('started.current === requestKey')
    expect(island).toContain('height: 260')
    expect(island).toContain("data-state={failed ? 'disabled' : 'settling'}")
    expect(island.indexOf('if (!state)')).toBeLessThan(island.indexOf('if (state.ownsListing)'))
  })

  test('the endpoint supplies all four viewer-owned facts under no-store', () => {
    const endpoint = read('app/api/public/pdp-viewer-state/route.ts')
    const activeDeal = read('lib/active-deal.ts')
    expect(endpoint).toContain("'Cache-Control': 'private, no-store, max-age=0'")
    expect(endpoint).toContain('currentUser()')
    expect(endpoint).toContain('ownsListing:')
    expect(endpoint).toContain('favorited:')
    expect(endpoint).toContain("getActiveDealForBuyer(listingId, user.id, { failOnError: true })")
    expect(activeDeal).toContain('if (failOnError && byMedusaError) throw byMedusaError')
    expect(activeDeal).toContain('if (failOnError && offerError) throw offerError')
    expect(activeDeal).toContain('if (failOnError && conversationError) throw conversationError')
    expect(endpoint).toContain('buyerPrefill:')
  })

  test('accepted-offer checkout imports the shipped commerce-readiness result', () => {
    const renderer = read('app/(shell)/l/[id]/ListingRenderer.tsx')
    const island = read('app/components/PublicPdpViewerIsland.tsx')
    expect(renderer).toContain('commerceReadiness={commerceReadiness}')
    expect(island).toContain('commerceReadiness.ready ? (')
    expect(island).toContain("commerceReadiness.reason === 'checkout_not_available'")
  })

  test('MakeOfferButton disables its historical second offer read in the island flow', () => {
    const island = read('app/components/PublicPdpViewerIsland.tsx')
    const offerButton = read('app/components/MakeOfferButton.tsx')
    expect(island).toContain('skipActiveOfferRead')
    expect(offerButton).toContain('if (!isSignedIn || skipActiveOfferRead) return')
  })
})
