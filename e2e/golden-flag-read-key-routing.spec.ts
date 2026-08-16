import { expect, test } from '@playwright/test'
import { FLAG_KEYS } from '../lib/flag-catalog'
import {
  PARTNERS_RECRUITING_V3_FLAG_KEY,
  routeGoldenFlagReadKey,
} from '../lib/golden-flag-read-key-routing'

test.describe('Golden read-key routing', () => {
  test('the recruiting-v3 flag alone uses its owner-visible project credential', () => {
    expect(routeGoldenFlagReadKey(PARTNERS_RECRUITING_V3_FLAG_KEY, {
      GOLDEN_BEANS_FLAG_READ_KEY: ' legacy-read ',
      GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY: ' owner-read ',
    })).toEqual({
      flagReadKey: 'owner-read',
      providerSlot: 'partners-recruiting-v3',
      persistToDurableMirror: false,
      resetScopedProvider: false,
    })
  })

  test('every existing flag keeps the established production catalog', () => {
    const existingKeys = FLAG_KEYS.filter(
      (key) => key !== PARTNERS_RECRUITING_V3_FLAG_KEY,
    )

    for (const flagKey of existingKeys) {
      expect(routeGoldenFlagReadKey(flagKey, {
        GOLDEN_BEANS_FLAG_READ_KEY: 'legacy-read',
        GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY: 'owner-read',
      }), flagKey).toEqual({
        flagReadKey: 'legacy-read',
        providerSlot: 'primary',
        persistToDurableMirror: true,
        resetScopedProvider: false,
      })
    }
  })

  test('removing the scoped credential requests cleanup on primary traffic too', () => {
    expect(routeGoldenFlagReadKey('checkout.stripe_enabled', {
      GOLDEN_BEANS_FLAG_READ_KEY: 'legacy-read',
    })).toEqual({
      flagReadKey: 'legacy-read',
      providerSlot: 'primary',
      persistToDurableMirror: true,
      resetScopedProvider: true,
    })
  })

  test('an absent or blank scoped credential preserves the primary fallback', () => {
    for (const scoped of [undefined, '', '   ']) {
      expect(routeGoldenFlagReadKey(PARTNERS_RECRUITING_V3_FLAG_KEY, {
        GOLDEN_BEANS_FLAG_READ_KEY: 'legacy-read',
        GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY: scoped,
      })).toEqual({
        flagReadKey: 'legacy-read',
        providerSlot: 'primary',
        persistToDurableMirror: true,
        resetScopedProvider: true,
      })
    }
  })

  test('the scoped project can serve recruiting even when the primary is unavailable', () => {
    expect(routeGoldenFlagReadKey(PARTNERS_RECRUITING_V3_FLAG_KEY, {
      GOLDEN_BEANS_PARTNERS_RECRUITING_V3_FLAG_READ_KEY: 'owner-read',
    })).toEqual({
      flagReadKey: 'owner-read',
      providerSlot: 'partners-recruiting-v3',
      persistToDurableMirror: false,
      resetScopedProvider: false,
    })
  })
})
