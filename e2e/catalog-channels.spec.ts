import { test, expect } from '@playwright/test'
import { deriveChannelBadges } from '../lib/catalog-channels'

/**
 * Channel-badge deriver — pure logic (api gate, no browser). Catalog-management
 * epic, Sprint 2 · Story 2.2's "channel-badge deriver" QA line.
 */

test.describe('catalog-channels · deriveChannelBadges', () => {
  test('channels: ["miyagi"] → miyagi only', () => {
    expect(deriveChannelBadges({ channels: ['miyagi'] })).toEqual({ miyagi: true, ml: false })
  })

  test('channels: ["miyagi", "ml"] → both', () => {
    expect(deriveChannelBadges({ channels: ['miyagi', 'ml'] })).toEqual({ miyagi: true, ml: true })
  })

  test('channels: undefined → deploy-lag fallback (miyagi only, never throws)', () => {
    expect(deriveChannelBadges({})).toEqual({ miyagi: true, ml: false })
    expect(deriveChannelBadges({ channels: undefined })).toEqual({ miyagi: true, ml: false })
  })

  test('channels: [] (explicitly empty array, distinct from undefined) → neither badge', () => {
    expect(deriveChannelBadges({ channels: [] })).toEqual({ miyagi: false, ml: false })
  })
})
