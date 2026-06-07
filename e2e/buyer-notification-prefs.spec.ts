import { test, expect } from '@playwright/test'
import {
  BUYER_EVENT_GROUPS,
  BUYER_DEFAULT_PREFS,
  BUYER_FORCED_ON,
  BUYER_GROUP_COPY,
  CHANNEL_DEFAULTS,
  EVENT_GROUPS,
  resolveBuyerPrefs,
  isBuyerChannelEnabled,
  isBuyerForcedCell,
  buyerTelegramTarget,
  groupForBuyerEvent,
  BUYER_EVENT_GROUP,
  resolvePrefs,
  isChannelEnabled,
  type BuyerEventGroup,
} from '../lib/notifications/preferences'

/**
 * Buyer Telegram channel + Buyer preference center · Sprint 1.
 * Pure-logic guards on the BUYER resolver — the seam every buyer channel trusts.
 * No network, no auth; deterministic. Proves the four invariants: default-on
 * parity, the FORCED-ON receipt cell, buyer/seller audience isolation, and the
 * Telegram target resolution (Sprint 2 wires the actual send).
 */

test.describe('buyer prefs · defaults', () => {
  test('buyer defaults follow the per-channel default (email/push on, telegram off)', () => {
    for (const g of BUYER_EVENT_GROUPS) {
      expect(isBuyerChannelEnabled(BUYER_DEFAULT_PREFS, g, 'email')).toBe(true)
      expect(isBuyerChannelEnabled(BUYER_DEFAULT_PREFS, g, 'push')).toBe(true)
      // Compras×Telegram still follows the opt-in default like every other cell.
      expect(isBuyerChannelEnabled(BUYER_DEFAULT_PREFS, g, 'telegram')).toBe(false)
    }
    // Buyer reuses the shared channel defaults verbatim.
    expect(CHANNEL_DEFAULTS).toEqual({ email: true, push: true, telegram: false })
  })

  test('zero/null/undefined rows resolve to the buyer defaults', () => {
    for (const rows of [[], null, undefined]) {
      const prefs = resolveBuyerPrefs(rows)
      expect(isBuyerChannelEnabled(prefs, 'buyer.envios', 'email')).toBe(true)
      expect(isBuyerChannelEnabled(prefs, 'buyer.ofertas', 'push')).toBe(true)
      expect(isBuyerChannelEnabled(prefs, 'buyer.devoluciones', 'telegram')).toBe(false)
    }
  })
})

test.describe('buyer prefs · FORCED-ON receipt (Compras × email)', () => {
  test('the forced cell is buyer.compras × email', () => {
    expect(BUYER_FORCED_ON).toEqual({ group: 'buyer.compras', channel: 'email' })
    expect(isBuyerForcedCell('buyer.compras', 'email')).toBe(true)
    expect(isBuyerForcedCell('buyer.compras', 'push')).toBe(false)
    expect(isBuyerForcedCell('buyer.envios', 'email')).toBe(false)
  })

  test('Compras × email stays ON even when a stored row says OFF (receipt can never be silenced)', () => {
    const prefs = resolveBuyerPrefs([{ event_group: 'buyer.compras', channel: 'email', enabled: false }])
    expect(isBuyerChannelEnabled(prefs, 'buyer.compras', 'email')).toBe(true)
    // The resolved grid itself is forced (not just the accessor), so any consumer is safe.
    expect(prefs['buyer.compras'].email).toBe(true)
  })

  test('Compras push/telegram remain togglable (only the receipt email is locked)', () => {
    const prefs = resolveBuyerPrefs([
      { event_group: 'buyer.compras', channel: 'push', enabled: false },
      { event_group: 'buyer.compras', channel: 'email', enabled: false },
    ])
    expect(isBuyerChannelEnabled(prefs, 'buyer.compras', 'email')).toBe(true)   // forced
    expect(isBuyerChannelEnabled(prefs, 'buyer.compras', 'push')).toBe(false)   // honored
  })
})

test.describe('buyer prefs · overlay + suppression', () => {
  test('Envíos → email OFF suppresses email but leaves push on', () => {
    const prefs = resolveBuyerPrefs([{ event_group: 'buyer.envios', channel: 'email', enabled: false }])
    expect(isBuyerChannelEnabled(prefs, 'buyer.envios', 'email')).toBe(false)
    expect(isBuyerChannelEnabled(prefs, 'buyer.envios', 'push')).toBe(true)
    // siblings untouched
    expect(isBuyerChannelEnabled(prefs, 'buyer.ofertas', 'email')).toBe(true)
  })

  test('Devoluciones → email OFF suppresses return-update email', () => {
    const prefs = resolveBuyerPrefs([{ event_group: 'buyer.devoluciones', channel: 'email', enabled: false }])
    expect(isBuyerChannelEnabled(prefs, 'buyer.devoluciones', 'email')).toBe(false)
  })

  test('unknown buyer group/channel rows are ignored (no crash, defaults hold)', () => {
    const prefs = resolveBuyerPrefs([
      { event_group: 'buyer.bogus', channel: 'email', enabled: false },
      { event_group: 'buyer.envios', channel: 'carrier-pigeon', enabled: false },
    ])
    expect(isBuyerChannelEnabled(prefs, 'buyer.envios', 'email')).toBe(true)
  })
})

