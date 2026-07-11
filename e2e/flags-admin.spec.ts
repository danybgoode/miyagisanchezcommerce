import { expect, test } from '@playwright/test'
import {
  FLAG_META,
  FLAG_KEYS,
  isKnownFlagKey,
  parseFlagWriteBody,
} from '../lib/flags-admin'

/**
 * Pure-seam coverage for the admin flag-control surface (epic 09 · feature-flags-inhouse,
 * Sprint 2). No browser, no network — proves the key/body validation the write route
 * (`POST /api/admin/flags`) composes. The authed 200-upsert path runs anonymous in the
 * api project (→ 401), so THIS is where the reject-unknown-key / reject-non-boolean logic
 * is actually asserted; `admin-flags-api.spec.ts` covers only the 401 gate.
 */

test.describe('flags-admin · FLAG_META / FLAG_KEYS', () => {
  test('covers all 26 known flags with a polarity + a matching fail-open default', () => {
    expect(FLAG_KEYS).toHaveLength(26)
    for (const key of FLAG_KEYS) {
      const meta = FLAG_META[key]
      expect(meta.polarity === 'killswitch' || meta.polarity === 'enablement').toBe(true)
      // Every enablement fails open OFF; kill-switches default ON *except* ml.sync_enabled
      // and catalog.bulk_enabled (fail-CLOSED by function, seed OFF).
      if (meta.polarity === 'enablement') expect(meta.default).toBe(false)
    }
    // Spot-check the two live kill-switches default ON and one enablement defaults OFF.
    expect(FLAG_META['checkout.stripe_enabled']).toEqual({ polarity: 'killswitch', default: true })
    expect(FLAG_META['pdp_redesign']).toEqual({ polarity: 'killswitch', default: true })
    expect(FLAG_META['subdomain.paywall_enabled']).toEqual({ polarity: 'enablement', default: false })
    expect(FLAG_META['ml.sync_enabled']).toEqual({ polarity: 'killswitch', default: false })
    // The ML-sync paid-SKU entitlement gate (S5) — enablement, fail-open OFF (no paywall).
    expect(FLAG_META['ml.sync_paywall_enabled']).toEqual({ polarity: 'enablement', default: false })
    // ML order materialization (ml-orders-native S1) — enablement, fail-open OFF (stock
    // sync only, no order, until the live materialization smoke passes).
    expect(FLAG_META['ml.orders_enabled']).toEqual({ polarity: 'enablement', default: false })
    // The personal-MCP-URL auth path (seller-agent-connect-mcp-url S2) — enablement,
    // fail-open OFF (legacy Bearer-token flow only until the auth path is verified).
    expect(FLAG_META['seller_agent.connector_url_enabled']).toEqual({ polarity: 'enablement', default: false })
    // The seller profit surface + ledger writes (profit-analyzer S1) — enablement,
    // fail-open OFF (ships dark; append-only ledger + backfill make a late flip lossless).
    expect(FLAG_META['ops.profit_enabled']).toEqual({ polarity: 'enablement', default: false })
    // Net-remittance promoter close (promoter-funnel-v2 S4) — enablement, fail-open OFF
    // (Stripe-only close checkout until the live transfer smoke passes).
    expect(FLAG_META['promoter.transfer_enabled']).toEqual({ polarity: 'enablement', default: false })
    // The print-configurator's artwork/custom-fields addition (custom-print-products
    // S3.4) — kill-switch, fail-open ON. Gates only the S3 addition, not
    // Sprint 2's underlying variant/tier buy box (see lib/flags.ts's comment).
    expect(FLAG_META['configurator.enabled']).toEqual({ polarity: 'killswitch', default: true })
    // Rental line-item pricing (rental-backend-line-item-pricing S1) — enablement,
    // fail-open OFF (backend 422s a rental checkout until the money smoke passes).
    expect(FLAG_META['checkout.rental_pricing_enabled']).toEqual({ polarity: 'enablement', default: false })
    // Medusa-order buyer-id resolution for Envíos/Devoluciones dispatch
    // (buyer-notifications-money-path S1) — kill-switch, fail-open ON.
    expect(FLAG_META['notifications.buyer_moneypath_enabled']).toEqual({ polarity: 'killswitch', default: true })
    // Runtime copy-override merge seam + Sprint 3 announcements
    // (admin-content-and-announcements) — kill-switch, fail-open ON.
    expect(FLAG_META['content.overrides_enabled']).toEqual({ polarity: 'killswitch', default: true })
    // Staged bulk actions (catalog-management S3) — kill-switch, fail-CLOSED like
    // ml.sync_enabled: a bulk action can mutate hundreds of products in one call.
    expect(FLAG_META['catalog.bulk_enabled']).toEqual({ polarity: 'killswitch', default: false })
    // Seller shell over /sell + /sell/setup for a signed-in owner (catalog-management
    // S6) — kill-switch, fail-open ON (today's target behavior; OFF is the deliberate
    // instant rollback to buyer chrome).
    expect(FLAG_META['seller.shell_on_sell_enabled']).toEqual({ polarity: 'killswitch', default: true })
  })
})

test.describe('flags-admin · isKnownFlagKey', () => {
  test('accepts a known key, rejects an unknown one or a non-string', () => {
    expect(isKnownFlagKey('checkout.stripe_enabled')).toBe(true)
    expect(isKnownFlagKey('pdp_redesign')).toBe(true)
    expect(isKnownFlagKey('not.a_flag')).toBe(false)
    expect(isKnownFlagKey('')).toBe(false)
    expect(isKnownFlagKey(42)).toBe(false)
    expect(isKnownFlagKey(null)).toBe(false)
    expect(isKnownFlagKey(undefined)).toBe(false)
    // A prototype key must not read as known (hasOwnProperty guard).
    expect(isKnownFlagKey('toString')).toBe(false)
  })
})

test.describe('flags-admin · parseFlagWriteBody', () => {
  test('accepts a valid { key, enabled } body (both boolean values)', () => {
    expect(parseFlagWriteBody({ key: 'pdp_redesign', enabled: false })).toEqual({
      ok: true,
      key: 'pdp_redesign',
      enabled: false,
    })
    expect(parseFlagWriteBody({ key: 'promoter.enabled', enabled: true })).toEqual({
      ok: true,
      key: 'promoter.enabled',
      enabled: true,
    })
  })

  test('rejects an unknown flag key', () => {
    const r = parseFlagWriteBody({ key: 'made.up_flag', enabled: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('Flag desconocida.')
  })

  test('rejects a non-boolean enabled (no coercion — a mutation rejects)', () => {
    for (const enabled of ['true', 1, 0, null, undefined] as const) {
      const r = parseFlagWriteBody({ key: 'pdp_redesign', enabled })
      expect(r.ok, String(enabled)).toBe(false)
    }
  })

  test('rejects missing fields / non-object bodies', () => {
    for (const body of [null, undefined, 42, 'x', [], {}, { key: 'pdp_redesign' }] as const) {
      expect(parseFlagWriteBody(body).ok, JSON.stringify(body)).toBe(false)
    }
  })
})
