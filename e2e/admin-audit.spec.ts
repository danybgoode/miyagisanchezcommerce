import { test, expect } from '@playwright/test'
import {
  isAuditedMethod,
  auditActionLabel,
  auditTargetFromPath,
  redactAuditPayload,
} from '../lib/admin/audit'

/**
 * Admin consolidation · Sprint 2.1 — audit summary builder.
 * Pure-logic guards on the `admin_audit_log` row builder that `withAdmin` trusts
 * on every admin mutation. No network; deterministic. The live "a real mutation
 * inserts a row with my Clerk id/email" check is owed to Daniel (admin session).
 */

test.describe('admin audit · audited methods', () => {
  test('mutating verbs are audited, reads are not', () => {
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE', 'post', 'patch']) {
      expect(isAuditedMethod(m)).toBe(true)
    }
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) {
      expect(isAuditedMethod(m)).toBe(false)
    }
  })
})

test.describe('admin audit · action label + target', () => {
  test('action label is method + path, method upper-cased', () => {
    expect(auditActionLabel('patch', '/api/admin/print/social/abc')).toBe(
      'PATCH /api/admin/print/social/abc',
    )
  })

  test('target is the trailing id for a per-row route', () => {
    expect(auditTargetFromPath('/api/admin/print/social/sub_123')).toBe('sub_123')
    expect(auditTargetFromPath('/api/admin/print/providers/prov_9')).toBe('prov_9')
  })

  test('target is null for a collection/verb route (no per-row id)', () => {
    expect(auditTargetFromPath('/api/admin/referrals/config')).toBeNull()
    expect(auditTargetFromPath('/api/supply/batches')).toBeNull()
    expect(auditTargetFromPath('/api/admin/coupons')).toBeNull()
  })
})

test.describe('admin audit · redaction (never store a secret)', () => {
  test('credential-looking keys are redacted by name', () => {
    const out = redactAuditPayload({
      web_visible: true,
      secret: 'super-secret-value',
      api_key: 'sk_live_xyz',
      authorization: 'Bearer abc',
      token: 't0ken',
      password: 'hunter2',
    })
    expect(out.web_visible).toBe(true)
    expect(out.secret).toBe('[redacted]')
    expect(out.api_key).toBe('[redacted]')
    expect(out.authorization).toBe('[redacted]')
    expect(out.token).toBe('[redacted]')
    expect(out.password).toBe('[redacted]')
    // No secret value survives anywhere in the serialised summary.
    expect(JSON.stringify(out)).not.toContain('super-secret-value')
    expect(JSON.stringify(out)).not.toContain('sk_live_xyz')
    expect(JSON.stringify(out)).not.toContain('hunter2')
  })

  test('long strings are truncated; nested objects/arrays summarised by shape', () => {
    const out = redactAuditPayload({
      note: 'x'.repeat(500),
      tiers: [1, 2, 3],
      meta: { a: 1, b: 2 },
    })
    expect(String(out.note).length).toBeLessThanOrEqual(201)
    expect(out.tiers).toEqual({ _type: 'array', length: 3 })
    expect(out.meta).toEqual({ _type: 'object', keys: 2 })
  })

  test('non-object / null bodies summarise by shape, not echo', () => {
    expect(redactAuditPayload(null)).toEqual({})
    expect(redactAuditPayload(undefined)).toEqual({})
    expect(redactAuditPayload([1, 2])).toEqual({ _type: 'array', length: 2 })
    expect(redactAuditPayload('hello')).toEqual({ _type: 'string' })
  })
})
