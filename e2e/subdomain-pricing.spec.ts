import { test, expect } from '@playwright/test'
import {
  readSubdomainGrant,
  subdomainServeDecision,
  SUBDOMAIN_GRANT_KEY,
  type DomainGrant,
} from '../lib/subdomain-entitlement'
import { deriveDomainEntitlement } from '../lib/domain-entitlement'
import { shopSlugFromHost } from '../lib/subdomain'

/**
 * Subdomain pricing · Sprint 1 (Gate + entitlement + grandfather).
 *
 * A faithful clone of custom-domain-paywall S1, two PURE layers (no auth, no
 * network — the whole gate decision is unit-testable):
 *
 *  1. ENTITLEMENT SEAM — readSubdomainGrant / deriveDomainEntitlement /
 *     subdomainServeDecision prove every branch (flag off / grandfather / comp /
 *     one_time live+expired / subscription / none) AND that the subdomain SKU
 *     reads its OWN grant key (`subdomain_grant`, never `custom_domain_grant`).
 *  2. HOST RESOLUTION — a reserved/infra label never resolves to a shop, so the
 *     gate never even engages for clerk/api/www/apex (host resolution is the
 *     pre-gate; full coverage lives in subdomain.spec.ts).
 *
 * NOT covered here (owed to Daniel — sprint-1.md smoke walkthrough): the live 301
 * path. CI has no FLAGSMITH_ENVIRONMENT_KEY, so isEnabled('subdomain.paywall_enabled')
 * fails open to its default (false ⇒ ungated) and the gate is intentionally inert
 * in CI. Exercising the live 301 (non-entitled subdomain → /s/slug) + the
 * grandfathered render needs the flag flipped on in Flagsmith on a preview.
 */

const GRANDFATHER: DomainGrant = { type: 'grandfather', granted_at: '2026-01-01T00:00:00.000Z', note: 'cutover' }
const COMP: DomainGrant = { type: 'comp', granted_at: '2026-06-30T00:00:00.000Z', note: 'WC26 partner' }
const ONE_TIME_LIVE: DomainGrant = { type: 'one_time', granted_at: '2026-06-01T00:00:00.000Z', expires_at: '2099-01-01T00:00:00.000Z' }
const ONE_TIME_EXPIRED: DomainGrant = { type: 'one_time', granted_at: '2020-01-01T00:00:00.000Z', expires_at: '2021-01-01T00:00:00.000Z' }

test.describe('subdomain-entitlement · deriveDomainEntitlement (reused deriver)', () => {
  test('flag off ⇒ everyone entitled (today’s free-for-all)', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: false, grant: null })).toEqual({
      entitled: true, reason: 'flag_off',
    })
  })

  test('flag on + grandfather / comp / live one-time / active sub ⇒ entitled', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: GRANDFATHER }).reason).toBe('grandfathered')
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: COMP }).reason).toBe('comp')
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: ONE_TIME_LIVE }).reason).toBe('one_time')
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: null, hasActiveSubscription: true }).reason).toBe('subscription')
  })

  test('flag on + expired one-time + no grant/sub ⇒ NOT entitled', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: ONE_TIME_EXPIRED }).entitled).toBe(false)
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: null })).toEqual({ entitled: false, reason: 'none' })
  })

  test('precedence: a grant outranks an absent subscription (survives a lapse)', () => {
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: GRANDFATHER, hasActiveSubscription: false }).reason)
      .toBe('grandfathered')
  })
})

test.describe('subdomain-entitlement · readSubdomainGrant (own key)', () => {
  test('SUBDOMAIN_GRANT_KEY is the subdomain-specific key', () => {
    expect(SUBDOMAIN_GRANT_KEY).toBe('subdomain_grant')
  })

  test('parses a valid grandfather / comp grant off subdomain_grant', () => {
    expect(readSubdomainGrant({ subdomain_grant: GRANDFATHER })).toEqual(GRANDFATHER)
    const noNote = { type: 'comp', granted_at: '2026-06-30T00:00:00.000Z' }
    expect(readSubdomainGrant({ subdomain_grant: noNote })).toEqual(noNote)
  })

  test('reads subdomain_grant, NOT custom_domain_grant (no cross-SKU leak)', () => {
    // A shop grandfathered on the CUSTOM DOMAIN must NOT read as subdomain-granted.
    expect(readSubdomainGrant({ custom_domain_grant: GRANDFATHER })).toBeNull()
    // …and with the paywall on, that shop is NOT entitled on the subdomain.
    const grant = readSubdomainGrant({ custom_domain_grant: GRANDFATHER })
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant }).entitled).toBe(false)
  })

  test('returns null for missing / malformed grants (corrupt never entitles)', () => {
    expect(readSubdomainGrant(null)).toBeNull()
    expect(readSubdomainGrant({})).toBeNull()
    expect(readSubdomainGrant({ subdomain_grant: { type: 'bogus', granted_at: '2026-01-01' } })).toBeNull()
    expect(readSubdomainGrant({ subdomain_grant: { type: 'grandfather' } })).toBeNull()
    // a one_time with no expires_at is malformed → null (can't entitle forever)
    expect(readSubdomainGrant({ subdomain_grant: { type: 'one_time', granted_at: '2026-01-01T00:00:00.000Z' } })).toBeNull()
  })
})

test.describe('subdomain-entitlement · subdomainServeDecision (the gate branch)', () => {
  test('redirect ONLY when (flag on AND not entitled)', () => {
    expect(subdomainServeDecision({ paywallEnabled: true, grant: null })).toBe('redirect')
    expect(subdomainServeDecision({ paywallEnabled: true, grant: ONE_TIME_EXPIRED })).toBe('redirect')
  })

  test('white-label when flag off, or grandfathered / comp / live one-time', () => {
    expect(subdomainServeDecision({ paywallEnabled: false, grant: null })).toBe('white-label')
    expect(subdomainServeDecision({ paywallEnabled: true, grant: GRANDFATHER })).toBe('white-label')
    expect(subdomainServeDecision({ paywallEnabled: true, grant: COMP })).toBe('white-label')
    expect(subdomainServeDecision({ paywallEnabled: true, grant: ONE_TIME_LIVE })).toBe('white-label')
    expect(subdomainServeDecision({ paywallEnabled: true, grant: null, hasActiveSubscription: true })).toBe('white-label')
  })
})

test.describe('subdomain-pricing · gate never engages for reserved labels', () => {
  test('a reserved/infra label → null slug (pre-gate; no shop, no gate)', () => {
    expect(shopSlugFromHost('clerk.miyagisanchez.com')).toBeNull()
    expect(shopSlugFromHost('miyagisanchez.com')).toBeNull()
    expect(shopSlugFromHost('a-real-shop.miyagisanchez.com')).toBe('a-real-shop')
  })
})
