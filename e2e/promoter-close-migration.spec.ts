import { test, expect } from '@playwright/test'
import {
  decideChargeFromQuote,
  decideFlatEligibility,
  MIGRATION_FLAT_LISTING_CAP,
} from '../lib/migration-charge-decision'

/**
 * migration SKU close-from-quote · Sprint 2 (epic 03 · platform-migrations,
 * US-2.2). Pure decision core (no DB, no network) + route-gating, mirroring
 * e2e/promoter-close.spec.ts's style. The real Stripe/Supabase round-trip
 * (a real quote closed, cash + net-remittance variants) is owed to Daniel —
 * see sprint-2.md's smoke walkthrough.
 */

test.describe('migration close · decideChargeFromQuote (the tamper-proof core)', () => {
  test('charges EXACTLY the stored quote total for the matching shop', () => {
    const decision = decideChargeFromQuote({ shop_id: 'shop_1', total_price_cents: 150_000 }, 'shop_1')
    expect(decision).toEqual({ ok: true, amountCents: 150_000 })
  })

  test('the tamper case: there is no amount parameter to spoof — only the quote row decides', () => {
    // Nothing in this function's signature accepts a client-claimed amount, so a
    // "close at $1 instead of the real quote" attempt has no input to act on:
    // whatever a caller might claim elsewhere in a request, this always returns
    // the STORED total for a matching shop, never anything else.
    const quote = { shop_id: 'shop_1', total_price_cents: 250_000 }
    const decision = decideChargeFromQuote(quote, 'shop_1')
    expect(decision.ok).toBe(true)
    expect(decision).toEqual(decideChargeFromQuote({ ...quote }, 'shop_1')) // deterministic, no hidden state
    if (decision.ok) expect(decision.amountCents).toBe(250_000)
  })

  test('a quote belonging to a DIFFERENT shop is refused (403), not silently repriced', () => {
    const decision = decideChargeFromQuote({ shop_id: 'shop_A', total_price_cents: 150_000 }, 'shop_B')
    expect(decision).toEqual({ ok: false, status: 403, error: expect.any(String) })
  })

  test('a quote id that resolved to nothing is refused (404)', () => {
    const decision = decideChargeFromQuote(null, 'shop_1')
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.status).toBe(404)
  })
})

test.describe('migration close · decideFlatEligibility (no-quote-above-threshold refusal)', () => {
  test('no connector batch at all (manual migration) — flat price allowed', () => {
    expect(decideFlatEligibility(null)).toEqual({ ok: true })
  })

  test('at exactly the cap — flat price allowed (boundary)', () => {
    expect(decideFlatEligibility(MIGRATION_FLAT_LISTING_CAP)).toEqual({ ok: true })
  })

  test('one over the cap, no quote — refused (422)', () => {
    const decision = decideFlatEligibility(MIGRATION_FLAT_LISTING_CAP + 1)
    expect(decision.ok).toBe(false)
    if (!decision.ok) expect(decision.status).toBe(422)
  })

  test('well over the cap, no quote — still refused, not silently flat-priced', () => {
    const decision = decideFlatEligibility(5000)
    expect(decision).toEqual({ ok: false, status: 422, error: expect.any(String) })
  })
})

// ── Close route is flag/auth-gated, same shape as the other close routes ────
test.describe('promoter close · migration route respects the kill-switch (flag on OR off)', () => {
  test('POST /api/promoter/close/migration → 404 (hidden) or 401 (live, auth required)', async ({ request }) => {
    const res = await request.post('/api/promoter/close/migration', { data: {} })
    expect([401, 404]).toContain(res.status())
  })
})

test.describe('migration estimate route · gating', () => {
  test('POST /api/sell/shopify/import/parity/estimate → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post('/api/sell/shopify/import/parity/estimate', { data: { batchId: 'x' } })
    expect(res.status()).toBe(401)
  })
})