test.describe('buyer prefs · audience isolation (shared table, namespaced keys)', () => {
  test('seller rows never bleed into the buyer grid', () => {
    // A person who is both: seller turned OFF orders×email; their buyer Compras
    // receipt must be unaffected (and Envíos defaults stay on).
    const mixed = [
      { event_group: 'orders', channel: 'email', enabled: false }, // seller pref
      { event_group: 'buyer.envios', channel: 'push', enabled: false }, // buyer pref
    ]
    const buyer = resolveBuyerPrefs(mixed)
    expect(isBuyerChannelEnabled(buyer, 'buyer.compras', 'email')).toBe(true)  // forced + isolated
    expect(isBuyerChannelEnabled(buyer, 'buyer.envios', 'push')).toBe(false)   // their buyer toggle
  })

  test('buyer rows never bleed into the seller grid', () => {
    const mixed = [
      { event_group: 'buyer.envios', channel: 'email', enabled: false }, // buyer pref
      { event_group: 'orders', channel: 'push', enabled: false },        // seller pref
    ]
    const seller = resolvePrefs(mixed)
    expect(isChannelEnabled(seller, 'orders', 'email')).toBe(true)  // buyer.envios ignored here
    expect(isChannelEnabled(seller, 'orders', 'push')).toBe(false)  // their seller toggle
  })
})

test.describe('buyer prefs · event→group map', () => {
  test('each in-scope buyer event maps to its group', () => {
    expect(groupForBuyerEvent('order_confirmed')).toBe('buyer.compras')
    expect(groupForBuyerEvent('payment_confirmed')).toBe('buyer.compras')
    expect(groupForBuyerEvent('order_shipped')).toBe('buyer.envios')
    expect(groupForBuyerEvent('order_delivered')).toBe('buyer.envios')
    expect(groupForBuyerEvent('offer_accepted')).toBe('buyer.ofertas')
    expect(groupForBuyerEvent('offer_countered')).toBe('buyer.ofertas')
    expect(groupForBuyerEvent('offer_declined')).toBe('buyer.ofertas')
    expect(groupForBuyerEvent('return_requested')).toBe('buyer.devoluciones')
    expect(groupForBuyerEvent('return_accepted')).toBe('buyer.devoluciones')
    expect(groupForBuyerEvent('return_declined')).toBe('buyer.devoluciones')
  })

  test('every buyer settings group is wired to at least one event (no half-wired group)', () => {
    const wired = new Set(Object.values(BUYER_EVENT_GROUP))
    for (const g of BUYER_EVENT_GROUPS) expect(wired).toContain(g)
  })

  test('buyer namespace never collides with seller groups', () => {
    for (const g of BUYER_EVENT_GROUPS) {
      expect(g.startsWith('buyer.')).toBe(true)
      expect(EVENT_GROUPS).not.toContain(g as unknown as (typeof EVENT_GROUPS)[number])
    }
  })
})

test.describe('buyer prefs · telegram target (Sprint 2 wires the send)', () => {
  test('Envíos → telegram ON + linked chat resolves the buyer chat', () => {
    const prefs = resolveBuyerPrefs([{ event_group: 'buyer.envios', channel: 'telegram', enabled: true }])
    expect(buyerTelegramTarget(prefs, 'buyer.envios', { chat_id: '777' })).toBe('777')
  })

  test('no linked chat → null', () => {
    const prefs = resolveBuyerPrefs([{ event_group: 'buyer.envios', channel: 'telegram', enabled: true }])
    expect(buyerTelegramTarget(prefs, 'buyer.envios', null)).toBeNull()
  })

  test('group off for telegram (opt-in default) → null even with a linked chat', () => {
    const prefs = resolveBuyerPrefs([])
    expect(buyerTelegramTarget(prefs, 'buyer.envios', { chat_id: '777' })).toBeNull()
  })
})

test.describe('buyer prefs · settings copy completeness (es-MX)', () => {
  test('every buyer group has a non-empty label + summary', () => {
    for (const g of BUYER_EVENT_GROUPS) {
      expect(BUYER_GROUP_COPY[g]?.label.trim().length).toBeGreaterThan(0)
      expect(BUYER_GROUP_COPY[g]?.summary.trim().length).toBeGreaterThan(0)
    }
  })

  test('no orphan buyer copy (every copy key is a real buyer group)', () => {
    for (const g of Object.keys(BUYER_GROUP_COPY)) {
      expect(BUYER_EVENT_GROUPS).toContain(g as BuyerEventGroup)
    }
  })
})
