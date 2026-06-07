import { test, expect } from '@playwright/test'
import {
  DEFAULT_PREFS,
  EVENT_GROUPS,
  CHANNELS,
  resolvePrefs,
  isChannelEnabled,
  groupForEvent,
  EVENT_GROUP,
} from '../lib/notifications/preferences'

/**
 * Granular Multi-Channel Notifications · Sprint 1.
 * Pure-logic guards on the seller-preference resolver — the seam every channel
 * trusts. No network, no auth; deterministic. This is the free coverage for the
 * default-on contract (zero regression) and the event→group mapping.
 */

test.describe('notification preferences · defaults', () => {
  test('DEFAULT_PREFS is on for every group × channel (default-on = zero regression)', () => {
    for (const g of EVENT_GROUPS) {
      for (const ch of CHANNELS) {
        expect(DEFAULT_PREFS[g][ch]).toBe(true)
      }
    }
  })

  test('zero rows resolves to all-on defaults', () => {
    const prefs = resolvePrefs([])
    for (const g of EVENT_GROUPS) {
      for (const ch of CHANNELS) {
        expect(isChannelEnabled(prefs, g, ch)).toBe(true)
      }
    }
  })

  test('null/undefined rows are safe → defaults', () => {
    expect(isChannelEnabled(resolvePrefs(null), 'orders', 'email')).toBe(true)
    expect(isChannelEnabled(resolvePrefs(undefined), 'offers', 'push')).toBe(true)
  })
})

test.describe('notification preferences · overlay', () => {
  test('a single off-toggle overrides only that cell; the rest stay on', () => {
    const prefs = resolvePrefs([{ event_group: 'offers', channel: 'email', enabled: false }])
    expect(isChannelEnabled(prefs, 'offers', 'email')).toBe(false)
    // siblings untouched
    expect(isChannelEnabled(prefs, 'offers', 'push')).toBe(true)
    expect(isChannelEnabled(prefs, 'orders', 'email')).toBe(true)
  })

  test('explicit enabled:true is respected (re-enabling a previously-off cell)', () => {
    const prefs = resolvePrefs([{ event_group: 'orders', channel: 'email', enabled: true }])
    expect(isChannelEnabled(prefs, 'orders', 'email')).toBe(true)
  })

  test('unknown group/channel rows are ignored (no crash, defaults hold)', () => {
    const prefs = resolvePrefs([
      { event_group: 'bogus', channel: 'email', enabled: false },
      { event_group: 'orders', channel: 'carrier-pigeon', enabled: false },
    ])
    expect(isChannelEnabled(prefs, 'orders', 'email')).toBe(true)
  })

  test('last row wins for a duplicated cell', () => {
    const prefs = resolvePrefs([
      { event_group: 'payments', channel: 'push', enabled: false },
      { event_group: 'payments', channel: 'push', enabled: true },
    ])
    expect(isChannelEnabled(prefs, 'payments', 'push')).toBe(true)
  })
})

test.describe('notification preferences · event→group map', () => {
  test('the two in-scope Sprint-1 events map to their groups', () => {
    expect(groupForEvent('new_order')).toBe('orders')
    expect(groupForEvent('offer_made')).toBe('offers')
  })

  test('every mapped group is a known EVENT_GROUP', () => {
    for (const g of Object.values(EVENT_GROUP)) {
      expect(EVENT_GROUPS).toContain(g)
    }
  })
})
