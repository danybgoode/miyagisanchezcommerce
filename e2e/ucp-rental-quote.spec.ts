import { test, expect } from '@playwright/test'
import { resolveUcpRentalQuote, rentalPricingHint } from '../lib/ucp/rental-quote'

/**
 * Rental line-item pricing (epic 02 · checkout-and-payments) — Sprint 3, Story 3.1.
 *
 * `resolveUcpRentalQuote` is the UCP-facing wrapper around `resolveRentalCheckoutDisplay`
 * (S2.1's pure seam) — same math, same validation ladder, so an agent's quote can
 * never drift from what `/checkout` charges. These cases mirror `rental-checkout.
 * spec.ts`'s pure-seam coverage (frozen `nowMs`, same fixture shape) plus the
 * UCP-specific formatting/reason additions. The live-HTTP + MCP round-trip smoke
 * is fixture-gated (MS_TEST_RENTAL_LISTING_ID) — see sprint-3.md for the owed gap
 * (no test rental listing exists in prod yet, same gap S1/S2 already flagged).
 */

// Noon in Mexico City (UTC-6, no DST) — matches rental-checkout.spec.ts's NOW so a
// past-date/today-boundary case behaves identically to the pure seam it wraps.
const NOW = Date.parse('2026-06-10T18:00:00Z')
const BASE = {
  enabled: true,
  isRentalListing: true,
  rateCents: 120_000,
  attrs: { rate_period: 'dia', deposit: 2000 },
  currency: 'MXN',
  nowMs: NOW,
}

