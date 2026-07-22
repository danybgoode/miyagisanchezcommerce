import { test, expect } from '@playwright/test'
import {
  PREVIEW_TOKEN_PREFIX,
  generatePreviewToken,
  hashPreviewToken,
  isWellFormedPreviewToken,
} from '../lib/preview-token'
import { isPromoterShopOwner, canAnchorPreview } from '../lib/promoter-close'
import { decidePreviewPrivacy, isMirrorShopId } from '../lib/preview-privacy-decision'

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

  test('REGRESSION: a re-run of shop setup on a SINCE-CLAIMED shop cannot anchor', () => {
    // `/internal/sellers` is idempotent on source_url and
    // `ensureUnclaimedShopMirror` resolves an existing mirror row WITHOUT
    // filtering clerk_user_id — so re-running setup with the same business name
    // after the merchant claimed the shop hands back a live, claimed shop. The
    // setup route must therefore run the same gate as every other call site;
    // "unclaimed by construction" is false on that path.
    expect(canAnchorPreview(shop('promoter://PRM-ABC/lupita', 'user_claimed'), 'PRM-ABC')).toBe(false)
  })
})

test.describe('the happy path must not brick a merchant’s storefront', () => {
  // These assert the SHAPE of the claimed-escape rule, which lives in
  // lib/preview-access.ts (server-only, so not importable here). The rule:
  // a non-activated anchor hides a shop ONLY while it is still unclaimed.
  //
  // Why this exists: canAnchorPreview checks clerk_user_id at ANCHOR time only,
  // and /api/claim/complete flips it without touching merchant_previews. Without
  // the claimed-escape, the epic's own happy path — promoter anchors an unclaimed
  // shop, merchant claims it via the WhatsApp link — leaves the merchant's
  // storefront 404'd permanently (there is no UPDATE/DELETE of that table
  // anywhere, and the promoter loses canAnchorPreview the moment it is claimed).
  // Exercises the REAL production decision (lib/preview-privacy-decision.ts), which
  // `isShopPreviewPrivate` feeds its DB-read facts into — not a re-declared shim.

  test('unclaimed + a held (non-activated) anchor => hidden', () => {
    expect(decidePreviewPrivacy({ claim: 'unclaimed', anchor: 'held' })).toBe(true)
  })

  test('CLAIMED => visible for ANY anchor (the storefront-brick this prevents)', () => {
    for (const anchor of ['none', 'held', 'activated', 'error'] as const) {
      expect(decidePreviewPrivacy({ claim: 'claimed', anchor })).toBe(false)
    }
  })

  test('activated anchor => visible regardless of claim', () => {
    expect(decidePreviewPrivacy({ claim: 'unclaimed', anchor: 'activated' })).toBe(false)
  })

  test('no anchor => visible', () => {
    expect(decidePreviewPrivacy({ claim: 'unclaimed', anchor: 'none' })).toBe(false)
  })

  test('FAIL-CLOSED: an anchor READ ERROR is treated as private', () => {
    expect(decidePreviewPrivacy({ claim: 'unclaimed', anchor: 'error' })).toBe(true)
    // ...even before the claim is known — an unresolved read never leaks.
    expect(decidePreviewPrivacy({ claim: 'unknown', anchor: 'error' })).toBe(true)
  })

  test('FAIL-CLOSED: an unclaimed shop whose CLAIM read failed, with a held anchor, is hidden', () => {
    expect(decidePreviewPrivacy({ claim: 'unknown', anchor: 'held' })).toBe(true)
  })

  test('FAIL-CLOSED never fires for a claimed shop (marketplace stays up on a blip)', () => {
    // 'claimed' is decided from data in hand before any read, so a Supabase blip
    // (anchor: 'error') can never hide a live shop.
    expect(decidePreviewPrivacy({ claim: 'claimed', anchor: 'error' })).toBe(false)
  })
})

