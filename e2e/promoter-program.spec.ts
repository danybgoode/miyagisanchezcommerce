import { test, expect } from '@playwright/test'
import {
  PROMOTER_CODE_PREFIX,
  PROMOTER_CODE_RE,
  PROMOTER_SKUS,
  generatePromoterCode,
  normalizePromoterCode,
  isPromoterCodeShape,
  isPromoterSku,
  computePromoterDiscountCents,
  resolvePromoterDiscount,
  promoterRefusalMessage,
  type Promoter,
  type PromoterSettings,
} from '../lib/promoter'

/**
 * Promoter Program · Sprint 1 (api project — pure seam + anonymous route guards,
 * no network, no Supabase). Two layers, mirroring e2e/domain-coupon.spec.ts:
 *
 *  1. PURE LIB — code-gen (PRM- prefix + ambiguity-free alphabet), discount math
 *     (fixed / percent / cap-at-base), the resolution decision (not_found /
 *     disabled / ok), and the es-MX refusal copy.
 *  2. ROUTE GUARDS — the admin routes reject anonymously (401), and the public
 *     promoter routes are hidden while `promoter.enabled` is off (404) — the
 *     seeded-OFF default in CI/preview where nothing flips it on.
 *
 * NOT covered (owed to Daniel — sprint-1.md smoke walkthrough): the live discount
 * PREVIEW render at the custom-domain checkout with the flag ON (needs a real Clerk
 * seller session + the flag flipped), and the end-to-end attribution row.
 */

const PROMOTER: Promoter = { id: 'promoter_1', code: 'PRM-ABC123', name: 'Test' }
const ENABLED_FIXED: PromoterSettings = { enabled: true, discount_type: 'fixed', discount_amount_cents: 10000 , bundle_skus: [], bundle_price_mxn: null }

test.describe('promoter · code generation + shape', () => {
  test('generated codes carry the PRM- prefix and only unambiguous chars', () => {
    const ambiguous = /[O0I1]/ // excluded from the alphabet
    for (let i = 0; i < 50; i++) {
      const code = generatePromoterCode()
      expect(code.startsWith(PROMOTER_CODE_PREFIX)).toBe(true)
      expect(PROMOTER_CODE_RE.test(code)).toBe(true)
      expect(code.slice(PROMOTER_CODE_PREFIX.length)).not.toMatch(ambiguous)
    }
  })

  test('normalizePromoterCode trims + upper-cases', () => {
    expect(normalizePromoterCode('  prm-abc123 ')).toBe('PRM-ABC123')
    expect(normalizePromoterCode(null)).toBe('')
    expect(normalizePromoterCode(undefined)).toBe('')
  })

  test('isPromoterCodeShape accepts well-formed codes and rejects referral/junk codes', () => {
    expect(isPromoterCodeShape('PRM-ABC123')).toBe(true)
    expect(isPromoterCodeShape('prm-abc123')).toBe(true) // normalized first
    expect(isPromoterCodeShape('ABC123')).toBe(false)    // bare referral code, no prefix
    expect(isPromoterCodeShape('GANAX7K9P')).toBe(false) // referral reward code
    expect(isPromoterCodeShape('PRM-')).toBe(false)       // prefix only
    expect(isPromoterCodeShape('')).toBe(false)
  })

  test('isPromoterSku gates the known SKUs', () => {
    for (const sku of PROMOTER_SKUS) expect(isPromoterSku(sku)).toBe(true)
    expect(isPromoterSku('subscription')).toBe(false)
    expect(isPromoterSku(null)).toBe(false)
    expect(isPromoterSku(undefined)).toBe(false)
  })
})

