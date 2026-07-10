import { test, expect } from '@playwright/test'
import {
  normalizeHostname,
  isConflict,
  cfErrorMessage,
  type CfCustomHostname,
} from '../lib/cloudflare-domains'
import { CNAME_TARGET } from '../lib/domain-utils'

/**
 * lib/cloudflare-domains.ts — Sprint 4 Story 4.1 (frontend-vercel-to-cloudrun).
 *
 * Pure response-mapping specs for the Cloudflare Custom Hostnames seam that
 * replaces lib/vercel-domains.ts. No network — asserts the mapping from a raw
 * Cloudflare API shape to the provider-neutral DomainStatus contract that
 * app/api/sell/shop/domain/route.ts actually depends on.
 */

function fixture(overrides: Partial<CfCustomHostname> = {}): CfCustomHostname {
  return {
    id: 'cf-hostname-id-1',
    hostname: 'tienda.com',
    status: 'pending',
    ...overrides,
  }
}

test.describe('cloudflare-domains · normalizeHostname', () => {
  test('active hostname → verified, no error', () => {
    const status = normalizeHostname(fixture({ status: 'active' }))
    expect(status.verified).toBe(true)
    expect(status.error).toBeNull()
    expect(status.cname_target).toBe(CNAME_TARGET)
  })

  test('active_redeploying counts as verified (Cloudflare\'s own "still live" state)', () => {
    const status = normalizeHostname(fixture({ status: 'active_redeploying' }))
    expect(status.verified).toBe(true)
  })

  test('pending hostname → not verified', () => {
    const status = normalizeHostname(fixture({ status: 'pending' }))
    expect(status.verified).toBe(false)
  })

  test('pending hostname surfaces the SSL validation error when present', () => {
    const status = normalizeHostname(fixture({
      status: 'pending',
      ssl: { status: 'pending_validation', validation_errors: [{ message: 'DNS record not found' }] },
    }))
    expect(status.verified).toBe(false)
    expect(status.error).toBe('DNS record not found')
  })

  test('ownership_verification maps into the verification challenge list', () => {
    const status = normalizeHostname(fixture({
      ownership_verification: { type: 'txt', name: '_cf-custom-hostname.tienda.com', value: 'abc123' },
    }))
    expect(status.verification).toContainEqual({
      type: 'txt',
      domain: '_cf-custom-hostname.tienda.com',
      value: 'abc123',
      reason: 'ownership_verification',
    })
  })

  test('ssl validation_records map into the verification challenge list alongside ownership', () => {
    const status = normalizeHostname(fixture({
      ownership_verification: { type: 'txt', name: 'own.tienda.com', value: 'ownval' },
      ssl: { validation_records: [{ txt_name: '_acme-challenge.tienda.com', txt_value: 'sslval' }] },
    }))
    expect(status.verification).toHaveLength(2)
    expect(status.verification[1]).toEqual({
      type: 'txt',
      domain: '_acme-challenge.tienda.com',
      value: 'sslval',
      reason: 'ssl_validation',
    })
  })

  test('no ownership/ssl records → empty verification list, not undefined', () => {
    const status = normalizeHostname(fixture())
    expect(status.verification).toEqual([])
  })
})

test.describe('cloudflare-domains · isConflict', () => {
  test('HTTP 409 is always a conflict', () => {
    expect(isConflict(409, {})).toBe(true)
  })

  test('Cloudflare error code 1406 (hostname exists elsewhere) is a conflict', () => {
    expect(isConflict(400, { errors: [{ code: 1406 }] })).toBe(true)
  })

  test('Cloudflare error code 1409 (duplicate custom hostname) is a conflict', () => {
    expect(isConflict(400, { errors: [{ code: 1409 }] })).toBe(true)
  })

  test('an unrelated 400 is not a conflict', () => {
    expect(isConflict(400, { errors: [{ code: 1000 }] })).toBe(false)
  })

  test('no errors array at all is not a conflict', () => {
    expect(isConflict(500, {})).toBe(false)
  })
})

test.describe('cloudflare-domains · cfErrorMessage', () => {
  test('extracts the first error message when present', () => {
    expect(cfErrorMessage({ errors: [{ message: 'bad hostname' }] }, 'fallback')).toBe('bad hostname')
  })

  test('falls back when no errors array is present', () => {
    expect(cfErrorMessage({}, 'fallback')).toBe('fallback')
  })

  test('falls back when the error has no message field', () => {
    expect(cfErrorMessage({ errors: [{ code: 1000 }] }, 'fallback')).toBe('fallback')
  })
})
