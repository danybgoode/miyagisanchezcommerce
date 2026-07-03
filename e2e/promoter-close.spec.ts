import { test, expect } from '@playwright/test'
import {
  PAID_BY_PROMOTER_FLAG,
  oneTimeGrantNote,
  promoterSourceUrl,
  buildWhatsAppClaimLink,
} from '../lib/promoter-close'

/**
 * Promoter Program · Sprint 4 — the in-person close (api project: pure seams +
 * anonymous/flag-agnostic route guards, no network, no Supabase). Mirrors
 * e2e/promoter-program.spec.ts.
 *
 *  1. PURE LIB — the WhatsApp claim-link builder, the idempotent promoter source
 *     URL, the paid-by-promoter provenance markers (S4 · US-10/US-11).
 *  2. ROUTE GUARDS — the new authed close routes reject when the program is hidden
 *     (404, flag off) OR when anonymous (401, flag on) — asserted in BOTH states so
 *     the gate isn't coupled to the current `promoter.enabled` value (launched ON
 *     2026-06-30; a single flag-coupled status would go red the moment ops toggles).
 *  3. MINI-SITE — /vende/promotor + its sell-sheet render es-MX (US-12).
 *
 * NOT covered (owed to Daniel — sprint-4.md smoke): the live card charge on a
 * seller's behalf (US-10) and the real Clerk claim transfer (US-11).
 */

test.describe('promoter close · paid-by-promoter provenance markers', () => {
  test('PAID_BY_PROMOTER_FLAG is the string "1" (Stripe metadata is string-only)', () => {
    expect(PAID_BY_PROMOTER_FLAG).toBe('1')
  })

  test('oneTimeGrantNote distinguishes promoter-paid from seller-self', () => {
    expect(oneTimeGrantNote(true)).not.toBe(oneTimeGrantNote(false))
    expect(oneTimeGrantNote(true)).toMatch(/promoter/i)
    expect(oneTimeGrantNote(false)).not.toMatch(/promoter/i)
  })
})

test.describe('promoter close · idempotent source URL (promoterSourceUrl)', () => {
  test('deterministic for the same code + shop name, in the promoter:// namespace', () => {
    const a = promoterSourceUrl('PRM-ABC123', 'Café Don Memo')
    const b = promoterSourceUrl('prm-abc123', 'Café Don Memo') // code normalized
    expect(a).toBe(b)
    expect(a.startsWith('promoter://PRM-ABC123/')).toBe(true)
  })

  test('slugifies the shop name (accents/spaces → ascii) and never empty', () => {
    expect(promoterSourceUrl('PRM-XYZ', 'Tienda Ñandú')).toBe('promoter://PRM-XYZ/tienda-nandu')
    expect(promoterSourceUrl('PRM-XYZ', '   ')).toBe('promoter://PRM-XYZ/tienda') // fallback
  })

  test('distinct shop names under one promoter never collide', () => {
    const a = promoterSourceUrl('PRM-ABC123', 'Tienda Uno')
    const b = promoterSourceUrl('PRM-ABC123', 'Tienda Dos')
    expect(a).not.toBe(b)
  })
})

test.describe('promoter close · WhatsApp claim link (buildWhatsAppClaimLink)', () => {
  const claimUrl = 'https://dashboard.despachobonsai.com/onboarding/claim?token=abc.def.ghi'

  test('wraps the claim URL in a wa.me share-sheet link (no phone number)', () => {
    const link = buildWhatsAppClaimLink({ claimUrl, shopName: 'Mi Tienda' })
    expect(link.startsWith('https://wa.me/?text=')).toBe(true)
    // The claim URL survives encode→decode intact.
    const text = decodeURIComponent(link.slice('https://wa.me/?text='.length))
    expect(text).toContain(claimUrl)
    expect(text).toContain('Mi Tienda')
  })

  test('falls back to a generic name when the shop name is blank', () => {
    const link = buildWhatsAppClaimLink({ claimUrl, shopName: '   ' })
    const text = decodeURIComponent(link.slice('https://wa.me/?text='.length))
    expect(text).toContain('tu tienda')
  })

  test('is fully URL-encoded (no raw spaces or newlines leak into the href)', () => {
    const link = buildWhatsAppClaimLink({ claimUrl, shopName: 'Mi Tienda' })
    expect(link).not.toMatch(/\s/)
  })
})

