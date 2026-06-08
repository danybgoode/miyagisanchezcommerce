import { test, expect } from '@playwright/test'
import { buildQuery, listingTypeBadge, LISTING_TYPE_FILTERS } from '../lib/listing-query'

/**
 * Discovery Polish · Sprint 1 — listing-type taxonomy (filterable).
 *
 * Two layers, both in the `api` gate:
 *  • pure-logic — the search-query builder forwards `listing_type`, and the card
 *    badge maps types correctly. No network; deterministic.
 *  • round-trip — `/api/ucp/catalog?listing_type=…` actually reaches the backend
 *    filter (the same `/store/listings` the search page uses). Data-resilient:
 *    asserts the contract, not that prod happens to hold service listings.
 */

test.describe('discovery · buildQuery forwards listing_type', () => {
  test('listing_type is forwarded when present', () => {
    const qs = buildQuery({ listing_type: 'service' })
    expect(qs).toContain('listing_type=service')
  })

  test('absent listing_type is not forwarded', () => {
    expect(buildQuery({})).toBe('')
    expect(buildQuery({ q: 'silla' })).not.toContain('listing_type')
  })

  test('listing_type rides alongside the other filters', () => {
    const params = new URLSearchParams(buildQuery({ q: 'silla', category: 'hogar', listing_type: 'rental' }))
    expect(params.get('q')).toBe('silla')
    expect(params.get('category')).toBe('hogar')
    expect(params.get('listing_type')).toBe('rental')
  })
})

test.describe('discovery · listingTypeBadge', () => {
  test('non-product types map to an es-MX singular label', () => {
    expect(listingTypeBadge('service')).toBe('Servicio')
    expect(listingTypeBadge('rental')).toBe('Renta')
    expect(listingTypeBadge('digital')).toBe('Digital')
    expect(listingTypeBadge('subscription')).toBe('Suscripción')
  })

  test('product (the default) and unknown/empty get no badge', () => {
    expect(listingTypeBadge('product')).toBeNull()
    expect(listingTypeBadge('')).toBeNull()
    expect(listingTypeBadge(null)).toBeNull()
    expect(listingTypeBadge('wat')).toBeNull()
  })

  test('every chip value except product yields a badge', () => {
    for (const { value } of LISTING_TYPE_FILTERS) {
      if (value === 'product') expect(listingTypeBadge(value)).toBeNull()
      else expect(listingTypeBadge(value)).toBeTruthy()
    }
  })
})

test.describe('discovery · listing_type round-trips through the catalog API', () => {
  test('?listing_type=service returns only service listings, ⊆ the full catalog', async ({ request }) => {
    const all = await request.get('/api/ucp/catalog?limit=50')
    expect(all.ok()).toBeTruthy()
    const allTotal = (await all.json()).total ?? 0

    const res = await request.get('/api/ucp/catalog?listing_type=service&limit=50')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()

    // Every returned item is a service (vacuously true if prod holds none — still valid).
    for (const item of body.items ?? []) expect(item.listing_type).toBe('service')
    // The filtered set is a subset of the whole catalog.
    expect(body.total).toBeLessThanOrEqual(allTotal)
  })

  test('an impossible listing_type filters everything out (param truly reaches the backend)', async ({ request }) => {
    const res = await request.get('/api/ucp/catalog?listing_type=__nope__&limit=50')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.total).toBe(0)
    expect(body.items ?? []).toHaveLength(0)
  })
})
