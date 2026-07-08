import { test, expect } from '@playwright/test'
import { resolveRentalCheckoutDisplay } from '../lib/rental-checkout-display'

/**
 * Rental line-item pricing (epic 02 · checkout-and-payments) — Sprint 2, Story 2.1.
 *
 * `/checkout`'s rental mode is driven entirely by `resolveRentalCheckoutDisplay` —
 * a pure decision with NO amount parameter (the tamper guarantee: a crafted extra
 * field on the input object is structurally never read, mirroring the backend's
 * `resolveRentalCheckout`). The page redirects to the PDP on any rejection rather
 * than falling through to a single-unit charge. The real Stripe/SPEI money-path
 * smoke is owed to Daniel (flag is OFF in prod) — see sprint-2.md.
 */

// Noon in Mexico City (UTC-6, no DST) — unambiguously "2026-06-10" in both UTC
// and Mexico City, so the past-date tests below aren't accidentally sensitive
// to which timezone "today" is computed in (see the MX-vs-UTC bug this exact
// ambiguity caused, fixed in rental-checkout-display.ts — cross-agent review).
const NOW = Date.parse('2026-06-10T18:00:00Z')
const BASE = { enabled: true, isRentalListing: true, rateCents: 120_000, attrs: { rate_period: 'dia', deposit: 2000 }, nowMs: NOW }

test.describe('rental-checkout-display · resolveRentalCheckoutDisplay', () => {
  test('valid range → the exact breakdown, matching the PDP math', () => {
    const result = resolveRentalCheckoutDisplay({ ...BASE, checkIn: '2026-06-13', checkOut: '2026-06-16' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.breakdown.units).toBe(3)
    expect(result.breakdown.rentCents).toBe(360_000)
    expect(result.breakdown.depositCents).toBe(200_000)
    expect(result.breakdown.totalCents).toBe(560_000)
  })

  test('flag OFF → rejected (today\'s coordination flow)', () => {
    const result = resolveRentalCheckoutDisplay({ ...BASE, enabled: false, checkIn: '2026-06-13', checkOut: '2026-06-16' })
    expect(result.ok).toBe(false)
  })

  test('non-rental listing → rejected', () => {
    const result = resolveRentalCheckoutDisplay({ ...BASE, isRentalListing: false, checkIn: '2026-06-13', checkOut: '2026-06-16' })
    expect(result.ok).toBe(false)
  })

  test('a calendar-rollover date (2026-06-31) is rejected, not silently normalised to Jul 1', () => {
    const result = resolveRentalCheckoutDisplay({ ...BASE, checkIn: '2026-06-31', checkOut: '2026-07-03' })
    expect(result.ok).toBe(false)
  })

  test('malformed date strings are rejected', () => {
    expect(resolveRentalCheckoutDisplay({ ...BASE, checkIn: 'not-a-date', checkOut: '2026-06-16' }).ok).toBe(false)
    expect(resolveRentalCheckoutDisplay({ ...BASE, checkIn: '2026-06-13', checkOut: undefined }).ok).toBe(false)
  })

  test('a check-in in the past is rejected', () => {
    const result = resolveRentalCheckoutDisplay({ ...BASE, checkIn: '2026-06-01', checkOut: '2026-06-05' })
    expect(result.ok).toBe(false)
  })

  test('today as check-in is allowed (not "past")', () => {
    const result = resolveRentalCheckoutDisplay({ ...BASE, checkIn: '2026-06-10', checkOut: '2026-06-12' })
    expect(result.ok).toBe(true)
  })

  test('MX-vs-UTC regression: a same-day check-in picked in the evening (Mexico City) is NOT rejected as "past"', () => {
    // 2026-06-11T02:00:00Z = 2026-06-10 20:00 in Mexico City (UTC-6, no DST) — UTC
    // has already rolled to the 11th while it's still the 10th locally. A pure-UTC
    // "today" would wrongly reject checkIn='2026-06-10' as in the past, even though
    // the PDP's own `today` (Mexico City) accepted it moments earlier.
    const eveningMx = Date.parse('2026-06-11T02:00:00Z')
    const result = resolveRentalCheckoutDisplay({ ...BASE, nowMs: eveningMx, checkIn: '2026-06-10', checkOut: '2026-06-12' })
    expect(result.ok).toBe(true)
  })

  test('a non-positive range (check-out <= check-in) is rejected', () => {
    expect(resolveRentalCheckoutDisplay({ ...BASE, checkIn: '2026-06-16', checkOut: '2026-06-13' }).ok).toBe(false)
    expect(resolveRentalCheckoutDisplay({ ...BASE, checkIn: '2026-06-13', checkOut: '2026-06-13' }).ok).toBe(false)
  })

  test('a zero/missing rate is rejected rather than charging nothing', () => {
    const result = resolveRentalCheckoutDisplay({ ...BASE, rateCents: 0, checkIn: '2026-06-13', checkOut: '2026-06-16' })
    expect(result.ok).toBe(false)
  })

  test('zero deposit still resolves (rent-only total)', () => {
    const result = resolveRentalCheckoutDisplay({ ...BASE, attrs: { rate_period: 'dia' }, checkIn: '2026-06-13', checkOut: '2026-06-16' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.breakdown.depositCents).toBe(0)
    expect(result.breakdown.totalCents).toBe(360_000)
  })

  test('tamper guarantee: the input has no amount field to smuggle a client-chosen total through', () => {
    // Structural, not runtime — TypeScript's RentalCheckoutDisplayInput shape has
    // no amount/price override property, so a crafted `{ ...BASE, amountCents: 1 }`
    // extra key is simply never read (JS ignores excess object properties passed
    // through a typed parameter at runtime, same as the backend's RentalCheckoutInput).
    const crafted = { ...BASE, checkIn: '2026-06-13', checkOut: '2026-06-16', amountCents: 1, totalCents: 1 }
    const result = resolveRentalCheckoutDisplay(crafted as never)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.breakdown.totalCents).toBe(560_000) // unaffected by the crafted fields
  })
})

test.describe('rental-checkout · /checkout anonymous redirect preserves dates', () => {
  test('an anonymous request redirects to sign-in, carrying checkIn/checkOut through redirect_url', async ({ request }) => {
    const res = await request.get('/checkout?listingId=prod_rentaltest&checkIn=2026-08-01&checkOut=2026-08-03', { maxRedirects: 0 })
    expect([301, 302, 303, 307, 308]).toContain(res.status())
    const location = res.headers()['location'] ?? ''
    expect(location).toContain('/sign-in')
    const decoded = decodeURIComponent(location)
    expect(decoded).toContain('checkIn=2026-08-01')
    expect(decoded).toContain('checkOut=2026-08-03')
  })
})
