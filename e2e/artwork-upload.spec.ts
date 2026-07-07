import { test, expect } from '@playwright/test'

/**
 * Buyer artwork upload · POST /api/artwork/upload (custom-print-products
 * Sprint 3, Story 3.2). The route is genuinely PUBLIC (no Clerk, no
 * `withSupplyAdmin`) — a guest must be able to upload before signing in — so
 * there's no auth arm to test here; instead this asserts the validation
 * gates that make an unauthenticated upload surface safe: missing input,
 * the global size ceiling, and rejecting a listing/field that doesn't
 * resolve to a real `file` custom field (cross-agent review catch,
 * 2026-07-06 — without this, ANY caller could pass a fake listingId/fieldId
 * and use the route as an unrestricted anonymous file host).
 *
 * Request order in the route (see app/api/artwork/upload/route.ts): rate
 * limit → missing input → global size ceiling (cheap, no Medusa round-trip)
 * → real-field lookup → per-field size/format. Only the first four are
 * testable without seeded data (a real listing with a real `file` field) —
 * the format-sniff-mismatch path needs one, so it's exercised via the manual
 * preview walkthrough / Daniel's smoke (see sprint-3.md), not here.
 *
 * Deliberately does NOT assert a successful upload here — that would write a
 * real object to the shared Supabase/R2 storage on every CI run (the
 * existing `/api/supply/upload` auth-gate spec follows the same restraint:
 * it only proves the 401 arms, never a real accepted upload).
 */

const FAKE_PNG = {
  name: 'not-really-a-png.png',
  mimeType: 'image/png',
  buffer: Buffer.from('this is definitely not PNG bytes'),
}

test.describe('artwork upload · input validation', () => {
  test('missing file → 400', async ({ request }) => {
    const res = await request.post('/api/artwork/upload', {
      multipart: { listingId: 'prod_fake', fieldId: 'cf_1' },
    })
    expect(res.status()).toBe(400)
  })

  test('missing listingId → 400', async ({ request }) => {
    const res = await request.post('/api/artwork/upload', {
      multipart: { file: FAKE_PNG, fieldId: 'cf_1' },
    })
    expect(res.status()).toBe(400)
  })

  test('a listing/field that does not resolve to a real file field is rejected outright — never falls back to an open upload', async ({ request }) => {
    const res = await request.post('/api/artwork/upload', {
      multipart: { file: FAKE_PNG, listingId: 'prod_fake', fieldId: 'cf_1' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  test('an oversize file is rejected against the global cap before any Medusa lookup', async ({ request }) => {
    // Global hard cap is MAX_ARTWORK_SIZE_MB (4MB — kept well under Vercel's
    // 4.5MB Node.js Serverless Function request-body limit, verified live: a
    // body approaching that platform ceiling fails to even parse as
    // formData(), so the cap must leave real headroom, not just look
    // reasonable). This fast-fail runs BEFORE the listing/field lookup, so a
    // nonexistent listingId still exercises it — no seeded data needed.
    // 4.2MB clears our 4MB cap while staying under the ~4.5MB platform
    // ceiling — a PREVIOUS 5MB payload here was actually ABOVE that
    // ceiling, so against the real deployed Vercel preview it hit the
    // platform's own 413 before ever reaching our app-level 400 (only ever
    // passed locally, where the dev server enforces no such limit) — caught
    // live on custom-print-products S4's CI run, 2026-07-07.
    const oversize = Buffer.alloc(Math.floor(4.2 * 1024 * 1024), 0)
    const res = await request.post('/api/artwork/upload', {
      multipart: {
        file: { name: 'big.png', mimeType: 'image/png', buffer: oversize },
        listingId: 'prod_fake',
        fieldId: 'cf_1',
      },
      timeout: 30000,
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('MB')
  })
})
