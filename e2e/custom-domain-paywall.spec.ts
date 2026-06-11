import { test, expect } from '@playwright/test'
import {
  deriveDomainEntitlement,
  readDomainGrant,
  type DomainGrant,
} from '../lib/domain-entitlement'

/**
 * Custom-domain paywall · Sprint 1 (Gate + entitlement).
 *
 * Two layers, mirroring the established pattern (pure seam + auth boundary):
 *
 *  1. PURE SEAM — deriveDomainEntitlement / readDomainGrant unit-tested directly.
 *     This is the whole decision logic for "may this shop connect a domain?" and
 *     proves every branch (flag off / grandfather / comp / subscription / none)
 *     without auth or network.
 *
 *  2. AUTH BOUNDARY — the gated connect/provision routes still reject anonymous
 *     callers (401), confirming the paywall change didn't break the pre-existing
 *     auth check that precedes it.
 *
 * NOT covered here (owed to Daniel — sprint-1.md smoke walkthrough): the live
 * 402 path. CI has no FLAGSMITH_ENVIRONMENT_KEY, so isEnabled('domain.paywall_enabled')
 * fails open to its default (false ⇒ ungated) — the gate is intentionally inert
 * in CI. Exercising the 402 + the rendered upsell needs the flag flipped on in
 * Flagsmith AND a real Clerk seller session.
 */

const GRANDFATHER: DomainGrant = { type: 'grandfather', granted_at: '2026-01-01T00:00:00.000Z', note: 'cutover' }
const COMP: DomainGrant = { type: 'comp', granted_at: '2026-06-10T00:00:00.000Z', note: 'WC26 partner' }

test.describe('domain-entitlement · deriveDomainEntitlement', () => {
  test('flag off ⇒ everyone entitled (today’s free behavior)', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: false, grant: null })).toEqual({
      entitled: true, reason: 'flag_off',
    })
    // flag off wins even with no grant and no subscription
    expect(deriveDomainEntitlement({ paywallEnabled: false, grant: null, hasActiveSubscription: false }).entitled).toBe(true)
  })

  test('flag on + grandfather grant ⇒ entitled', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: GRANDFATHER })).toEqual({
      entitled: true, reason: 'grandfathered',
    })
  })

  test('flag on + comp grant ⇒ entitled', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: COMP })).toEqual({
      entitled: true, reason: 'comp',
    })
  })

  test('flag on + active subscription (S2 hook) ⇒ entitled', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: null, hasActiveSubscription: true })).toEqual({
      entitled: true, reason: 'subscription',
    })
  })

  test('flag on + no grant + no subscription ⇒ NOT entitled', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: null })).toEqual({
      entitled: false, reason: 'none',
    })
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: null, hasActiveSubscription: false }).entitled).toBe(false)
  })

  test('precedence: a grant is honored over an absent subscription', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: GRANDFATHER, hasActiveSubscription: false }).reason)
      .toBe('grandfathered')
  })
})

test.describe('domain-entitlement · readDomainGrant', () => {
  test('parses a valid grandfather grant off metadata', () => {
    expect(readDomainGrant({ custom_domain_grant: GRANDFATHER })).toEqual(GRANDFATHER)
  })

  test('parses a valid comp grant (note optional)', () => {
    const noNote = { type: 'comp', granted_at: '2026-06-10T00:00:00.000Z' }
    expect(readDomainGrant({ custom_domain_grant: noNote })).toEqual(noNote)
  })

  test('returns null for missing / empty metadata', () => {
    expect(readDomainGrant(null)).toBeNull()
    expect(readDomainGrant(undefined)).toBeNull()
    expect(readDomainGrant({})).toBeNull()
    expect(readDomainGrant({ settings: {} })).toBeNull()
  })

  test('returns null for malformed grants (bad type, missing granted_at)', () => {
    expect(readDomainGrant({ custom_domain_grant: { type: 'bogus', granted_at: '2026-01-01' } })).toBeNull()
    expect(readDomainGrant({ custom_domain_grant: { type: 'grandfather' } })).toBeNull()
    expect(readDomainGrant({ custom_domain_grant: { type: 'grandfather', granted_at: '' } })).toBeNull()
    expect(readDomainGrant({ custom_domain_grant: 'grandfather' })).toBeNull()
  })

  test('a malformed grant + flag on ⇒ NOT entitled (corrupt value never grants)', () => {
    const grant = readDomainGrant({ custom_domain_grant: { type: 'bogus' } })
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant }).entitled).toBe(false)
  })
})

test.describe('domain connect/provision routes · auth boundary', () => {
  test('POST /api/sell/shop/domain rejects anonymous', async ({ request }) => {
    const res = await request.post('/api/sell/shop/domain', { data: { domain: 'paywall-smoke.example' } })
    expect(res.status()).toBe(401)
  })

  test('DELETE /api/sell/shop/domain rejects anonymous', async ({ request }) => {
    const res = await request.delete('/api/sell/shop/domain')
    expect(res.status()).toBe(401)
  })

  test('POST /api/sell/shop/domain/cloudflare rejects anonymous', async ({ request }) => {
    const res = await request.post('/api/sell/shop/domain/cloudflare', { data: { cf_token: 'x' } })
    expect(res.status()).toBe(401)
  })

  test('GET /api/sell/shop/domain/cloudflare/oauth/start rejects anonymous', async ({ request }) => {
    const res = await request.get('/api/sell/shop/domain/cloudflare/oauth/start', { maxRedirects: 0 })
    expect(res.status()).toBe(401)
  })

  // Sprint 2: the buy route is also auth-gated (a checkout can't be started
  // anonymously). Live card purchase is owed to Daniel (sprint-2.md smoke).
  test('POST /api/sell/shop/domain/subscribe rejects anonymous', async ({ request }) => {
    const res = await request.post('/api/sell/shop/domain/subscribe')
    expect(res.status()).toBe(401)
  })
})

/**
 * Sprint 2 — the lapse contract expressed through the pure deriver. The webhook
 * flips the Medusa subscription status; entitlement is derived from whether an
 * active subscription remains. So "active ⇒ entitled, lapsed ⇒ not entitled
 * (flag on, no grant)" is exactly the deriver's subscription/none branches.
 */
test.describe('domain-entitlement · S2 subscription lifecycle', () => {
  test('paid + active ⇒ entitled; lapsed (no active sub) + flag on ⇒ NOT entitled', () => {
    // bought + active → hasActiveSubscription true
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: null, hasActiveSubscription: true }).entitled).toBe(true)
    // canceled lapse → hasActiveSubscription false → reverts to free addressing (gated)
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: null, hasActiveSubscription: false })).toEqual({
      entitled: false, reason: 'none',
    })
  })

  test('a grandfathered shop survives a lapse (grant outranks subscription)', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: GRANDFATHER, hasActiveSubscription: false }).entitled).toBe(true)
  })
})
