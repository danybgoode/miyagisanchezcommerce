import { expect, test } from '@playwright/test'
import {
  resolveFlag,
  isCacheStale,
  FLAG_CACHE_TTL_MS,
  FLAG_FETCH_TIMEOUT_MS,
  type FlagRow,
} from '../lib/flags-cache'

// Pure-seam coverage for the in-house flag reader (epic 09 · feature-flags-inhouse).
// No browser, no network — proves the FAIL-OPEN decision that lib/flags.ts composes.
// Both polarities are exercised: a kill-switch (default true) and an enablement
// (default false) so "missing row → default" is checked in both directions.

const DEFAULTS = {
  'checkout.stripe_enabled': true, // kill-switch → fail-open ON
  'shipping.envia_enabled': false, // enablement → fail-open OFF
} as const

test.describe('flags-cache · resolveFlag (fail-open)', () => {
  test('returns the row value when the key is present (overrides the default, both ways)', () => {
    const rows: FlagRow[] = [
      { key: 'checkout.stripe_enabled', enabled: false }, // killed despite default ON
      { key: 'shipping.envia_enabled', enabled: true }, // enabled despite default OFF
    ]
    expect(resolveFlag(rows, 'checkout.stripe_enabled', DEFAULTS)).toBe(false)
    expect(resolveFlag(rows, 'shipping.envia_enabled', DEFAULTS)).toBe(true)
  })

  test('falls open to the default when the row is missing (both polarities)', () => {
    const rows: FlagRow[] = [{ key: 'some.other_flag', enabled: false }]
    expect(resolveFlag(rows, 'checkout.stripe_enabled', DEFAULTS)).toBe(true)
    expect(resolveFlag(rows, 'shipping.envia_enabled', DEFAULTS)).toBe(false)
  })

  test('falls open to the default on empty / null / undefined rows', () => {
    for (const rows of [[], null, undefined] as const) {
      expect(resolveFlag(rows, 'checkout.stripe_enabled', DEFAULTS)).toBe(true)
      expect(resolveFlag(rows, 'shipping.envia_enabled', DEFAULTS)).toBe(false)
    }
  })

  test('falls open when a row has a non-boolean enabled value', () => {
    const rows = [{ key: 'checkout.stripe_enabled', enabled: 'yes' as unknown as boolean }]
    expect(resolveFlag(rows, 'checkout.stripe_enabled', DEFAULTS)).toBe(true)
  })
})

test.describe('flags-cache · isCacheStale', () => {
  test('is stale when never fetched (fetchedAt null)', () => {
    expect(isCacheStale(null, 1_000, FLAG_CACHE_TTL_MS)).toBe(true)
  })

  test('is fresh within the TTL, stale at/after it', () => {
    const now = 1_000_000
    expect(isCacheStale(now, now, FLAG_CACHE_TTL_MS)).toBe(false) // just fetched
    expect(isCacheStale(now - (FLAG_CACHE_TTL_MS - 1), now, FLAG_CACHE_TTL_MS)).toBe(false)
    expect(isCacheStale(now - FLAG_CACHE_TTL_MS, now, FLAG_CACHE_TTL_MS)).toBe(true) // exactly TTL
    expect(isCacheStale(now - (FLAG_CACHE_TTL_MS + 1), now, FLAG_CACHE_TTL_MS)).toBe(true)
  })
})

test.describe('flags-cache · constants', () => {
  test('TTL is 60 s and the fetch budget is 2 s', () => {
    expect(FLAG_CACHE_TTL_MS).toBe(60_000)
    expect(FLAG_FETCH_TIMEOUT_MS).toBe(2_000)
  })
})
