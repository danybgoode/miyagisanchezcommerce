import { test, expect } from '@playwright/test'

/**
 * Living Shop · Sprint 1 — the Wall API's auth boundary (Story 1.2).
 *
 * The `api` project runs ANONYMOUS, so every seller Wall route must 401. That is
 * the half a deterministic gate can prove without a session.
 *
 * The half it cannot prove — that an AUTHENTICATED seller is refused ANOTHER
 * shop's reference — is covered structurally instead of by a live authed run:
 * `resolveOwnShop` takes a Clerk user id and there is no function in
 * `lib/wall/store.ts` that accepts a caller-supplied shop id, so a foreign write
 * has no code path to travel. The foreign-reference refusal itself is asserted
 * against the running route in the sprint's smoke walkthrough, and named there as
 * owed to Daniel — an automated authed seller session is the known gap
 * (`MS_TEST_*` secrets are unset; see the browser-smoke CI note in memory).
 *
 * ORDER, not just the code: the routes resolve auth BEFORE parsing the body, so a
 * malformed body from an anonymous caller must still answer 401 and never 400.
 * A 400 there would prove the route had started doing work for a stranger.
 */

test.describe('wall API · anonymous is rejected', () => {
  test('GET /api/sell/wall → 401', async ({ request }) => {
    expect((await request.get('/api/sell/wall')).status()).toBe(401)
  })

  test('POST /api/sell/wall → 401', async ({ request }) => {
    const res = await request.post('/api/sell/wall', { data: { kind: 'post', body: 'hola' } })
    expect(res.status()).toBe(401)
  })

  test('POST with a malformed body → 401, not 400 (auth is resolved first)', async ({ request }) => {
    const res = await request.post('/api/sell/wall', {
      headers: { 'Content-Type': 'application/json' },
      data: 'this is not json',
    })
    expect(res.status()).toBe(401)
  })

  test('POST naming another shop → 401 (and the field is not read at all)', async ({ request }) => {
    // `shop_id` is not part of the payload the route reads; sending one proves
    // the route does not grow a body-supplied shop by accident.
    const res = await request.post('/api/sell/wall', {
      data: { kind: 'post', body: 'x', shop_id: '00000000-0000-0000-0000-000000000000' },
    })
    expect(res.status()).toBe(401)
  })

  test('PATCH /api/sell/wall/:id → 401', async ({ request }) => {
    const res = await request.patch('/api/sell/wall/00000000-0000-0000-0000-000000000000', {
      data: { status: 'published' },
    })
    expect(res.status()).toBe(401)
  })

  test('DELETE /api/sell/wall/:id → 401', async ({ request }) => {
    const res = await request.delete('/api/sell/wall/00000000-0000-0000-0000-000000000000')
    expect(res.status()).toBe(401)
  })
})
