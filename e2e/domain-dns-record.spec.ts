import { test, expect } from '@playwright/test'
import {
  dnsRecordFor,
  isApexDomain,
  apexOf,
  CNAME_TARGET,
  APEX_A_RECORD,
} from '../lib/domain-utils'

/**
 * Custom-domain DNS record selection (hotfix · custom-domain DNS verification).
 *
 * The live bug: the Cloudflare automation wrote a CNAME for *every* domain,
 * including apexes — which the verifier (and most registrars) reject. The single
 * source of that decision is `dnsRecordFor`: apex → A record, subdomain → CNAME.
 * These pure-logic guards lock that contract so the regression can't return.
 * No network; deterministic.
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
  test('apex domain → A record at @ pointing to Vercel anycast', () => {
    const rec = dnsRecordFor('tienda.com')
    expect(rec.type).toBe('A')
    expect(rec.host).toBe('@')
    expect(rec.value).toBe(APEX_A_RECORD)
    expect(rec.isApex).toBe(true)
  })

  test('.com.mx apex → A record (not mistaken for a subdomain)', () => {
    const rec = dnsRecordFor('tienda.com.mx')
    expect(rec.type).toBe('A')
    expect(rec.isApex).toBe(true)
  })

  test('subdomain → CNAME on the sub-label pointing to Vercel', () => {
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
    expect(rec.type).toBe('A')
    expect(rec.isApex).toBe(true)
  })
})
