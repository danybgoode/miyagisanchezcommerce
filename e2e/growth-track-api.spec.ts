import { test, expect } from '@playwright/test'

/**
 * `/api/growth/track` · auth gate (golden-beans Roadmap/01-growth-engine/
 * growth-engine-v1, Sprint 1 · Story 1.3). Clerk-only (`currentUser()`); the `api`
 * project runs ANONYMOUS, so every arm must 401 — including a well-formed body,
 * because auth is checked before the event/flag logic (that logic is proven
 * unauthenticated-free in the pure `growth-track.spec.ts`). The authed
 * 200-skipped / 202-forwarded paths are owed to Daniel (Sprint 1 smoke —
 * flag-flip + live-event).
 */

test.describe('growth track API · anonymous is rejected', () => {
  test('POST /api/growth/track with a well-formed body → 401 (no Clerk session)', async ({ request }) => {
    const res = await request.post('/api/growth/track', {
      data: { event: 'setup_guide_viewed', featureId: 'setup_guide' },
    })
    expect(res.status()).toBe(401)
  })

  test('POST /api/growth/track with an empty body → still 401 (auth precedes validation)', async ({
    request,
  }) => {
    const res = await request.post('/api/growth/track', { data: {} })
    expect(res.status()).toBe(401)
  })
})
