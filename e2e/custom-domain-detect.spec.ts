import { test, expect } from '@playwright/test'

/**
 * Custom-domain registrar detection (epic 07 · custom-domain-polish).
 *
 * `/api/sell/shop/domain/detect` is the one public, un-authed surface of the
 * custom-domain flow (POST/GET/DELETE are Clerk-gated). It drives the
 * registrar-specific DNS guides, so this guards its contract: a valid registrar
 * enum, correct apex extraction for subdomains, and graceful handling of
 * domains that don't resolve. Read-only — no mutations.
 */
const REGISTRARS = ['cloudflare', 'godaddy', 'namecheap', 'google', 'squarespace', 'unknown']

test.describe('Custom domain — registrar detection', () => {
  test('missing domain param → 400', async ({ request }) => {
    const res = await request.get('/api/sell/shop/domain/detect')
    expect(res.status()).toBe(400)
  })

  test('a resolvable domain returns a valid registrar from the enum', async ({ request }) => {
    const res = await request.get('/api/sell/shop/domain/detect?domain=example.com')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(REGISTRARS).toContain(body.registrar)
    expect(body.domain).toBe('example.com')
    expect(Array.isArray(body.ns)).toBeTruthy()
  })

  test('a subdomain reduces to its registrable apex for the NS lookup', async ({ request }) => {
    const res = await request.get('/api/sell/shop/domain/detect?domain=blog.example.com')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    // The zone (and thus the registrar) lives at the apex, not the subdomain.
    expect(body.domain).toBe('example.com')
    expect(REGISTRARS).toContain(body.registrar)
  })

  test('a non-resolving domain degrades to unknown with 200 (never 500)', async ({ request }) => {
    const res = await request.get('/api/sell/shop/domain/detect?domain=no-such-zone-zzz-12345.invalid')
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.registrar).toBe('unknown')
    expect(body.ns).toEqual([])
  })
})
