import { test, expect } from '@playwright/test'
import {
  DEFAULT_PREFS,
  CHANNEL_DEFAULTS,
  EVENT_GROUPS,
  resolvePrefs,
  isChannelEnabled,
  telegramTarget,
  groupForEvent,
  EVENT_GROUP,
} from '../lib/notifications/preferences'

/**
 * Granular Multi-Channel Notifications · Sprint 1 + Sprint 2.
 * Pure-logic guards on the seller-preference resolver — the seam every channel
 * trusts. No network, no auth; deterministic. Covers the default contract
 * (email/push default-on = zero regression; telegram opt-in = off), the
 * event→group mapping, and the Telegram target resolution.
 */

test.describe('notification preferences · defaults', () => {
  test('DEFAULT_PREFS follows the per-channel default (email/push on, telegram off)', () => {
    for (const g of EVENT_GROUPS) {
      expect(DEFAULT_PREFS[g].email).toBe(true)
      expect(DEFAULT_PREFS[g].push).toBe(true)
      expect(DEFAULT_PREFS[g].telegram).toBe(false)   // opt-in — Sprint 2
    }
    expect(CHANNEL_DEFAULTS).toEqual({ email: true, push: true, telegram: false })
  })

  test('zero rows resolves to the per-channel defaults', () => {
    const prefs = resolvePrefs([])
    for (const g of EVENT_GROUPS) {
      expect(isChannelEnabled(prefs, g, 'email')).toBe(true)
      expect(isChannelEnabled(prefs, g, 'push')).toBe(true)
      expect(isChannelEnabled(prefs, g, 'telegram')).toBe(false)
    }
  })

  test('null/undefined rows are safe → defaults', () => {
    expect(isChannelEnabled(resolvePrefs(null), 'orders', 'email')).toBe(true)
    expect(isChannelEnabled(resolvePrefs(undefined), 'offers', 'push')).toBe(true)
    expect(isChannelEnabled(resolvePrefs(null), 'orders', 'telegram')).toBe(false)
  })
})

test.describe('notification preferences · telegram target', () => {
  const onPrefs = resolvePrefs([{ event_group: 'orders', channel: 'telegram', enabled: true }])

  test('returns the linked chat_id when the group is on for Telegram', () => {
    expect(telegramTarget(onPrefs, 'orders', { chat_id: '999' })).toBe('999')
  })

  test('returns null when the seller has no linked chat', () => {
    expect(telegramTarget(onPrefs, 'orders', null)).toBeNull()
  })

  test('returns null when the group is off for Telegram (default opt-in off)', () => {
    const offPrefs = resolvePrefs([])   // telegram defaults off
    expect(telegramTarget(offPrefs, 'orders', { chat_id: '999' })).toBeNull()
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

  test('the Sprint-3 money-path event maps to the payments group', () => {
    expect(groupForEvent('buyer_reported_paid')).toBe('payments')
  })

  test('the Sprint-3 return event maps to the returns group', () => {
    expect(groupForEvent('return_requested')).toBe('returns')
  })

  test('every settings group is wired to at least one event (no half-wired group)', () => {
    const wired = new Set(Object.values(EVENT_GROUP))
    for (const g of EVENT_GROUPS) expect(wired).toContain(g)
  })

  test('every mapped group is a known EVENT_GROUP', () => {
    for (const g of Object.values(EVENT_GROUP)) {
      expect(EVENT_GROUPS).toContain(g)
    }
  })
})

test.describe('notification preferences · money-path (buyer_reported_paid) respects prefs', () => {
  // S3.1: the buyer's "Ya hice el pago" fans out to the seller's enabled channels
  // under the payments group. These pure guards prove the gating the dispatcher
  // trusts — a disabled channel stays silent; an enabled one resolves a target.
  const group = groupForEvent('buyer_reported_paid')   // 'payments'

  test('default-on: email + push fire, telegram opt-in stays off', () => {
    const prefs = resolvePrefs([])
    expect(isChannelEnabled(prefs, group, 'email')).toBe(true)
    expect(isChannelEnabled(prefs, group, 'push')).toBe(true)
    expect(isChannelEnabled(prefs, group, 'telegram')).toBe(false)
  })

  test('payments → telegram ON + linked chat resolves the seller chat', () => {
    const prefs = resolvePrefs([{ event_group: 'payments', channel: 'telegram', enabled: true }])
    expect(telegramTarget(prefs, group, { chat_id: '555' })).toBe('555')
  })

  test('payments → email OFF silences email but leaves push on', () => {
    const prefs = resolvePrefs([{ event_group: 'payments', channel: 'email', enabled: false }])
    expect(isChannelEnabled(prefs, group, 'email')).toBe(false)
    expect(isChannelEnabled(prefs, group, 'push')).toBe(true)
  })

  test('payments → telegram OFF resolves no target even with a linked chat', () => {
    const prefs = resolvePrefs([{ event_group: 'payments', channel: 'telegram', enabled: false }])
    expect(telegramTarget(prefs, group, { chat_id: '555' })).toBeNull()
  })
})
