import { test, expect } from '@playwright/test'
import { resolveOrigin, isUsableHost } from '../lib/request-origin'

/**
 * fix/stripe-connect-redirect-bugs — regression coverage for the
 * `0.0.0.0:8080` redirect Daniel hit reconnecting Stripe locally.
 */
test.describe('isUsableHost · rejects obviously-broken Host values', () => {
  test('rejects 0.0.0.0 (with or without a port)', () => {
    expect(isUsableHost('0.0.0.0')).toBe(false)
    expect(isUsableHost('0.0.0.0:8080')).toBe(false)
  })

  test('rejects undefined/null/empty-string Host values', () => {
    expect(isUsableHost('undefined')).toBe(false)
    expect(isUsableHost('null')).toBe(false)
    expect(isUsableHost('')).toBe(false)
    expect(isUsableHost(null)).toBe(false)
    expect(isUsableHost(undefined)).toBe(false)
  })

  test('accepts a real hostname, with or without a port', () => {
    expect(isUsableHost('miyagisanchez.com')).toBe(true)
    expect(isUsableHost('localhost:3001')).toBe(true)
  })
})

test.describe('resolveOrigin · prefers NEXT_PUBLIC_SITE_URL, sanitizes the Host fallback', () => {
  test('uses siteUrl when set, stripping a trailing slash', () => {
    expect(resolveOrigin({ siteUrl: 'https://miyagisanchez.com/', host: '0.0.0.0:8080' }))
      .toBe('https://miyagisanchez.com')
  })

  test('falls back to a usable Host header when siteUrl is unset', () => {
    expect(resolveOrigin({ siteUrl: undefined, host: 'preview-123.vercel.app' }))
      .toBe('https://preview-123.vercel.app')
  })

  test('throws (does not silently build a broken redirect) when siteUrl is unset and Host is 0.0.0.0', () => {
    expect(() => resolveOrigin({ siteUrl: undefined, host: '0.0.0.0:8080' })).toThrow()
  })

  test('throws when both siteUrl and host are missing', () => {
    expect(() => resolveOrigin({ siteUrl: null, host: null })).toThrow()
  })
})
