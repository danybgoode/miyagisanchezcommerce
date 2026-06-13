import { test, expect } from '@playwright/test'
import { stripShopSecrets } from '../lib/shop-settings/safe-metadata'

/**
 * Shop Settings refactor · Sprint 3 — the secret-strip invariant.
 *
 * The HIGH-risk money/domain/agent sections were extracted out of the monolith.
 * The hard guarantee is that shop metadata reaching the client never carries
 * secrets: MercadoPago OAuth tokens or the hashed MCP agent token. This spec
 * proves the pure strip (used by [section]/page.tsx before the metadata is
 * handed to the client). Pure; no network/auth.
 */

const FULL = {
  ucp_agent_token_hash: 'sha256:deadbeefdeadbeefdeadbeefdeadbeef',
  ucp_agent_token_created_at: '2026-06-10T00:00:00.000Z',
  some_public_field: 'keep-me',
  settings: {
    profile: { name: 'Tienda de prueba' },
    mercadopago: {
      connected: true,
      enabled: true,
      live_mode: true,
      access_token: 'APP_USR-super-secret-access',
      refresh_token: 'TG-super-secret-refresh',
    },
    returns_policy: { window: '14d' },
  },
}

test.describe('shop-settings-secret-strip · invariant', () => {
  test('removes the hashed agent token (+ created-at)', () => {
    const safe = stripShopSecrets(FULL)!
    expect('ucp_agent_token_hash' in safe).toBe(false)
    expect('ucp_agent_token_created_at' in safe).toBe(false)
  })

  test('removes MercadoPago access_token + refresh_token, keeps the public MP flags', () => {
    const safe = stripShopSecrets(FULL)!
    const mp = (safe.settings as any).mercadopago
    expect('access_token' in mp).toBe(false)
    expect('refresh_token' in mp).toBe(false)
    expect(mp).toEqual({ connected: true, enabled: true, live_mode: true })
  })

  test('no secret survives anywhere in the serialized client payload', () => {
    const json = JSON.stringify(stripShopSecrets(FULL))
    expect(json).not.toContain('super-secret-access')
    expect(json).not.toContain('super-secret-refresh')
    expect(json).not.toContain('deadbeef')
  })

  test('preserves every non-secret field untouched', () => {
    const safe = stripShopSecrets(FULL)!
    expect(safe.some_public_field).toBe('keep-me')
    expect((safe.settings as any).profile).toEqual({ name: 'Tienda de prueba' })
    expect((safe.settings as any).returns_policy).toEqual({ window: '14d' })
  })

  test('null / empty / no-MP metadata are safe no-ops', () => {
    expect(stripShopSecrets(null)).toBeNull()
    expect(stripShopSecrets(undefined)).toBeNull()
    // No mercadopago block → returns the (token-stripped) object unchanged otherwise.
    const noMp = { settings: { profile: { name: 'x' } }, ucp_agent_token_hash: 'h' }
    const safe = stripShopSecrets(noMp)!
    expect('ucp_agent_token_hash' in safe).toBe(false)
    expect((safe.settings as any).profile).toEqual({ name: 'x' })
  })

  test('does not mutate the input object', () => {
    const input = JSON.parse(JSON.stringify(FULL))
    stripShopSecrets(input)
    expect(input.ucp_agent_token_hash).toBe('sha256:deadbeefdeadbeefdeadbeefdeadbeef')
    expect(input.settings.mercadopago.access_token).toBe('APP_USR-super-secret-access')
  })
})