test.describe('promoter · discount math (computePromoterDiscountCents)', () => {
  test('fixed amount is cents, capped at the base, floored at 0', () => {
    expect(computePromoterDiscountCents('fixed', 10000, 49900)).toBe(10000)
    expect(computePromoterDiscountCents('fixed', 60000, 49900)).toBe(49900) // cap at base
    expect(computePromoterDiscountCents('fixed', 0, 49900)).toBe(0)
    expect(computePromoterDiscountCents('fixed', 10000, 0)).toBe(0)         // no base
  })

  test('percentage is a percent of the base, capped + rounded', () => {
    expect(computePromoterDiscountCents('percentage', 20, 49900)).toBe(9980)
    expect(computePromoterDiscountCents('percentage', 100, 49900)).toBe(49900)
    expect(computePromoterDiscountCents('percentage', 150, 49900)).toBe(49900) // cap at base
    expect(computePromoterDiscountCents('percentage', 10, 12345)).toBe(1235)    // rounds
  })
})

test.describe('promoter · resolution decision (resolvePromoterDiscount)', () => {
  test('unknown code ⇒ not_found', () => {
    const r = resolvePromoterDiscount({ promoter: null, settings: ENABLED_FIXED, itemsCents: 49900 })
    expect(r).toEqual({ ok: false, reason: 'not_found' })
  })

  test('valid code but program disabled ⇒ disabled', () => {
    const r = resolvePromoterDiscount({
      promoter: PROMOTER,
      settings: { ...ENABLED_FIXED, enabled: false },
      itemsCents: 49900,
    })
    expect(r).toEqual({ ok: false, reason: 'disabled' })
  })

  test('valid code but zero discount ⇒ disabled (nothing to preview)', () => {
    const r = resolvePromoterDiscount({
      promoter: PROMOTER,
      settings: { ...ENABLED_FIXED, discount_amount_cents: 0 , bundle_skus: [], bundle_price_mxn: null },
      itemsCents: 49900,
    })
    expect(r).toEqual({ ok: false, reason: 'disabled' })
  })

  test('valid code + active program ⇒ ok with the resolved discount', () => {
    const r = resolvePromoterDiscount({ promoter: PROMOTER, settings: ENABLED_FIXED, itemsCents: 49900 })
    expect(r).toEqual({ ok: true, promoter_id: 'promoter_1', code: 'PRM-ABC123', discount_cents: 10000 })
  })
})

test.describe('promoter · es-MX refusal copy', () => {
  test('every reason yields non-empty es-MX copy with no placeholder/leak', () => {
    for (const reason of ['not_found', 'disabled'] as const) {
      const msg = promoterRefusalMessage(reason)
      expect(msg.length).toBeGreaterThan(0)
      expect(msg).not.toMatch(/undefined|null|TODO|PEGA_|XXX/)
      expect(msg).not.toMatch(/sk_(test|live)/i)
    }
  })
})

test.describe('promoter · admin routes reject anonymously (401)', () => {
  test('GET /api/admin/promoter → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/admin/promoter')
    expect(res.status()).toBe(401)
  })

  test('POST /api/admin/promoter → 401', async ({ request }) => {
    const res = await request.post('/api/admin/promoter', { data: { name: 'x' } })
    expect(res.status()).toBe(401)
  })

  test('GET /api/admin/promoter/attributions → 401', async ({ request }) => {
    const res = await request.get('/api/admin/promoter/attributions?promoterId=x')
    expect(res.status()).toBe(401)
  })
})

test.describe('promoter · public routes respect the kill-switch (flag on OR off)', () => {
  // `promoter.enabled` is a kill-switch ops can toggle either way (launched ON 2026-06-30),
  // so these assert the route's guard holds in BOTH states — no work for a hidden feature
  // or an anonymous caller — without coupling the gate to the current flag value.
  test('GET /api/promoter/validate-code → 404 (hidden) or 200 invalid-code (live)', async ({ request }) => {
    const res = await request.get('/api/promoter/validate-code?code=PRM-ABC123&itemsCents=49900')
    expect([200, 404]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body.valid).toBe(false) // unknown code never previews a discount
    }
  })

  test('POST /api/promoter/attribute → 404 (hidden) or 401 (live, auth required)', async ({ request }) => {
    const res = await request.post('/api/promoter/attribute', { data: { code: 'PRM-ABC123', sku: 'custom_domain' } })
    expect([401, 404]).toContain(res.status())
  })
})
