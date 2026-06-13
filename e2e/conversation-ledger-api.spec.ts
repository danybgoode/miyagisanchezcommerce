import { test, expect } from '@playwright/test'

/**
 * Trust & Messaging Polish · Sprint 1 (C.1) — conversation-read API guard.
 *
 * `GET /api/conversations/[id]` now attaches a read-only `transaction.ledger`
 * projection. The route is per-conversation Clerk-gated and the `api` project runs
 * unauthenticated, so this asserts the auth gate (401) — and that attaching the
 * ledger never turns a clean 401 into a 500. The projection itself (state, timeline,
 * graceful-degrade to offer-only / no-refund / missing-order) is covered offline by
 * `transaction-ledger.spec.ts`; the authed chat-card render is the C.2 browser smoke
 * (owed to Daniel) — stated in the PR.
 */

test.describe('conversation read · ledger auth gate', () => {
  test('GET rejects anonymous with 401 (no 500 from ledger resolution)', async ({ request }) => {
    const res = await request.get('/api/conversations/00000000-0000-0000-0000-000000000000')
    expect(res.status()).toBe(401)
    const body = await res.json()
    expect(body).toHaveProperty('error')
  })
})
