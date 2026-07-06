import { test, expect } from '@playwright/test'

/**
 * Buyer artwork upload · POST /api/artwork/upload (custom-print-products
 * Sprint 3, Story 3.2). The route is genuinely PUBLIC (no Clerk, no
 * `withSupplyAdmin`) — a guest must be able to upload before signing in — so
 * there's no auth arm to test here; instead this asserts the validation
 * gates that make an unauthenticated upload surface safe: missing input,
 * size cap, and real magic-byte format sniffing (not just a trusted
 * Content-Type/extension).
 *
 * Deliberately does NOT assert a successful upload here — that would write a
 * real object to the shared Supabase/R2 storage on every CI run (the
 * existing `/api/supply/upload` auth-gate spec follows the same restraint:
 * it only proves the 401 arms, never a real accepted upload). The
 * success path — a real file landing in R2 and echoing through cart →
 * checkout → order → emails — is exercised via the manual preview
 * walkthrough and the money-path smoke owed to Daniel (see sprint-3.md).
 */

// A syntactically valid multipart part whose CONTENT is plain text, not a
// real image — proves the route sniffs actual bytes rather than trusting
// whatever filename/Content-Type the client declares.
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

  test('a file whose bytes do not match its claimed format is rejected (real sniffing, not trust)', async ({ request }) => {
    const res = await request.post('/api/artwork/upload', {
      multipart: { file: FAKE_PNG, listingId: 'prod_fake', fieldId: 'cf_1' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  test('an oversize file is rejected before any format check', async ({ request }) => {
    // Global hard cap is MAX_ARTWORK_SIZE_MB (4MB — kept well under Vercel's
    // 4.5MB Node.js Serverless Function request-body limit, verified live: a
    // body approaching that platform ceiling fails to even parse as
    // formData(), so the cap must leave real headroom, not just look
    // reasonable). A nonexistent listingId falls back to the global cap, so
    // this needs no seeded data. 5MB clears our cap while staying safely
    // under whatever raw body-parse ceiling the runtime itself imposes, so
    // this exercises OUR size check, not the platform's parse failure.
    const oversize = Buffer.alloc(5 * 1024 * 1024, 0)
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
