import { test, expect } from '@playwright/test'
import type { NextRequest } from 'next/server'
import { shopSlugFromHost, isReservedSubdomain, ROOT_DOMAIN } from '../lib/subdomain'
import { detectChannel } from '../lib/channel'

/**
 * Subdomains · US-1. Pure-logic guards on host→slug resolution and channel
 * attribution — the rules middleware trusts to white-label a shop subdomain
 * without ever hijacking the apex, www, previews, or auth/infra subdomains.
 * No network; deterministic.
 */
test.describe('subdomain · shopSlugFromHost', () => {
  test('a single-label shop subdomain → its slug', () => {
    expect(shopSlugFromHost('mi-tienda.miyagisanchez.com')).toBe('mi-tienda')
    expect(shopSlugFromHost('Mi-Tienda.MIYAGISANCHEZ.com:443')).toBe('mi-tienda') // case + port
  })

  test('apex / www / vercel / localhost → null', () => {
    expect(shopSlugFromHost('miyagisanchez.com')).toBeNull()
    expect(shopSlugFromHost('www.miyagisanchez.com')).toBeNull()
    expect(shopSlugFromHost('my-branch.vercel.app')).toBeNull()
    expect(shopSlugFromHost('localhost:3001')).toBeNull()
    expect(shopSlugFromHost('')).toBeNull()
    expect(shopSlugFromHost(null)).toBeNull()
  })

  test('multi-label subdomains → null (only direct children are shops)', () => {
    expect(shopSlugFromHost('a.b.miyagisanchez.com')).toBeNull()
  })

  test('reserved / infra labels never resolve to a shop', () => {
    for (const label of ['admin', 'api', 'app', 'clerk', 'accounts', 'mail', 'cdn', 'shop', 's', 'mschz']) {
      expect(shopSlugFromHost(`${label}.miyagisanchez.com`)).toBeNull()
      expect(isReservedSubdomain(label)).toBe(true)
    }
  })

  test('a custom domain (not under the root) → null', () => {
    expect(shopSlugFromHost('tienda.com')).toBeNull()
    expect(shopSlugFromHost('shop.tienda.mx')).toBeNull()
  })

  test('malformed label (bad slug) → null', () => {
    expect(shopSlugFromHost('-bad.miyagisanchez.com')).toBeNull()
    expect(shopSlugFromHost('ab.miyagisanchez.com')).toBeNull() // < 3 chars
  })

  test('ROOT_DOMAIN is the platform apex', () => {
    expect(ROOT_DOMAIN).toBe('miyagisanchez.com')
  })
})

test.describe('subdomain · channel attribution', () => {
  test('x-miyagi-channel: subdomain → detectChannel "subdomain"', () => {
    const req = { headers: new Headers({ 'x-miyagi-channel': 'subdomain' }) } as unknown as NextRequest
    expect(detectChannel(req)).toBe('subdomain')
  })
})
