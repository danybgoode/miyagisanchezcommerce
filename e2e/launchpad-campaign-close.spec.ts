import { test, expect } from '@playwright/test'
import { decideCampaignClose } from '../lib/launchpad-campaign-types'

/**
 * Bookshop launchpad · Sprint 3.3 — the close/mint automation decision.
 *
 * Pure arm: `decideCampaignClose` is the single decision both the vote-route hook
 * and the daily cron run per campaign (mint / close_unmet / skip / noop). Testing
 * it here pins the money-path trigger deterministically — the product-scoped
 * coupon logic itself is unit-tested on the backend (coupon-product-scope.unit.spec).
 *
 * HTTP arm: the cron endpoint rejects an unauthenticated caller (401) — it must
 * never mint on an unauthorized hit. Runs against the PR preview in CI.
 */

const FUTURE = '2999-01-01T00:00:00.000Z'
const PAST = '2000-01-01T00:00:00.000Z'

test.describe('decideCampaignClose (pure)', () => {
  test('threshold reached → mint, regardless of end date', () => {
    expect(decideCampaignClose({ status: 'active', voteCount: 3, threshold: 3, endsAt: FUTURE })).toBe('mint')
    expect(decideCampaignClose({ status: 'active', voteCount: 5, threshold: 3, endsAt: PAST })).toBe('mint')
  })

  test('ended below threshold → honest close_unmet', () => {
    expect(decideCampaignClose({ status: 'active', voteCount: 2, threshold: 3, endsAt: PAST })).toBe('close_unmet')
  })

  test('live and below threshold → skip (leave running)', () => {
    expect(decideCampaignClose({ status: 'active', voteCount: 2, threshold: 3, endsAt: FUTURE })).toBe('skip')
    expect(decideCampaignClose({ status: 'active', voteCount: 0, threshold: 3, endsAt: null })).toBe('skip')
  })

  test('a non-active campaign is always a noop (idempotent replay-safety)', () => {
    for (const status of ['draft', 'closed_met', 'closed_unmet', 'cancelled'] as const) {
      expect(decideCampaignClose({ status, voteCount: 99, threshold: 3, endsAt: PAST })).toBe('noop')
    }
  })

  test('a zero threshold never mints (guards a misconfigured campaign)', () => {
    expect(decideCampaignClose({ status: 'active', voteCount: 5, threshold: 0, endsAt: FUTURE })).toBe('skip')
    expect(decideCampaignClose({ status: 'active', voteCount: 5, threshold: 0, endsAt: PAST })).toBe('close_unmet')
  })
})

test.describe('launchpad campaigns · close cron is auth-gated', () => {
  test('GET without a secret → 401 (never mints on an unauthorized hit)', async ({ request }) => {
    const res = await request.get('/api/cron/launchpad-campaigns')
    expect(res.status()).toBe(401)
  })
})
