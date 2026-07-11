import { test, expect } from '@playwright/test'
import { resolvePlatformSellerSlug } from '../lib/platform-seller'

/**
 * Panfleto Sprint 1, Story 1.1/1.2 — the platform-owned seller that bills
 * print-ad placements is config-addressable via `PLATFORM_SELLER_SLUG`, never
 * a hardcoded merchant-shop constant. Pure function; no network.
 */

test.describe('resolvePlatformSellerSlug · PLATFORM_SELLER_SLUG', () => {
  const ORIGINAL_ENV = process.env.PLATFORM_SELLER_SLUG

  test.afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.PLATFORM_SELLER_SLUG
    else process.env.PLATFORM_SELLER_SLUG = ORIGINAL_ENV
  })

  test('returns null when unset', () => {
    delete process.env.PLATFORM_SELLER_SLUG
    expect(resolvePlatformSellerSlug()).toBeNull()
  })

  test('returns the env var value when set', () => {
    process.env.PLATFORM_SELLER_SLUG = 'miyagiprints'
    expect(resolvePlatformSellerSlug()).toBe('miyagiprints')
  })

  test('an explicit override wins over the env var', () => {
    process.env.PLATFORM_SELLER_SLUG = 'miyagiprints'
    expect(resolvePlatformSellerSlug('miyagi-plataforma')).toBe('miyagi-plataforma')
  })

  test('a blank/whitespace-only env var resolves to null, not an empty string', () => {
    process.env.PLATFORM_SELLER_SLUG = '   '
    expect(resolvePlatformSellerSlug()).toBeNull()
  })

  test('an empty-string override falls through to the env var', () => {
    process.env.PLATFORM_SELLER_SLUG = 'miyagiprints'
    expect(resolvePlatformSellerSlug('')).toBe('miyagiprints')
  })
})