test.describe('mirror-id gate — a Medusa seller id must never reach the UUID anchor query', () => {
  // REGRESSION (found live 2026-07-22, flag ON): every public read surface passes a
  // `getShop` object whose `.id` is the Medusa SELLER id (`sel_…`), not the mirror
  // UUID. `merchant_previews.shop_id` is a UUID column, so a `sel_…` id threw 22P02,
  // the anchor read failed closed, and EVERY unclaimed shop's embed + sub-pages
  // 404'd. `isMirrorShopId` is the gate that stops a non-UUID id from being trusted
  // as a mirror id (it resolves from the slug instead).

  test('a canonical mirror UUID is accepted', () => {
    expect(isMirrorShopId('a1b2c3d4-0000-4000-8000-000000000000')).toBe(true)
    expect(isMirrorShopId('A1B2C3D4-0000-4000-8000-000000000000')).toBe(true) // case-insensitive
  })

  test('a Medusa seller id is REJECTED (the exact id that caused the 404)', () => {
    expect(isMirrorShopId('sel_01KTRSSE1T6M9MNDBS430FPH5E')).toBe(false)
  })

  test('other non-UUID shapes are rejected', () => {
    for (const bad of [null, undefined, '', 'not-a-uuid', 'prod_01ABC', '12345',
      'a1b2c3d4-0000-4000-8000-00000000000',   // too short
      'a1b2c3d4-0000-4000-8000-0000000000000', // too long
      'g1b2c3d4-0000-4000-8000-000000000000',  // non-hex
    ]) {
      expect(isMirrorShopId(bad as unknown as string), String(bad)).toBe(false)
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
    // Well-formed-but-unknown (passes format validation, must still 404) and
    // outright malformed both return the ordinary not-found experience.
    for (const token of [`${PREVIEW_TOKEN_PREFIX}${'0'.repeat(64)}`, `${PREVIEW_TOKEN_PREFIX}deadbeef`]) {
      const res = await request.get(`/preview/${token}`)
      expect(res.status()).toBe(404)
    }
  })
})

test.describe('S2 decision route — a garbage/absent token never records consent', () => {
  test('decision on an unknown token returns not-found, never 200', async ({ request }) => {
    // Flag OFF ⇒ 404 (dark). Flag ON ⇒ the token resolves to nothing ⇒ 404. Either
    // way, an anonymous caller with a made-up token can never record a decision.
    for (const token of [`${PREVIEW_TOKEN_PREFIX}${'0'.repeat(64)}`, `${PREVIEW_TOKEN_PREFIX}deadbeef`]) {
      const res = await request.post(`/api/preview/${token}/decision`, {
        data: { decision: 'approved', expectedHash: '0'.repeat(64) },
      })
      // Never 200 (no consent recorded), never 500 (no unhandled throw).
      expect([400, 404, 429]).toContain(res.status())
      expect(res.status()).not.toBe(200)
    }
  })
})

test.describe('MCP listing writes must never reach a preview-private shop', () => {
  /**
   * REGRESSION (post-merge review, 2026-07-22). `autoGrantPartnerOnClose` mints the
   * promoter a `manager` partner grant on the very shop `shop/setup` anchors
   * private, and `resolveToolShop`'s partner branch resolves shops straight from
   * `partner_grants` with no anchor check. Only `create_listing` was guarded — so
   * `set_listing_status` could publish a merchant's products with no approval, no
   * checklist and no consent record, while the anchor still 404'd the storefront.
   *
   * The real assertion is structural and lives in the source: EVERY listing-write
   * tool must consult the anchor. A live end-to-end test would need a partner
   * credential plus `partners.mcp_enabled` ON, which the anonymous api project
   * cannot arrange — so this guards the property that actually regressed (a new
   * write tool added without the guard), which is the failure mode that produced
   * the gap in the first place.
   */
  test('every MCP handler with a listing-write primitive consults the preview anchor', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync(new URL('../app/api/ucp/mcp/route.ts', import.meta.url), 'utf8')

    const WRITE_PRIMITIVES = [
      'createSellerProductViaInternal',
      'patchSellerProductViaInternal',
      'deleteSellerProductViaInternal',
      'applySellerPriceViaInternal',
    ]
    // Every handler body, sliced at `async function handleX`.
    const handlers = [...src.matchAll(/async function (handle[A-Za-z]+)\s*\(/g)]
    const offenders: string[] = []

    for (let i = 0; i < handlers.length; i++) {
      const name = handlers[i][1]
      const start = handlers[i].index ?? 0
      const end = i + 1 < handlers.length ? (handlers[i + 1].index ?? src.length) : src.length
      const body = src.slice(start, end)

      const writes = WRITE_PRIMITIVES.some((p) => body.includes(p))
      if (!writes) continue
      // `cancelCampaign` only un-publishes — the safe direction.
      if (name === 'handleCancelCampaign') continue

      const guarded =
        body.includes('refusePreviewPrivateWrite') ||
        body.includes('invalidatePreviewApprovalAfterEdit') ||
        body.includes('shopMustStayPrivate')
      if (!guarded) offenders.push(name)
    }

    expect(
      offenders,
      `These MCP handlers write listings without consulting the consent anchor: ${offenders.join(', ')}. ` +
        'Add refusePreviewPrivateWrite (publication/destruction) or ' +
        'invalidatePreviewApprovalAfterEdit (content edits).',
    ).toEqual([])
  })

  test('the publication and destruction tools REFUSE rather than degrade', async () => {
    const fs = await import('fs')
    const src = fs.readFileSync(new URL('../app/api/ucp/mcp/route.ts', import.meta.url), 'utf8')
    // Publishing and deleting are activation's exclusive territory — these two
    // must hard-refuse, not merely invalidate an approval after the fact.
    for (const handler of ['handleSetListingStatus', 'handleDeleteListing', 'handleActivateCampaign']) {
      const start = src.indexOf(`async function ${handler}`)
      expect(start, `${handler} not found`).toBeGreaterThan(-1)
      const body = src.slice(start, start + 3000)
      expect(body, `${handler} must call refusePreviewPrivateWrite`).toContain('refusePreviewPrivateWrite')
    }
  })
})

test.describe('S2 activation route — anonymous callers are refused', () => {
  test('activate never serves an anonymous caller', async ({ request }) => {
    const res = await request.post('/api/promoter/preview/activate', { data: { slug: 'nonexistent-disposable-shop' } })
    // Flag OFF ⇒ 404 (dark); flag ON ⇒ 401 (anonymous). Never 200.
    expect([401, 404]).toContain(res.status())
  })

  test('preview state (GET) never serves an anonymous caller', async ({ request }) => {
    const res = await request.get('/api/promoter/preview?slug=nonexistent-disposable-shop')
    expect([401, 404]).toContain(res.status())
  })
})
