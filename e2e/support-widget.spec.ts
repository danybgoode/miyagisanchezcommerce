import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  coerceSupportSettings,
  normalizeSupportSettings,
  validateSupportContribution,
} from '../lib/support-widget'

test.describe('Support widget — shared validation', () => {
  test('support settings require exactly three presets inside min/max', () => {
    const tooFew = normalizeSupportSettings({
      enabled: true,
      preset_amount_cents: [5000, 10000],
      custom_min_cents: 2000,
      custom_max_cents: 20000,
      currency: 'mxn',
      default_visibility: 'private',
    })
    expect(tooFew.ok).toBe(false)

    const outsideRange = normalizeSupportSettings({
      enabled: true,
      preset_amount_cents: [5000, 10000, 30000],
      custom_min_cents: 2000,
      custom_max_cents: 20000,
      currency: 'mxn',
      default_visibility: 'private',
    })
    expect(outsideRange.ok).toBe(false)

    const ok = normalizeSupportSettings({
      enabled: true,
      preset_amount_cents: [5000, 10000, 20000],
      custom_min_cents: 2000,
      custom_max_cents: 50000,
      currency: 'mxn',
      default_visibility: 'private',
      support_product_id: 'prod_support',
    })
    expect(ok).toMatchObject({
      ok: true,
      settings: {
        enabled: true,
        preset_amount_cents: [5000, 10000, 20000],
        custom_min_cents: 2000,
        custom_max_cents: 50000,
        currency: 'MXN',
        default_visibility: 'private',
        support_product_id: 'prod_support',
      },
    })
  })

  test('support contribution validation clamps amount/message before checkout', () => {
    const settings = coerceSupportSettings({
      enabled: true,
      preset_amount_cents: [5000, 10000, 20000],
      custom_min_cents: 2000,
      custom_max_cents: 50000,
      currency: 'MXN',
    })

    expect(validateSupportContribution(settings, 1999, '')).toMatchObject({ ok: false })
    expect(validateSupportContribution(settings, 50001, '')).toMatchObject({ ok: false })
    expect(validateSupportContribution(settings, 5000, 'x'.repeat(251))).toMatchObject({ ok: false })
    expect(validateSupportContribution(settings, 5000, '  Gracias  ')).toMatchObject({
      ok: true,
      amount_cents: 5000,
      message: 'Gracias',
    })
  })
})

test.describe('Support widget — public API fail-closed behavior', () => {
  test('support config OPTIONS is CORS-open', async ({ request }) => {
    const res = await request.fetch('/api/embed/support', { method: 'OPTIONS' })
    expect(res.status()).toBe(204)
    expect(res.headers()['access-control-allow-origin']).toBe('*')
    expect(res.headers()['access-control-allow-methods']).toContain('GET')
  })

  test('support config fails closed without a valid enabled embed key', async ({ request }) => {
    const missing = await request.get('/api/embed/support')
    expect(missing.status()).toBe(404)
    expect(await missing.json()).toEqual({ valid: false })

    const malformed = await request.get('/api/embed/support?key=not-a-key')
    expect(malformed.status()).toBe(404)
    expect(await malformed.json()).toEqual({ valid: false })

    const unknown = await request.get('/api/embed/support?key=emb_pk_00000000000000000000000000000000')
    expect(unknown.status()).toBe(404)
    expect(await unknown.json()).toEqual({ valid: false })
  })

  test('support checkout OPTIONS is CORS-open', async ({ request }) => {
    const res = await request.fetch('/api/embed/support/checkout', { method: 'OPTIONS' })
    expect(res.status()).toBe(204)
    expect(res.headers()['access-control-allow-origin']).toBe('*')
    expect(res.headers()['access-control-allow-methods']).toContain('POST')
  })

  test('support checkout fails closed before validation or payment when key is missing', async ({ request }) => {
    const res = await request.post('/api/embed/support/checkout', {
      data: {
        provider: 'stripe',
        amount_cents: 10000,
        supporter_email: 'reader@example.com',
        message: 'Gracias',
        visibility: 'public',
      },
    })
    expect(res.status()).toBe(404)
    expect(res.headers()['access-control-allow-origin']).toBe('*')
    const body = await res.json()
    expect(body.error).toContain('Apoyos')
  })

  test('support checkout lets Medusa resolve the support seller', () => {
    const source = readFileSync(join(process.cwd(), 'app/api/embed/support/checkout/route.ts'), 'utf8')
    expect(source).toContain('productId: support.support_product_id')
    expect(source).not.toContain('sellerId: shop.id')
  })
})
