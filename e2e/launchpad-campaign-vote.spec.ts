import { test, expect } from '@playwright/test'
import {
  campaignAcceptsVotes,
  voteKey,
  isDuplicateVote,
} from '../lib/launchpad-campaign-types'

/**
 * Bookshop launchpad · Sprint 3.2 — the public voting surface.
 *
 * Pure arm: the vote-open predicate + the "one vote per email per work" dedup
 * deriver (mirrors the DB UNIQUE) — deterministic, no network.
 *
 * HTTP arm: the dark-launch fail-safe. While `launchpad.enabled` is OFF (default /
 * seed), the public verification + vote routes reject with 423 before any real
 * work — a flag outage can never open the voting surface. The IP rate-limiter runs
 * one step earlier, so a flooded caller can see 429 first; either rejection proves
 * the request never reached the DB. Runs green against the PR preview in CI (where
 * the routes exist with the flag off), same shape as launchpad-submission.spec.ts.
 */

// ── Pure: vote-open predicate ────────────────────────────────────────────────
const FUTURE = '2999-01-01T00:00:00.000Z'
const PAST = '2000-01-01T00:00:00.000Z'

test.describe('campaignAcceptsVotes (pure)', () => {
  test('active + future end date → open', () => {
    expect(campaignAcceptsVotes({ status: 'active', ends_at: FUTURE })).toBe(true)
  })
  test('active but past end date → closed (automation will close it)', () => {
    expect(campaignAcceptsVotes({ status: 'active', ends_at: PAST })).toBe(false)
  })
  test('a draft / closed campaign never accepts votes', () => {
    expect(campaignAcceptsVotes({ status: 'draft', ends_at: FUTURE })).toBe(false)
    expect(campaignAcceptsVotes({ status: 'closed_met', ends_at: FUTURE })).toBe(false)
    expect(campaignAcceptsVotes({ status: 'closed_unmet', ends_at: FUTURE })).toBe(false)
    expect(campaignAcceptsVotes({ status: 'cancelled', ends_at: FUTURE })).toBe(false)
  })
  test('active with no end date → open (the cron enforces closing)', () => {
    expect(campaignAcceptsVotes({ status: 'active', ends_at: null })).toBe(true)
  })
})

// ── Pure: one-vote-per-email-per-work dedup ──────────────────────────────────
test.describe('vote dedup (pure)', () => {
  test('the key is (work, email) — a voter may vote for several works', () => {
    const existing = [voteKey('prod_A', 'hashX')]
    // Same email, DIFFERENT work → not a duplicate.
    expect(isDuplicateVote(existing, 'prod_B', 'hashX')).toBe(false)
    // Same email, SAME work → duplicate.
    expect(isDuplicateVote(existing, 'prod_A', 'hashX')).toBe(true)
    // Different email, same work → not a duplicate.
    expect(isDuplicateVote(existing, 'prod_A', 'hashY')).toBe(false)
  })
  test('empty history → never a duplicate', () => {
    expect(isDuplicateVote([], 'prod_A', 'hashX')).toBe(false)
  })
  test('works over a Set as well as an array', () => {
    const set = new Set([voteKey('prod_A', 'hashX')])
    expect(isDuplicateVote(set, 'prod_A', 'hashX')).toBe(true)
  })
})

// ── HTTP: dark-launch fail-safe (flag OFF by default) ────────────────────────
const SLUG = 'launchpad-campaign-e2e-nonexistent'

test.describe('launchpad campaigns · public routes are dark while the flag is OFF', () => {
  test('verification → 423 (not 500), never sends a code', async ({ request }) => {
    const res = await request.post(`/api/launchpad/campaigns/${SLUG}/verification`, {
      data: { email: 'voter@example.com' },
    })
    expect([423, 429]).toContain(res.status())
  })

  test('vote → 423 (not 500) with the feature dark', async ({ request }) => {
    const res = await request.post(`/api/launchpad/campaigns/${SLUG}/vote`, {
      data: { work_product_id: 'prod_x', email: 'v@example.com', code: 'ABC123' },
    })
    expect([423, 429]).toContain(res.status())
  })
})
