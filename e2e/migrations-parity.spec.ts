import { test, expect } from '@playwright/test'
import { buildParityReport, PARITY_SECTIONS, VERY_CUSTOM_LISTING_THRESHOLD } from '../lib/migration-parity'

/**
 * Shopify parity report · Sprint 1 (epic 03 · platform-migrations, US-1.2).
 *
 * The scorer is pure — fixture section sets → deterministic score/verdict.
 * The real batch/ownership read lives in lib/shopify-import-bridge.ts
 * (Supabase, unreachable from the `api` runner) — the live real-Shopify-domain
 * pull + parity-report eyeball is owed to Daniel. See sprint-1.md.
 */

test.describe('migration-parity · PARITY_SECTIONS', () => {
  test('every fixed Miyagi primitive is covered, honestly rated', () => {
    const keys = PARITY_SECTIONS.map((s) => s.key)
    expect(keys).toEqual(['announcement', 'hero', 'theme', 'collections', 'content_pages'])
    for (const section of PARITY_SECTIONS) {
      expect(['mapped', 'partial', 'none']).toContain(section.verdict)
      expect(section.note.length).toBeGreaterThan(0)
    }
    // The confirmed finding (sprint-1.md → Findings): content pages are closed
    // to 3 fixed routes — never claim full parity here.
    const contentPages = PARITY_SECTIONS.find((s) => s.key === 'content_pages')
    expect(contentPages?.verdict).toBe('partial')
  })
})

test.describe('migration-parity · buildParityReport', () => {
  test('a small, ordinary shop is never flagged very-custom', () => {
    const report = buildParityReport({ listingCount: 40, imageCount: 120, hasPolicies: true, truncated: false })
    expect(report.veryCustom).toBe(false)
    expect(report.veryCustomReason).toBeNull()
    expect(report.listingCount).toBe(40)
    expect(report.imageCount).toBe(120)
    expect(report.hasPolicies).toBe(true)
    expect(report.sections).toBe(PARITY_SECTIONS) // same static reference, no per-call rebuild
  })

  test('over the flat-fee SKU threshold → very custom, with a reason', () => {
    const report = buildParityReport({
      listingCount: VERY_CUSTOM_LISTING_THRESHOLD + 1,
      imageCount: 900,
      hasPolicies: false,
      truncated: false,
    })
    expect(report.veryCustom).toBe(true)
    expect(report.veryCustomReason).toMatch(/150/)
  })

  test('exactly at the threshold is NOT over it (boundary)', () => {
    const report = buildParityReport({
      listingCount: VERY_CUSTOM_LISTING_THRESHOLD,
      imageCount: 10,
      hasPolicies: false,
      truncated: false,
    })
    expect(report.veryCustom).toBe(false)
  })

  test('a truncated pull is very-custom regardless of listing count', () => {
    const report = buildParityReport({ listingCount: 5, imageCount: 5, hasPolicies: true, truncated: true })
    expect(report.veryCustom).toBe(true)
    expect(report.veryCustomReason).toMatch(/catálogo/i)
  })

  test('no policies text degrades gracefully (false, not thrown)', () => {
    const report = buildParityReport({ listingCount: 3, imageCount: 0, hasPolicies: false, truncated: false })
    expect(report.hasPolicies).toBe(false)
    expect(report.imageCount).toBe(0)
  })
})

// ── Connector route is flag/auth-gated ──────────────────────────────────────
test.describe('shopify parity route · gating', () => {
  test('GET /api/sell/shopify/import/parity → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.get('/api/sell/shopify/import/parity?batchId=x')
    expect(res.status()).toBe(401)
  })
})
