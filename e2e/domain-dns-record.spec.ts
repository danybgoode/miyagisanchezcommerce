import { test, expect } from '@playwright/test'
import {
  dnsRecordFor,
  isApexDomain,
  apexOf,
  CNAME_TARGET,
} from '../lib/domain-utils'

/**
 * Custom-domain DNS record selection.
 *
 * Sprint 4 (frontend-vercel-to-cloudrun) provider swap update: Cloudflare for
 * SaaS, unlike Vercel, does not publish a fixed customer-facing apex A-record
 * IP — its documented guidance is CNAME flattening (ALIAS/ANAME) to the same
 * fallback-origin target for apex domains too. `dnsRecordFor` now recommends
 * a CNAME for both apex and subdomain; `isApex` still distinguishes them so
 * the UI can show the "needs registrar ALIAS/ANAME support" caveat. These
 * pure-logic guards lock that contract. No network; deterministic.
 */
test.describe('domain-utils · apex detection', () => {
  test('apexOf handles single- and multi-label TLDs', () => {
    expect(apexOf('tienda.mx')).toBe('tienda.mx')
    expect(apexOf('tienda.com')).toBe('tienda.com')
    expect(apexOf('tienda.com.mx')).toBe('tienda.com.mx')
    expect(apexOf('shop.tienda.com.mx')).toBe('tienda.com.mx')
    expect(apexOf('www.tienda.com')).toBe('tienda.com')
  })

  test('isApexDomain is true only for the registrable root', () => {
    expect(isApexDomain('tienda.com')).toBe(true)
    expect(isApexDomain('tienda.com.mx')).toBe(true)
    expect(isApexDomain('shop.tienda.com')).toBe(false)
    expect(isApexDomain('www.tienda.com.mx')).toBe(false)
  })
})

test.describe('domain-utils · dnsRecordFor', () => {
  test('apex domain → CNAME at @ pointing to the fallback origin (needs registrar ALIAS/ANAME support)', () => {
    const rec = dnsRecordFor('tienda.com')
    expect(rec.type).toBe('CNAME')
    expect(rec.host).toBe('@')
    expect(rec.value).toBe(CNAME_TARGET)
    expect(rec.isApex).toBe(true)
  })

  test('.com.mx apex → CNAME at @ (not mistaken for a subdomain)', () => {
    const rec = dnsRecordFor('tienda.com.mx')
    expect(rec.type).toBe('CNAME')
    expect(rec.host).toBe('@')
    expect(rec.isApex).toBe(true)
  })

  test('subdomain → CNAME on the sub-label pointing to the fallback origin', () => {
    const rec = dnsRecordFor('shop.tienda.com')
    expect(rec.type).toBe('CNAME')
    expect(rec.host).toBe('shop')
    expect(rec.value).toBe(CNAME_TARGET)
    expect(rec.isApex).toBe(false)
  })

  test('subdomain on a .com.mx apex → CNAME on the deep sub-label', () => {
    const rec = dnsRecordFor('store.tienda.com.mx')
    expect(rec.type).toBe('CNAME')
    expect(rec.host).toBe('store')
    expect(rec.isApex).toBe(false)
  })

  test('protocol/path noise is stripped before deciding', () => {
    const rec = dnsRecordFor('https://Tienda.COM/algo')
    expect(rec.type).toBe('CNAME')
    expect(rec.isApex).toBe(true)
  })
})
