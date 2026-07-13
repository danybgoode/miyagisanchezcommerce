import { test, expect } from '@playwright/test'

/**
 * `POST /api/checkout/start` (fix/checkout-cloudrun-localhost-fallback).
 *
 * This route is the fix for a live prod outage: `lib/cart.ts`'s `startCheckout`
 * read `NEXT_PUBLIC_MEDUSA_STORE_URL` at module scope, which Next.js only
 * inlines at `next build` time — since the Cloud Run frontend Docker build
 * never received it as a build-arg, every client bundle baked in `undefined`
 * and fell back to `http://localhost:9000`, breaking every "Comprar"/pay click
 * since the Vercel→Cloud Run cutover. The fix moves `startCheckout`'s
 * execution server-side (this route), where `process.env` reads are live and
 * correct; the client now calls this same-origin route via `lib/cart-client.ts`
 * instead of importing the Medusa-calling logic directly.
 *
 * These specs assert the route's contract with ZERO side effects — no real
 * cart/order is ever created. A happy-path spec would need a real productId +
 * Clerk JWT and would mutate live commerce data, so it's deliberately excluded
 * from this deterministic gate; the money-path confirmation is Daniel's live
 * prod checkout smoke (see the PR).
 */
test.describe('POST /api/checkout/start', () => {
  test('malformed JSON body → 400 with an error field', async ({ request }) => {
    const res = await request.post('/api/checkout/start', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not-json{{{',
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  test('no items to checkout → 400, message names the problem', async ({ request }) => {
    // startCheckout throws 'No items to checkout' before any network call
    // (lib/cart.ts destructures params + builds the line-items array first) —
    // this exercises the route end-to-end (proves it invokes startCheckout
    // server-side and surfaces its message verbatim) while creating nothing.
    const res = await request.post('/api/checkout/start', {
      data: { provider: 'stripe' },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/No items to checkout/)
  })

  test('GET is not supported — 405', async ({ request }) => {
    const res = await request.get('/api/checkout/start')
    expect(res.status()).toBe(405)
  })
})
