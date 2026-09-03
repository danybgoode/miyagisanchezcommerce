/**
 * The hotlinked-image backfill's URL + outcome logic.
 *
 * Pure by construction — these functions decide what to fetch and how to report it, so
 * they are testable with no R2/Supabase/Medusa credentials. The live script is a thin
 * write around exactly these calls.
 *
 * Both behaviours here are regressions found by running the backfill against production
 * on 2026-09-02: it migrated 0 of 89 images across 28 listings and reported
 * `fixed=0 partially_fixed=28 failed=0` — a total no-op that read as partial success.
 */
import { test, expect } from '@playwright/test'
import {
  absolutizeImageUrl,
  classifyListingOutcome,
  isExternalImageUrl,
  shouldWriteImages,
} from '../scripts/lib/hotlinked-image-urls.mjs'

const R2_HOST = 'pub-f9f92a072d404a8ca99c2cb4f4562b04.r2.dev'

test.describe('absolutizeImageUrl', () => {
  // The exact shape every affected listing stored, and the reason the backfill fetched
  // nothing: `fetch('//cdn.shopify.com/...')` throws "Failed to parse URL".
  test('pins a protocol-relative URL to https so fetch() can parse it', () => {
    expect(absolutizeImageUrl('//cdn.shopify.com/s/files/1/0415/A00129.jpg?v=1776703772')).toBe(
      'https://cdn.shopify.com/s/files/1/0415/A00129.jpg?v=1776703772',
    )
    expect(() => new URL(absolutizeImageUrl('//cdn.shopify.com/a.jpg'))).not.toThrow()
  })

  test('leaves an already-absolute URL untouched', () => {
    for (const url of [`https://${R2_HOST}/listing-images/a.jpg`, 'http://example.com/a.png']) {
      expect(absolutizeImageUrl(url)).toBe(url)
    }
  })

  test('does not invent a host for references that have none', () => {
    // A bare path has no host to fetch, and `///` is not a host-relative reference.
    expect(absolutizeImageUrl('/listing-images/a.jpg')).toBe('/listing-images/a.jpg')
    expect(absolutizeImageUrl('///evil.com/a.jpg')).toBe('///evil.com/a.jpg')
  })
})

test.describe('isExternalImageUrl', () => {
  test('an R2-hosted image is not external', () => {
    expect(isExternalImageUrl(`https://${R2_HOST}/listing-images/a.jpg`, R2_HOST)).toBe(false)
  })

  test('a protocol-relative R2 URL is recognised as ours, not re-ingested', () => {
    // Before absolutizing, this fell into the catch and was reported external — the
    // backfill would have copied an image we already host back into the same bucket.
    expect(isExternalImageUrl(`//${R2_HOST}/listing-images/a.jpg`, R2_HOST)).toBe(false)
  })

  test('a hotlinked CDN image is external in either spelling', () => {
    expect(isExternalImageUrl('//cdn.shopify.com/a.jpg', R2_HOST)).toBe(true)
    expect(isExternalImageUrl('https://cdn.shopify.com/a.jpg', R2_HOST)).toBe(true)
  })

  test('an unparsable URL is flagged, never assumed fine', () => {
    expect(isExternalImageUrl('not a url', R2_HOST)).toBe(true)
  })
})

test.describe('classifyListingOutcome', () => {
  // The defect: `anyFailed` collapsed "some failed" and "all failed" into partially_fixed,
  // so 0-of-6 migrated was reported the same as 5-of-6.
  test('migrating NONE of the external images is a failure, not a partial fix', () => {
    expect(classifyListingOutcome({ externalCount: 6, migratedCount: 0 })).toBe('failed')
  })

  test('migrating some but not all is a partial fix', () => {
    expect(classifyListingOutcome({ externalCount: 6, migratedCount: 5 })).toBe('partially_fixed')
  })

  test('migrating every external image is a fix', () => {
    expect(classifyListingOutcome({ externalCount: 6, migratedCount: 6 })).toBe('fixed')
  })

  test('a listing with nothing hotlinked is unchanged, not fixed', () => {
    expect(classifyListingOutcome({ externalCount: 0, migratedCount: 0 })).toBe('unchanged')
  })
})

test.describe('shouldWriteImages', () => {
  test('only outcomes that actually changed an image are written back', () => {
    expect(shouldWriteImages('fixed')).toBe(true)
    expect(shouldWriteImages('partially_fixed')).toBe(true)
    // Writing these would PATCH Supabase AND Medusa with byte-identical data.
    expect(shouldWriteImages('failed')).toBe(false)
    expect(shouldWriteImages('unchanged')).toBe(false)
  })
})
