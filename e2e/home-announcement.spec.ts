import { test, expect } from '@playwright/test'

/**
 * Buyer homepage announcement card · structural check (epic 08 ·
 * admin-content-and-announcements, Sprint 3, Story 3.3). No live campaign exists in
 * this environment by default, so `data-testid="home-announcement-card"` must be
 * ABSENT and the rest of the homepage renders unaffected — the deterministic half of
 * the acceptance. The live "seed a buyer campaign → the card renders, dismiss
 * persists, no layout shift" round-trip is owed to Daniel (sprint smoke walkthrough),
 * since seeding real admin-created content against a live preview isn't something
 * this anonymous `api` project can set up for itself.
 */

test.describe('home announcement card · structural default (no active campaign)', () => {
  test('the homepage renders with no announcement card and its usual chrome intact', async ({ request }) => {
    const res = await request.get('/', { headers: { Accept: 'text/html' } })
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    expect(html).not.toContain('data-testid="home-announcement-card"')
    expect(html).toContain('data-testid="home-ribbon"')
  })
})
