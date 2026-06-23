import { test, expect } from '@playwright/test'
import {
  CAMPAIGN_COUPON_CAP,
  couponRedeemable,
  couponRefusalReason,
  formatRedemptionCount,
  classifyStripeFailure,
  isResourceMissing,
  describeStripeFailure,
  type StripeFailureKind,
} from '../lib/domain-coupon'

/**
 * Domain-coupon mint fix · Sprint 1 (api project — pure seam, no Stripe, no network).
 *
 * This is the epic's dedicated home for the pure `lib/domain-coupon.ts` rules. Two
 * layers:
 *
 *  1. ERROR CLASSIFICATION (S1.1) — the new key-free classifier that lets the admin
 *     tool tell a real "coupon not minted yet" (→ null/EMPTY) apart from an
 *     auth/permission/connection failure (→ surfaced). The whole reason the prod
 *     mint failure was invisible. Asserts the message never echoes a secret key.
 *
 *  2. CAP-OF-100 BOUNDARY (S1.4) — the redeemable/refusal/counter rules that mirror
 *     Stripe's own `max_redemptions` enforcement (99 ok / 100 refused / 101 refused).
 *
 * NOT covered here (owed to Daniel — sprint-1.md smoke walkthrough): the live
 * card-4242 redemption (a Stripe test card can't redeem a live coupon; needs a real
 * Clerk seller session + Stripe Checkout), and the prod log/key diagnosis (S1.3,
 * touches prod money creds).
 */

test.describe('domain-coupon · Stripe failure classification (S1.1)', () => {
  test('a real resource-missing ⇒ "missing" (the coupon just isn’t minted yet)', () => {
    // by code
    expect(classifyStripeFailure({ code: 'resource_missing' })).toBe('missing')
    // by 404 status (e.g. a wrong-mode key where the object doesn’t exist in that mode)
    expect(classifyStripeFailure({ statusCode: 404 })).toBe('missing')
    expect(isResourceMissing({ code: 'resource_missing' })).toBe(true)
    expect(isResourceMissing({ statusCode: 404 })).toBe(true)
  })

  test('auth / permission / connection / rate-limit are NEVER classified as missing', () => {
    // These used to all collapse to null ("not minted") — the masking bug.
    expect(classifyStripeFailure({ statusCode: 401, type: 'StripeAuthenticationError' })).toBe('auth')
    expect(classifyStripeFailure({ rawType: 'authentication_error' })).toBe('auth')
    expect(classifyStripeFailure({ statusCode: 403, type: 'StripePermissionError' })).toBe('permission')
    expect(classifyStripeFailure({ type: 'StripeConnectionError' })).toBe('connection')
    expect(classifyStripeFailure({ statusCode: 429, type: 'StripeRateLimitError' })).toBe('rate_limit')

    for (const e of [
      { statusCode: 401 },
      { statusCode: 403 },
      { type: 'StripeConnectionError' },
      { statusCode: 429 },
    ]) {
      expect(isResourceMissing(e)).toBe(false)
    }
  })

  test('a flatly absent/empty key (no HTTP round-trip) ⇒ "auth", not "unknown"', () => {
    // getStripe() throws this before any Stripe call when STRIPE_SECRET_KEY is
    // absent (e.g. a Preview deploy where the key is production-only).
    expect(classifyStripeFailure({ message: 'Missing STRIPE_SECRET_KEY environment variable' })).toBe('auth')
    // Stripe's own empty-key message.
    expect(classifyStripeFailure({ message: 'No API key provided.' })).toBe('auth')
    expect(isResourceMissing({ message: 'Missing STRIPE_SECRET_KEY environment variable' })).toBe(false)
  })

  test('an invalid-request error ⇒ "bad_request" (malformed params, NOT credentials)', () => {
    // The real prod cause: StripeInvalidRequestError, code null — a malformed mint
    // request, not a key problem. Must NOT be lumped as "unknown".
    expect(classifyStripeFailure({ type: 'StripeInvalidRequestError', code: null })).toBe('bad_request')
    expect(classifyStripeFailure({ rawType: 'invalid_request_error' })).toBe('bad_request')
    // a 400 invalid-request carrying the offending param
    expect(classifyStripeFailure({ statusCode: 400, type: 'StripeInvalidRequestError', param: 'promotion' })).toBe('bad_request')
    // but a 404 invalid-request (resource_missing) is still "missing", not bad_request
    expect(classifyStripeFailure({ type: 'StripeInvalidRequestError', statusCode: 404 })).toBe('missing')
    expect(isResourceMissing({ type: 'StripeInvalidRequestError', code: null })).toBe(false)
  })

  test('an unrecognized failure ⇒ "unknown" (still surfaced, never masked)', () => {
    expect(classifyStripeFailure({})).toBe('unknown')
    expect(classifyStripeFailure({ statusCode: 500 })).toBe('unknown')
    expect(isResourceMissing({})).toBe(false)
  })

  test('every surfaced message is non-empty es-MX and never leaks a key/secret', () => {
    const kinds: StripeFailureKind[] = ['missing', 'auth', 'permission', 'connection', 'rate_limit', 'bad_request', 'unknown']
    for (const kind of kinds) {
      const msg = describeStripeFailure(kind)
      expect(msg.length).toBeGreaterThan(0)
      // Sanitization guard: our own copy, never Stripe's raw message → no key
      // prefix or key body of any shape.
      expect(msg).not.toMatch(/sk_(test|live)/i)
      expect(msg.toLowerCase()).not.toContain('bearer')
    }
    // The auth message names the actionable cause (key / mode) for diagnosis.
    expect(describeStripeFailure('auth')).toContain('STRIPE_SECRET_KEY')
  })
})

