import { test, expect } from '@playwright/test'
import {
  shouldShowSaveCount,
  saveCountLabel,
  isNewListing,
  SAVE_COUNT_THRESHOLD,
  NEW_LISTING_WINDOW_MS,
} from '../lib/pdp-liveness'

/**
 * PDP redesign — Sprint 2, S2.2 (liveness / FOMO) pure-logic gates.
 * No network, no auth, no `next/*` — runs in the `api` gate. The page render and
 * these assertions read the same helpers, so the gates can't drift from the copy.
 */

test.describe('pdp-liveness · save-count gate', () => {
  test('shows only at/above the threshold (0–1 saves never render)', () => {
    expect(shouldShowSaveCount(0)).toBe(false)
    expect(shouldShowSaveCount(1)).toBe(false)
    expect(shouldShowSaveCount(SAVE_COUNT_THRESHOLD - 1)).toBe(false)
    expect(shouldShowSaveCount(SAVE_COUNT_THRESHOLD)).toBe(true)
    expect(shouldShowSaveCount(42)).toBe(true)
  })
  test('tolerates null / undefined / non-finite counts (→ hidden)', () => {
    expect(shouldShowSaveCount(null)).toBe(false)
    expect(shouldShowSaveCount(undefined)).toBe(false)
    expect(shouldShowSaveCount(NaN)).toBe(false)
  })
  test('a custom threshold overrides the default', () => {
    expect(shouldShowSaveCount(2, 2)).toBe(true)
    expect(shouldShowSaveCount(2, 5)).toBe(false)
  })
})

test.describe('pdp-liveness · save-count copy (es-MX)', () => {
  test('plural by default, singular-safe', () => {
    expect(saveCountLabel(5)).toBe('5 personas lo guardaron')
    expect(saveCountLabel(SAVE_COUNT_THRESHOLD)).toBe(`${SAVE_COUNT_THRESHOLD} personas lo guardaron`)
    expect(saveCountLabel(1)).toBe('1 persona lo guardó')
  })
})

test.describe('pdp-liveness · "Nuevo" recency gate (< 48h)', () => {
  const NOW = Date.parse('2026-06-13T12:00:00.000Z')

  test('true within the window, false at/after it', () => {
    const oneHourAgo = new Date(NOW - 60 * 60 * 1000).toISOString()
    const justUnder = new Date(NOW - (NEW_LISTING_WINDOW_MS - 1000)).toISOString()
    const justOver = new Date(NOW - (NEW_LISTING_WINDOW_MS + 1000)).toISOString()
    const weekAgo = new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString()
    expect(isNewListing(oneHourAgo, NOW)).toBe(true)
    expect(isNewListing(justUnder, NOW)).toBe(true)
    expect(isNewListing(justOver, NOW)).toBe(false)
    expect(isNewListing(weekAgo, NOW)).toBe(false)
  })
  test('a future timestamp still reads as new; bad/absent input is not new', () => {
    const future = new Date(NOW + 60 * 60 * 1000).toISOString()
    expect(isNewListing(future, NOW)).toBe(true)
    expect(isNewListing(null, NOW)).toBe(false)
    expect(isNewListing(undefined, NOW)).toBe(false)
    expect(isNewListing('not-a-date', NOW)).toBe(false)
  })
})
