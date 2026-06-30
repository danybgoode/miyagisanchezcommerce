import { test, expect } from '@playwright/test'
import { deriveConnectionHealth, isDuplicateLink, REFRESH_SKEW_MS } from '../lib/ml-health'

/**
 * Mercado Libre connect + linkage · Sprint 1 (epic 03 · mercadolibre-sync).
 *
 * The connection store + OAuth exchange live in the Medusa backend module
 * (unreachable from the `api` runner, and these are writes), so this gate covers
 * what the frontend owns:
 *   - the pure health-derivation mirror (US-3) and the linkage duplicate guard (US-2),
 *   - the route auth/flag shape: the OAuth routes never expose a usable surface to
 *     an anonymous caller.
 * The real ML-sandbox OAuth round-trip + encrypted-storage smoke is owed to Daniel
 * (a third-party consent screen can't be automated). See sprint-1.md.
 */

// ── US-3: connection health (pure mirror of the backend) ───────────────────────
test.describe('ml-health · deriveConnectionHealth', () => {
  const now = 1_700_000_000_000

  test('no connection / disconnected / no expiry → disconnected', () => {
    expect(deriveConnectionHealth(null, now).state).toBe('disconnected')
    expect(deriveConnectionHealth(undefined, now).state).toBe('disconnected')
    expect(deriveConnectionHealth({ status: 'disconnected', expires_at: now + 1e9 }, now).state).toBe('disconnected')
    expect(deriveConnectionHealth({ status: 'connected', expires_at: null }, now).state).toBe('disconnected')
  })

  test('past expiry → expired, with a re-connect prompt label', () => {
    const h = deriveConnectionHealth({ status: 'connected', expires_at: now - 1 }, now)
    expect(h.state).toBe('expired')
    expect(h.label_es).toMatch(/vuelve a conectar/i)
  })

  test('within the 5-minute skew → stale', () => {
    expect(deriveConnectionHealth({ status: 'connected', expires_at: now + REFRESH_SKEW_MS - 1 }, now).state).toBe('stale')
  })

  test('comfortably valid → connected, es-MX label', () => {
    const h = deriveConnectionHealth({ status: 'connected', expires_at: now + 1e9 }, now)
    expect(h.state).toBe('connected')
    expect(h.label_es).toBe('Conectado')
  })

  test('accepts ISO strings and Date objects', () => {
    const iso = new Date(now + 1e9).toISOString()
    expect(deriveConnectionHealth({ status: 'connected', expires_at: iso }, now).state).toBe('connected')
    expect(deriveConnectionHealth({ status: 'connected', expires_at: new Date(now - 1) }, now).state).toBe('expired')
  })
})

// ── US-2: linkage 1:1 conflict guard (pure mirror) ─────────────────────────────
test.describe('ml-health · isDuplicateLink (1:1)', () => {
  const existing = [{ product_id: 'prod_1', ml_item_id: 'MLM1' }]

  test('rejects an exact pair, and either side already linked', () => {
    expect(isDuplicateLink(existing, { product_id: 'prod_1', ml_item_id: 'MLM1' })).toBe(true) // exact
    expect(isDuplicateLink(existing, { product_id: 'prod_1', ml_item_id: 'MLM2' })).toBe(true) // product taken
    expect(isDuplicateLink(existing, { product_id: 'prod_2', ml_item_id: 'MLM1' })).toBe(true) // item taken
  })

  test('allows a brand-new product ↔ brand-new ML item pair', () => {
    expect(isDuplicateLink([], { product_id: 'prod_9', ml_item_id: 'MLM9' })).toBe(false)
  })
})

// ── US-1: OAuth route auth/flag shape (against the branch preview in CI) ────────
test.describe('ml OAuth routes · anonymous shape', () => {
  test('DELETE /api/sell/ml/disconnect is 401 for an anonymous caller', async ({ request }) => {
    const res = await request.delete('/api/sell/ml/disconnect')
    expect(res.status()).toBe(401)
  })

  test('GET /api/sell/ml/connect never returns a usable redirect to ML for an anonymous caller', async ({ request }) => {
    const res = await request.get('/api/sell/ml/connect', { maxRedirects: 0 })
    // Anonymous → redirected (to sign-in, or to /shop/manage when the flag is off).
    // The key invariant: it never hands an anonymous caller the ML consent URL.
    expect([301, 302, 303, 307, 308]).toContain(res.status())
    const location = res.headers()['location'] ?? ''
    expect(location).not.toContain('mercadolibre.com')
  })
})
