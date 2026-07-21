import { test, expect } from '@playwright/test'
import {
  PREVIEW_TOKEN_PREFIX,
  generatePreviewToken,
  hashPreviewToken,
  isWellFormedPreviewToken,
} from '../lib/preview-token'

/**
 * Founding merchant consent-safe previews · Sprint 1 (api project: pure token
 * crypto + anonymous/flag-agnostic route guards — no network dependency for the
 * pure block, no Supabase).
 *
 *  1. PURE TOKEN LOGIC — opacity, prefix, stable hashing, well-formedness. This is
 *     the security-critical seam (an enumerable or non-opaque token would leak the
 *     private preview). Network-free + deterministic → the real gate.
 *  2. ROUTE GUARDS — the mint/revoke route and the render page never serve a
 *     private preview to an anonymous caller, in BOTH flag states (401 flag-on /
 *     404 flag-off), so the assertion isn't coupled to the current flag value.
 *
 * NOT covered here (owed to Daniel — sprint-1.md smoke): the authed promoter
 * create-3-products flow with the flag ON, and the full cross-channel privacy
 * sweep (marketplace/search/PDP/agent/embed/sitemap/subdomain/custom-domain) on a
 * disposable shop. Products are draft-private structurally (every public /store/*
 * seam filters status:'published'); the live sweep confirms it end-to-end.
 */

test.describe('preview token — pure crypto', () => {
  test('generates opaque, prefixed, unique tokens', () => {
    const a = generatePreviewToken()
    const b = generatePreviewToken()
    expect(a.token.startsWith(PREVIEW_TOKEN_PREFIX)).toBe(true)
    // 32 random bytes → 64 hex chars after the prefix.
    expect(a.token.length).toBe(PREVIEW_TOKEN_PREFIX.length + 64)
    // Opaque: no two tokens collide, and the hash is not the token.
    expect(a.token).not.toBe(b.token)
    expect(a.hash).not.toBe(a.token)
    expect(a.hash).not.toBe(b.hash)
  })

  test('hash is a stable SHA-256 hex digest of the token', () => {
    const { token, hash } = generatePreviewToken()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // Deterministic: re-hashing the same token yields the same digest.
    expect(hashPreviewToken(token)).toBe(hash)
  })

  test('rejects malformed tokens before any lookup', () => {
    expect(isWellFormedPreviewToken(generatePreviewToken().token)).toBe(true)
    for (const bad of ['', 'nope', PREVIEW_TOKEN_PREFIX, 'ms_agent_abc', 'MP_abc', null, undefined, 123]) {
      expect(isWellFormedPreviewToken(bad as unknown)).toBe(false)
    }
  })
})

test.describe('preview routes — anonymous guards', () => {
  test('mint route never serves an anonymous caller', async ({ request }) => {
    const res = await request.post('/api/promoter/preview', { data: { slug: 'nonexistent-disposable-shop' } })
    // Flag OFF ⇒ 404 (dark); flag ON ⇒ 401 (anonymous). Never 200.
    expect([401, 404]).toContain(res.status())
  })

  test('revoke route never serves an anonymous caller', async ({ request }) => {
    const res = await request.delete('/api/promoter/preview', { data: { slug: 'nonexistent-disposable-shop' } })
    expect([401, 404]).toContain(res.status())
  })

  test('render page never reveals a shop for a garbage token', async ({ request }) => {
    const res = await request.get(`/preview/${PREVIEW_TOKEN_PREFIX}deadbeefdeadbeef`)
    // Unknown token (flag ON) or dark (flag OFF) both 404; never a 200 shop render.
    expect(res.status()).toBe(404)
  })
})