test.describe('domain-coupon · cap-of-100 boundary (S1.4)', () => {
  const cap = CAMPAIGN_COUPON_CAP // 100

  test('redeemable up to but not including the cap (99 ok, 100 refused, 101 refused)', () => {
    expect(couponRedeemable({ active: true, timesRedeemed: 0, maxRedemptions: cap })).toBe(true)
    expect(couponRedeemable({ active: true, timesRedeemed: 99, maxRedemptions: cap })).toBe(true)
    // the 100th redemption has happened ⇒ the 101st is refused
    expect(couponRedeemable({ active: true, timesRedeemed: 100, maxRedemptions: cap })).toBe(false)
    expect(couponRedeemable({ active: true, timesRedeemed: 101, maxRedemptions: cap })).toBe(false)
  })

  test('an inactive coupon is never redeemable, even below the cap', () => {
    expect(couponRedeemable({ active: false, timesRedeemed: 0, maxRedemptions: cap })).toBe(false)
  })

  test('couponRefusalReason: unknown code, exhausted, or null (proceed)', () => {
    const live = { active: true, timesRedeemed: 0, maxRedemptions: cap }
    const full = { active: true, timesRedeemed: cap, maxRedemptions: cap }
    expect(couponRefusalReason('otro', live)).toBe('unknown')
    expect(couponRefusalReason('miyagisan', live)).toBeNull()
    expect(couponRefusalReason('miyagisan', full)).toBe('exhausted')
    expect(couponRefusalReason('miyagisan', { active: false, timesRedeemed: 0, maxRedemptions: cap })).toBe('exhausted')
  })

  test('formatRedemptionCount renders the n/cap counter', () => {
    expect(formatRedemptionCount(0, cap)).toBe('0/100')
    expect(formatRedemptionCount(1, cap)).toBe('1/100')
    expect(formatRedemptionCount(100, cap)).toBe('100/100')
    expect(formatRedemptionCount(0)).toBe('0/100') // default cap
  })
})

test.describe('domain-coupon · admin route surfaces a definite state (S1.1/S1.2 boundary)', () => {
  // Anonymous callers are refused (admin-gated). The route's *surfaced-error*
  // shape (kind + sanitized message) is exercised by the pure tests above; here
  // we only confirm the guard still holds so the masking fix didn’t open it up.
  test('GET /api/admin/domain-coupon rejects without admin (401)', async ({ request }) => {
    const res = await request.get('/api/admin/domain-coupon')
    expect(res.status()).toBe(401)
  })

  test('POST /api/admin/domain-coupon rejects without admin (401)', async ({ request }) => {
    const res = await request.post('/api/admin/domain-coupon')
    expect(res.status()).toBe(401)
  })
})
