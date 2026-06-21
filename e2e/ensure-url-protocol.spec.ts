import { test, expect } from '@playwright/test'
import { ensureUrlProtocol } from '../lib/url'

test.describe('ensureUrlProtocol · normalize scheme-less booking_url (S1.1)', () => {
  test('prepends https:// to a scheme-less link, preserving the path', () => {
    expect(ensureUrlProtocol('cal.com/refacciones/visita')).toBe('https://cal.com/refacciones/visita')
  })

  test('preserves query + fragment on a scheme-less link', () => {
    expect(ensureUrlProtocol('cal.com/foo?month=2026-07#slot')).toBe('https://cal.com/foo?month=2026-07#slot')
  })

  test('leaves an https:// link unchanged', () => {
    expect(ensureUrlProtocol('https://cal.com/refacciones/visita')).toBe('https://cal.com/refacciones/visita')
  })

  test('leaves an http:// link unchanged (does not upgrade scheme)', () => {
    expect(ensureUrlProtocol('http://calendly.com/shop')).toBe('http://calendly.com/shop')
  })

  test('prepends https:// to a scheme-less domain that merely starts with "http" (no false positive)', () => {
    expect(ensureUrlProtocol('httpbin.org/foo')).toBe('https://httpbin.org/foo')
  })

  test('recognizes an uppercase scheme (does not double-prepend)', () => {
    expect(ensureUrlProtocol('HTTPS://cal.com/shop')).toBe('HTTPS://cal.com/shop')
  })

  test('trims surrounding whitespace before deciding', () => {
    expect(ensureUrlProtocol('  cal.com/foo  ')).toBe('https://cal.com/foo')
  })

  test('returns null for empty / whitespace / nullish input', () => {
    expect(ensureUrlProtocol('')).toBeNull()
    expect(ensureUrlProtocol('   ')).toBeNull()
    expect(ensureUrlProtocol(null)).toBeNull()
    expect(ensureUrlProtocol(undefined)).toBeNull()
  })
})