test.describe('promoter close · authed routes respect the kill-switch (flag on OR off)', () => {
  // flag off ⇒ 404 (hidden); flag on ⇒ 401 (auth required). Asserted in both states.
  const authedPosts = [
    '/api/promoter/me/bind',
    '/api/promoter/shop/setup',
    '/api/promoter/claim/link',
    '/api/promoter/close/domain',
    '/api/promoter/close/subdomain',
    '/api/promoter/close/print',
    '/api/promoter/close/ml-sync',
    '/api/promoter/close/listing', // Sprint 5 · US-5.1
  ]
  for (const path of authedPosts) {
    test(`POST ${path} → 404 (hidden) or 401 (live, auth required)`, async ({ request }) => {
      const res = await request.post(path, { data: {} })
      expect([401, 404]).toContain(res.status())
    })
  }

  // Sprint 5 · US-5.6 — GET, not POST, same guard shape.
  test('GET /api/promoter/rate-card → 404 (hidden) or 401 (live, auth required)', async ({ request }) => {
    const res = await request.get('/api/promoter/rate-card')
    expect([401, 404]).toContain(res.status())
  })
})

test.describe('promoter close · resources mini-site renders es-MX (US-12)', () => {
  test('GET /vende/promotor → 200 with the es-MX glossary', async ({ request }) => {
    const res = await request.get('/vende/promotor', { headers: { Accept: 'text/html' } })
    expect(res.status()).toBe(200)
    const html = await res.text()
    expect(html).toContain('Dominio propio')   // glossary term
    expect(html).toContain('Subdominio')
  })

  test('GET /vende/promotor → the trust prompt resolves {url} to its own page (agent-discovery S1.2)', async ({ request }) => {
    const res = await request.get('/vende/promotor', { headers: { Accept: 'text/html' } })
    expect(res.status()).toBe(200)
    const html = await res.text()
    // Regression guard: the promoter mini-site isn't a registered SellerPersonaId, so its
    // trustPrompt used to render the raw, unresolved "{url}" template placeholder.
    expect(html).not.toContain('{url}')
    expect(html).toContain('https://miyagisanchez.com/vende/promotor')
  })

  test('GET /vende/promotor/sell-sheet → 200 printable sell-sheet', async ({ request }) => {
    const res = await request.get('/vende/promotor/sell-sheet', { headers: { Accept: 'text/html' } })
    expect(res.status()).toBe(200)
    const html = await res.text()
    expect(html).toContain('Guardar como PDF') // the .no-print toolbar hint
  })
})

test.describe('promoter close · the public CTA never links to a 404 (promoter-funnel-fixes S1.2)', () => {
  test('GET /promotor/cerrar → redirect (flag on, anon → sign-in) or 404 (flag off)', async ({ request }) => {
    const res = await request.get('/promotor/cerrar', { maxRedirects: 0 })
    expect([301, 302, 303, 307, 308, 404]).toContain(res.status())
  })

  test('anonymous /vende/promotor never links the close-workspace CTA to a 404, and never links it at all (promoter-funnel-v2 US-1.3)', async ({ request }) => {
    // Fire both requests concurrently (not sequentially) so a flag toggle landing
    // between them can't desync the two reads — and both routes read the same 60s
    // in-process cache (lib/flags.ts) regardless, so this is already a vanishingly
    // narrow window (codex cross-review should-fix on PR #157).
    const [page, close] = await Promise.all([
      request.get('/vende/promotor', { headers: { Accept: 'text/html' } }),
      request.get('/promotor/cerrar', { maxRedirects: 0 }),
    ])
    expect(page.status()).toBe(200)
    const html = await page.text()
    const hasCloseCta = html.includes('href="/promotor/cerrar"')
    const closeIs404 = close.status() === 404

    // Safety property (promoter-funnel-fixes S1.2), still holds: whenever the close-workspace
    // CTA IS shown, its target must be reachable — never a dead link. The converse no longer
    // holds since promoter-funnel-v2 US-1.3: the CTA is now bound-promoter-only, so an anonymous
    // visitor never sees it even when the route itself is perfectly reachable (it 30x-redirects
    // them to sign-in). That third state (hidden in favor of the apply teaser, route otherwise
    // reachable) is covered directly against buildPromoterPageConfig in
    // e2e/seller-acquisition-copy.spec.ts ("promoter landing · CTA + wording sweep"); this `api`
    // spec has no way to simulate a bound Clerk session, so it only asserts the anonymous side.
    if (hasCloseCta) {
      expect(closeIs404).toBe(false)
    }

    // This request carries no Clerk session, so the visitor is never a bound promoter — they
    // should always land on the apply-teaser anchor instead of the direct workspace link,
    // regardless of the live promoter.enabled value.
    expect(hasCloseCta).toBe(false)
    expect(html).toContain('href="#promotor-aplica"')
  })
})
