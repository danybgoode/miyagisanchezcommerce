import { test, expect } from '@playwright/test'
import { resultCountLabel } from '../lib/listing-query'

/**
 * Discovery Polish · Sprint 2 — mobile filter rebuild.
 *
 * Two layers, both in the `api` gate:
 *  • pure-logic — `resultCountLabel` gives the right es-MX singular/plural label
 *    for the apply button across the count edge cases. No network; deterministic.
 *  • round-trip — `/api/listings/count?…` actually reaches the backend filter
 *    (the same `/store/listings` the search page counts against). Data-resilient:
 *    asserts the contract (subset; impossible filter ⇒ 0), not that prod happens
 *    to hold any given listing.
 */

test.describe('mobile-filter · resultCountLabel', () => {
  test('no count yet → a neutral "Ver resultados"', () => {
    expect(resultCountLabel(null)).toBe('Ver resultados')
    expect(resultCountLabel(undefined)).toBe('Ver resultados')
  })

  test('zero / negative → "Sin resultados"', () => {
    expect(resultCountLabel(0)).toBe('Sin resultados')
    expect(resultCountLabel(-3)).toBe('Sin resultados')
  })

  test('one → singular; many → plural', () => {
    expect(resultCountLabel(1)).toBe('Ver 1 resultado')
    expect(resultCountLabel(2)).toBe('Ver 2 resultados')
    expect(resultCountLabel(24)).toBe('Ver 24 resultados')
  })
})

test.describe('mobile-filter · /api/listings/count round-trips through the backend', () => {
  test('returns a numeric total; a filter narrows it (⊆ the unfiltered count)', async ({ request }) => {
    const all = await request.get('/api/listings/count')
    expect(all.ok()).toBeTruthy()
    const allTotal = (await all.json()).total
    expect(typeof allTotal).toBe('number')
    expect(allTotal).toBeGreaterThanOrEqual(0)

    const service = await request.get('/api/listings/count?listing_type=service')
    expect(service.ok()).toBeTruthy()
    const serviceTotal = (await service.json()).total
    expect(typeof serviceTotal).toBe('number')
    // The filtered count is a subset of the whole catalog.
    expect(serviceTotal).toBeLessThanOrEqual(allTotal)
  })

  test('an impossible filter yields 0 (the params truly reach the backend)', async ({ request }) => {
    const res = await request.get('/api/listings/count?listing_type=__nope__')
    expect(res.ok()).toBeTruthy()
    expect((await res.json()).total).toBe(0)
  })
})
