import { test, expect } from '@playwright/test'
import { canonicalSourceUrl } from '../lib/url'

/**
 * canonicalSourceUrl normalizes an imported listing's source URL for dedup.
 * Relocated to the pure `lib/url.ts` (shared by the server import path and the
 * client paste UI). These cover the scheme-predicate fix (was `startsWith('http')`,
 * now `/^https?:\/\//i`) — the same false-positive class as `ensureUrlProtocol`.
 */
test.describe('canonicalSourceUrl · scheme predicate (supply dedup)', () => {
  test('canonicalizes a scheme-less host that merely starts with "http" (was returned raw)', () => {
    // Before the fix: startsWith('http') → new URL('httpbin.org/x') throws → raw.
    expect(canonicalSourceUrl('httpbin.org/some/path')).toBe('https://httpbin.org/some/path')
  })

  test('recognizes an uppercase scheme instead of double-prefixing it (was returned raw)', () => {
    expect(canonicalSourceUrl('HTTPS://Example.com/Item')).toBe('https://example.com/Item')
  })

  test('still canonicalizes a normal scheme-less host (host lowercased, www + trailing slash stripped)', () => {
    expect(canonicalSourceUrl('www.Tienda.mx/producto/')).toBe('https://tienda.mx/producto')
  })

  test('preserves the existing MercadoLibre item canonicalization', () => {
    expect(canonicalSourceUrl('https://articulo.mercadolibre.com.mx/MLM-123456789-foo-_JM?ref=x'))
      .toBe('https://articulo.mercadolibre.com.mx/MLM-123456789-foo-_JM')
  })

  test('returns null for empty / whitespace / nullish input', () => {
    expect(canonicalSourceUrl('')).toBeNull()
    expect(canonicalSourceUrl('   ')).toBeNull()
    expect(canonicalSourceUrl(null)).toBeNull()
    expect(canonicalSourceUrl(undefined)).toBeNull()
  })
})
