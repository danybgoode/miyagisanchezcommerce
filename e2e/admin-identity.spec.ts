import { test, expect } from '@playwright/test'
import { parseAdminEmails, isAdminUser } from '../lib/admin/identity'

/**
 * Admin identity — pure logic (api gate, no browser, no auth). The server
 * guards (`lib/admin/guard.ts`) resolve the Clerk user and call `isAdminUser`,
 * so the allow/deny decision can't drift from this test. Dual-accept secret
 * behaviour is exercised by the anonymous `/admin` redirect check + the
 * owed-to-Daniel authed admin smoke (Clerk session).
 */

test.describe('admin · parseAdminEmails', () => {
  test('splits, trims, lowercases, de-dupes, drops empties', () => {
    expect(parseAdminEmails('a@x.com, B@X.com ,,a@x.com')).toEqual(['a@x.com', 'b@x.com'])
  })

  test('empty / nullish → []', () => {
    expect(parseAdminEmails('')).toEqual([])
    expect(parseAdminEmails(undefined)).toEqual([])
    expect(parseAdminEmails(null)).toEqual([])
    expect(parseAdminEmails('  ,  , ')).toEqual([])
  })
})

test.describe('admin · isAdminUser', () => {
  const adminEmails = ['admin@miyagisanchez.com']

  test('allows the Clerk role admin (regardless of email)', () => {
    expect(isAdminUser({ role: 'admin', adminEmails: [] })).toBe(true)
    expect(isAdminUser({ role: 'admin', email: 'nobody@x.com', adminEmails: [] })).toBe(true)
  })

  test('allows an allow-listed email (case-insensitive), no role', () => {
    expect(isAdminUser({ email: 'admin@miyagisanchez.com', adminEmails })).toBe(true)
    expect(isAdminUser({ email: ' ADMIN@MiyagiSanchez.com ', adminEmails })).toBe(true)
  })

  test('denies a non-admin role + non-listed email', () => {
    expect(isAdminUser({ role: 'seller', email: 'seller@x.com', adminEmails })).toBe(false)
  })

  test('denies when nothing identifies an admin', () => {
    expect(isAdminUser({ adminEmails })).toBe(false)
    expect(isAdminUser({ email: 'x@y.com', adminEmails: [] })).toBe(false)
    expect(isAdminUser({ email: undefined, role: undefined, adminEmails })).toBe(false)
  })

  test('a non-string role is not admin', () => {
    expect(isAdminUser({ role: true, adminEmails: [] })).toBe(false)
    expect(isAdminUser({ role: { admin: true }, adminEmails: [] })).toBe(false)
  })
})