test.describe('resolveUcpRentalQuote', () => {
  test('valid range → the exact UCP quote shape, matching the pure-seam math', () => {
    const result = resolveUcpRentalQuote({ ...BASE, checkIn: '2026-06-13', checkOut: '2026-06-16' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote).toEqual({
      check_in: '2026-06-13',
      check_out: '2026-06-16',
      nights: 3,
      units: 3,
      rate_period: 'dia',
      rate_cents: 120_000,
      rent_cents: 360_000,
      deposit_cents: 200_000,
      total_cents: 560_000,
      formatted: expect.stringContaining('5,600'),
    })
  })

  test('flag OFF → rejected with an agent-legible reason, no quote', () => {
    const result = resolveUcpRentalQuote({ ...BASE, enabled: false, checkIn: '2026-06-13', checkOut: '2026-06-16' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason.length).toBeGreaterThan(0)
  })

  test('non-rental listing → rejected with a distinct reason', () => {
    const result = resolveUcpRentalQuote({ ...BASE, isRentalListing: false, checkIn: '2026-06-13', checkOut: '2026-06-16' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('no es una renta')
  })

  test('malformed / calendar-rollover dates are rejected, not silently normalised', () => {
    expect(resolveUcpRentalQuote({ ...BASE, checkIn: '2026-06-31', checkOut: '2026-07-03' }).ok).toBe(false)
    expect(resolveUcpRentalQuote({ ...BASE, checkIn: 'not-a-date', checkOut: '2026-06-16' }).ok).toBe(false)
    expect(resolveUcpRentalQuote({ ...BASE, checkIn: '2026-06-13', checkOut: undefined }).ok).toBe(false)
  })

  test('a check-in in the past is rejected', () => {
    expect(resolveUcpRentalQuote({ ...BASE, checkIn: '2026-06-01', checkOut: '2026-06-05' }).ok).toBe(false)
  })

  test('a non-positive range (check-out <= check-in) is rejected', () => {
    expect(resolveUcpRentalQuote({ ...BASE, checkIn: '2026-06-13', checkOut: '2026-06-13' }).ok).toBe(false)
  })

  test('deposit-in-pesos normalises to cents the same way readDepositCents does', () => {
    const result = resolveUcpRentalQuote({ ...BASE, attrs: { rate_period: 'semana', deposit: '1500.5' }, checkIn: '2026-06-13', checkOut: '2026-06-27' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.deposit_cents).toBe(150_050)
    expect(result.quote.rate_period).toBe('semana')
    expect(result.quote.units).toBe(2) // 14 noches / 7 = 2 semanas
  })

  test('zero deposit still resolves (rent-only total)', () => {
    const result = resolveUcpRentalQuote({ ...BASE, attrs: { rate_period: 'dia' }, checkIn: '2026-06-13', checkOut: '2026-06-16' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.deposit_cents).toBe(0)
    expect(result.quote.total_cents).toBe(360_000)
  })

  test('tamper guarantee: no amount field exists to smuggle a client-chosen total through', () => {
    const crafted = { ...BASE, checkIn: '2026-06-13', checkOut: '2026-06-16', total_cents: 1, amountCents: 1 }
    const result = resolveUcpRentalQuote(crafted as never)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.quote.total_cents).toBe(560_000) // unaffected by the crafted fields
  })
})

test.describe('rentalPricingHint', () => {
  test('labels the rate clearly as per-period, never the full price', () => {
    const hint = rentalPricingHint({ rateCents: 120_000, attrs: { rate_period: 'dia', deposit: 2000 }, currency: 'MXN' })
    expect(hint).toContain('/día')
    expect(hint).toContain('check_in')
    expect(hint).toContain('check_out')
  })

  test('omits the deposit clause when there is none', () => {
    const hint = rentalPricingHint({ rateCents: 120_000, attrs: { rate_period: 'mes' }, currency: 'MXN' })
    expect(hint).not.toContain('depósito')
    expect(hint).toContain('/mes')
  })
})

// ── Live HTTP round-trip (fixture-gated) ─────────────────────────────────────
// No rental listing exists in prod yet (owed to Daniel, same gap S1/S2 already
// flagged) — these skip gracefully until MS_TEST_RENTAL_LISTING_ID is set.
const RENTAL_LISTING_ID = process.env.MS_TEST_RENTAL_LISTING_ID

test.describe('ucp checkout-session · rental quoting (fixture-gated)', () => {
  test('a dated request returns rental_quote and price/line_total reflect the total', async ({ request }) => {
    test.skip(!RENTAL_LISTING_ID, 'Set MS_TEST_RENTAL_LISTING_ID (a public, priced rental listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: RENTAL_LISTING_ID, check_in: '2026-12-01', check_out: '2026-12-04' },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()

    expect(session.rental_quote).toBeTruthy()
    expect(session.rental_quote.check_in).toBe('2026-12-01')
    expect(session.rental_quote.check_out).toBe('2026-12-04')
    expect(session.rental_pricing_hint).toBeFalsy()
    expect(session.quantity).toBe(1)
    if (session.price) expect(session.price.amount_cents).toBe(session.rental_quote.total_cents)
    if (session.line_total) expect(session.line_total.amount_cents).toBe(session.rental_quote.total_cents)

    // Any available instant method must carry the dates through to the real
    // charging rail (/checkout), never the legacy date-blind endpoints.
    for (const opt of session.payment_options ?? []) {
      if (opt.instant && opt.checkout_url) {
        expect(opt.checkout_url).toContain('/checkout?')
        expect(opt.checkout_url).toContain('checkIn=2026-12-01')
        expect(opt.checkout_url).toContain('checkOut=2026-12-04')
      }
    }
  })

  test('a date-less request labels the rate per-period with a hint, no quote', async ({ request }) => {
    test.skip(!RENTAL_LISTING_ID, 'Set MS_TEST_RENTAL_LISTING_ID (a public, priced rental listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', { data: { listing_id: RENTAL_LISTING_ID } })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()

    expect(session.rental_quote).toBeFalsy()
    expect(typeof session.rental_pricing_hint).toBe('string')
    expect(session.rental_pricing_hint.length).toBeGreaterThan(0)
  })

  test('an invalid range on the flag-enabled listing rejects with a hint, never a wrong quote', async ({ request }) => {
    test.skip(!RENTAL_LISTING_ID, 'Set MS_TEST_RENTAL_LISTING_ID (a public, priced rental listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: RENTAL_LISTING_ID, check_in: '2026-12-04', check_out: '2026-12-01' },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()

    expect(session.rental_quote).toBeFalsy()
    expect(session.rental_pricing_hint).toBeTruthy()

    // Cross-agent review catch: a rejected dated request must NOT leave the
    // date-blind instant methods (MP/Stripe) available — that would let an
    // agent "succeed" at a one-unit charge for the exact dates just refused.
    const mp = (session.payment_options ?? []).find((o: { method: string }) => o.method === 'mercadopago')
    const stripe = (session.payment_options ?? []).find((o: { method: string }) => o.method === 'stripe')
    if (mp) expect(mp.available).toBe(false)
    if (stripe) expect(stripe.available).toBe(false)
  })
})

// ── Non-rental regression ────────────────────────────────────────────────────
// Reuses the existing event-listing fixture (ucp-checkout-quantity.spec.ts) so
// this doesn't need its own dedicated fixture: a non-rental listing must never
// carry rental fields, dated or not.
const EVENT_LISTING_ID = process.env.MS_TEST_EVENT_LISTING_ID

test.describe('ucp checkout-session · non-rental unchanged (fixture-gated)', () => {
  test('rental_quote/rental_pricing_hint are absent for a non-rental listing, dates or not', async ({ request }) => {
    test.skip(!EVENT_LISTING_ID, 'Set MS_TEST_EVENT_LISTING_ID (a public, priced non-rental listing) to run this.')

    const res = await request.post('/api/ucp/checkout-session', {
      data: { listing_id: EVENT_LISTING_ID, check_in: '2026-12-01', check_out: '2026-12-04' },
    })
    expect(res.ok()).toBeTruthy()
    const session = await res.json()
    expect(session.rental_quote ?? null).toBeNull()
    expect(session.rental_pricing_hint ?? null).toBeNull()
  })
})
