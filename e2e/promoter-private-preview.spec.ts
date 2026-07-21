import { test, expect } from '@playwright/test'
import {
  PREVIEW_TOKEN_PREFIX,
  generatePreviewToken,
  hashPreviewToken,
  isWellFormedPreviewToken,
} from '../lib/preview-token'
import { isPromoterShopOwner, canAnchorPreview } from '../lib/promoter-close'

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
    for (const bad of [
      '', 'nope', PREVIEW_TOKEN_PREFIX, 'ms_agent_abc', 'MP_abc', null, undefined, 123,
      // Enforces the documented 256-bit format, not merely the prefix: a short
      // probe, a too-long body, non-hex and uppercase-hex all stop before the DB.
      'mp_x',
      'mp_' + 'a'.repeat(63),
      'mp_' + 'a'.repeat(65),
      'mp_' + 'g'.repeat(64),
      'mp_' + 'A'.repeat(64),
    ]) {
      expect(isWellFormedPreviewToken(bad as unknown)).toBe(false)
    }
  })
})

test.describe('promoter↔shop binding — preview mutations are owner-scoped', () => {
  const shop = (sourceUrl: string | null) => ({
    id: 'shop-uuid', slug: 'panaderia-lupita', name: 'Panadería Lupita',
    clerkUserId: null, medusaSellerId: 'sel_1', sourceUrl, metadata: {},
  })

  test('the creating promoter owns their shop', () => {
    expect(isPromoterShopOwner(shop('promoter://PRM-ABC/panaderia-lupita'), 'PRM-ABC')).toBe(true)
    // Code comparison is case-insensitive (codes are normalized uppercase).
    expect(isPromoterShopOwner(shop('promoter://PRM-ABC/panaderia-lupita'), 'prm-abc')).toBe(true)
  })

  test('a DIFFERENT promoter does not own it (the IDOR the check closes)', () => {
    expect(isPromoterShopOwner(shop('promoter://PRM-ABC/panaderia-lupita'), 'PRM-XYZ')).toBe(false)
  })

  test('a code that is merely a PREFIX of the owner code does not match', () => {
    // Guards against `PRM-AB` matching `promoter://PRM-ABC/…` — the trailing
    // slash in the compared prefix is what makes the boundary exact.
    expect(isPromoterShopOwner(shop('promoter://PRM-ABC/panaderia-lupita'), 'PRM-AB')).toBe(false)
  })

  test('a shop with no promoter provenance is owned by nobody', () => {
    expect(isPromoterShopOwner(shop(null), 'PRM-ABC')).toBe(false)
    expect(isPromoterShopOwner(shop('https://example.com/scraped'), 'PRM-ABC')).toBe(false)
  })

  test('an empty/missing promoter code never matches', () => {
    expect(isPromoterShopOwner(shop('promoter://PRM-ABC/x'), '')).toBe(false)
  })
})

test.describe('canAnchorPreview — a preview can never take a live storefront down', () => {
  const shop = (sourceUrl: string | null, clerkUserId: string | null) =>
    ({ sourceUrl, clerkUserId })

  test('the creating promoter may anchor their own UNCLAIMED shop', () => {
    expect(canAnchorPreview(shop('promoter://PRM-ABC/lupita', null), 'PRM-ABC')).toBe(true)
  })

  test('a CLAIMED shop can never be anchored — even by the promoter who created it', () => {
    // The structural guarantee: an anchor hides the storefront, so a shop that a
    // real merchant already owns and trades on is never a "proposal". This holds
    // independently of the binding check, so a binding bypass still can't 404 a
    // live merchant.
    expect(canAnchorPreview(shop('promoter://PRM-ABC/lupita', 'user_123'), 'PRM-ABC')).toBe(false)
  })

  test('another promoter may not anchor someone else’s shop', () => {
    expect(canAnchorPreview(shop('promoter://PRM-ABC/lupita', null), 'PRM-XYZ')).toBe(false)
  })

  test('a shop with no promoter provenance may not be anchored', () => {
    expect(canAnchorPreview(shop(null, null), 'PRM-ABC')).toBe(false)
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
    // Well-formed-but-unknown (passes format validation, must still 404) and
    // outright malformed both return the ordinary not-found experience.
    for (const token of [`${PREVIEW_TOKEN_PREFIX}${'0'.repeat(64)}`, `${PREVIEW_TOKEN_PREFIX}deadbeef`]) {
      const res = await request.get(`/preview/${token}`)
      expect(res.status()).toBe(404)
    }
  })
})
