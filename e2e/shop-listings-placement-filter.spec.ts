import { test, expect } from '@playwright/test'
import { isPrintPlacementListing } from '../lib/listing-query'

/**
 * Custom print products · Sprint 1, Story 1.1 — shop-storefront placement filter.
 *
 * Print-ad placement products (platform-seller tier products minted by the
 * print-edition flow, `metadata.is_print_placement`) must never render as a
 * real, buyable listing on any shop-storefront surface (marketplace `/s/[slug]`,
 * subdomain, custom domain, embed, sitemap, PDP "more from this shop") — they're
 * sold only through the dedicated backoffice ad flow. This proves the pure
 * predicate `getShopListings()` (lib/listings.ts) filters on before mapping.
 * Pure; no network.
 */

test.describe('shop-listings-placement-filter · invariant', () => {
  test('excludes a print-ad placement product', () => {
    expect(isPrintPlacementListing({ is_print_placement: true })).toBe(true)
  })

  test('does not exclude a normal product', () => {
    expect(isPrintPlacementListing({ listing_type: 'product' })).toBe(false)
  })

  test('does not exclude a hidden-catalog (support) product — different concern', () => {
    expect(isPrintPlacementListing({ hidden_from_catalog: true, is_support_product: true })).toBe(false)
  })

  test('a truthy-but-not-boolean value does not exclude (metadata is untyped JSON)', () => {
    expect(isPrintPlacementListing({ is_print_placement: 'true' })).toBe(false)
    expect(isPrintPlacementListing({ is_print_placement: 1 })).toBe(false)
  })

  test('null / undefined / empty metadata are safe no-ops', () => {
    expect(isPrintPlacementListing(null)).toBe(false)
    expect(isPrintPlacementListing(undefined)).toBe(false)
    expect(isPrintPlacementListing({})).toBe(false)
  })

  test('the guard is seller-identity-independent — panfleto-premium-shop S1', () => {
    // Reassigning WHICH Medusa seller owns the placement product (Sprint 1's
    // whole point) must not weaken this filter: it fires on the metadata flag
    // alone, regardless of seller_id.
    expect(isPrintPlacementListing({ is_print_placement: true, seller_id: 'sel_platform_owned' })).toBe(true)
    expect(isPrintPlacementListing({ is_print_placement: true, seller_id: 'sel_some_other_merchant' })).toBe(true)
  })
})
