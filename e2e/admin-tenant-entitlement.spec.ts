import { test, expect } from '@playwright/test'
import {
  buildCompGrant,
  readDomainGrant,
  deriveDomainEntitlement,
} from '../lib/domain-entitlement'

/**
 * Admin tenant entitlement · S4.1 — two concerns, one spec.
 *
 * 1. PURE payload round-trip: the grant action composes a `comp` grant via
 *    `buildCompGrant`, which `readDomainGrant` parses and `deriveDomainEntitlement`
 *    honors — and revoke (no grant) returns the shop to its underlying reason.
 *    This is the contract the `POST /api/admin/tenants/[id]` route writes, covered
 *    without a DB or a browser.
 * 2. AUTH gate: the new route is Clerk-only (`withAdmin`); the `api` project runs
 *    ANONYMOUS, so GET and POST must 401.
 *
 * The audit-row-on-success + the live grant/revoke against a real shop need an
 * admin Clerk session and are owed to Daniel (stated in the PR + sprint smoke).
 */

test.describe('entitlement payload — buildCompGrant round-trips through the seam', () => {
  test('grant composes a comp grant that derives reason "comp"', () => {
    const now = new Date('2026-06-23T12:00:00.000Z')
    const grant = buildCompGrant({ note: '  WC26 partner  ', now })
    expect(grant).toEqual({ type: 'comp', granted_at: now.toISOString(), note: 'WC26 partner' })

    // What the route writes onto marketplace_shops.metadata.
    const metadata = { custom_domain_grant: grant }
    const parsed = readDomainGrant(metadata)
    expect(parsed).toEqual(grant)

    const ent = deriveDomainEntitlement({ paywallEnabled: true, grant: parsed })
    expect(ent).toEqual({ entitled: true, reason: 'comp' })
  })

  test('a blank note is dropped, not stored empty', () => {
    const grant = buildCompGrant({ note: '   ' })
    expect(grant.note).toBeUndefined()
    expect(grant.type).toBe('comp')
    expect(typeof grant.granted_at).toBe('string')
  })

  test('revoke (no grant) returns the underlying reason — none on, flag_off off', () => {
    const revoked = readDomainGrant({}) // key cleared
    expect(revoked).toBeNull()
    expect(deriveDomainEntitlement({ paywallEnabled: true, grant: revoked })).toEqual({
      entitled: false,
      reason: 'none',
    })
    expect(deriveDomainEntitlement({ paywallEnabled: false, grant: revoked })).toEqual({
      entitled: true,
      reason: 'flag_off',
    })
  })
})

test.describe('admin tenant entitlement API · anonymous is rejected', () => {
  const ID = 'shop_uuid_anon'

  test('GET /api/admin/tenants/:id → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get(`/api/admin/tenants/${ID}`)
    expect(res.status()).toBe(401)
  })

  test('POST /api/admin/tenants/:id grant → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post(`/api/admin/tenants/${ID}`, {
      data: { action: 'grant' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/admin/tenants/:id revoke → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post(`/api/admin/tenants/${ID}`, {
      data: { action: 'revoke' },
    })
    expect(res.status()).toBe(401)
  })
})
