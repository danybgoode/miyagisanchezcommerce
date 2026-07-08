import { test, expect } from '@playwright/test'
import {
  canTransitionCampaign,
  isConfigurablePriceGrid,
  validateCampaignActivation,
  thresholdReached,
  campaignProgress,
  CAMPAIGN_STATUSES,
  TERMINAL_CAMPAIGN_STATUSES,
  DEFAULT_REWARD_PERCENT,
  type CampaignStatus,
} from '../lib/launchpad-campaign-types'
import type { PriceGrid } from '../lib/price-grid'

/**
 * Bookshop launchpad · Sprint 3.1 — the pure campaign logic.
 *
 * The campaign state machine, the activation gate, the CPP-config check, and the
 * threshold/progress derivers are all pure (next-free, no DB) so the `api` runner
 * can exhaust them deterministically with no seeded data or network. The DB/mint
 * plumbing (server-only) is exercised by Daniel's owed money smoke.
 */

// ── State machine ────────────────────────────────────────────────────────────
test.describe('campaign state machine (pure)', () => {
  test('draft can activate or cancel, nothing else', () => {
    expect(canTransitionCampaign('draft', 'active')).toBe(true)
    expect(canTransitionCampaign('draft', 'cancelled')).toBe(true)
    expect(canTransitionCampaign('draft', 'closed_met')).toBe(false)
    expect(canTransitionCampaign('draft', 'closed_unmet')).toBe(false)
  })

  test('active can close (met/unmet) or be cancelled', () => {
    expect(canTransitionCampaign('active', 'closed_met')).toBe(true)
    expect(canTransitionCampaign('active', 'closed_unmet')).toBe(true)
    expect(canTransitionCampaign('active', 'cancelled')).toBe(true)
    expect(canTransitionCampaign('active', 'draft')).toBe(false)
  })

  test('terminal states allow no transitions (incl. self)', () => {
    for (const s of TERMINAL_CAMPAIGN_STATUSES) {
      for (const to of CAMPAIGN_STATUSES) {
        expect(canTransitionCampaign(s, to)).toBe(false)
      }
    }
  })

  test('a state never transitions to itself', () => {
    for (const s of CAMPAIGN_STATUSES) {
      expect(canTransitionCampaign(s, s as CampaignStatus)).toBe(false)
    }
  })
})

// ── CPP-configured reward check ──────────────────────────────────────────────
const grid = (variants: Array<{ tiers: number }>): PriceGrid => ({
  product_id: 'prod_1',
  variants: variants.map((v, i) => ({
    id: `var_${i}`,
    options: {},
    manage_inventory: false,
    tiers: Array.from({ length: v.tiers }, (_, t) => ({ min_quantity: t + 1, max_quantity: null, amount: 1000 })),
  })),
})

test.describe('isConfigurablePriceGrid (pure)', () => {
  test('null grid → not configurable', () => {
    expect(isConfigurablePriceGrid(null)).toBe(false)
  })
  test('single variant with one tier → not configurable', () => {
    expect(isConfigurablePriceGrid(grid([{ tiers: 1 }]))).toBe(false)
  })
  test('multiple variants → configurable', () => {
    expect(isConfigurablePriceGrid(grid([{ tiers: 1 }, { tiers: 1 }]))).toBe(true)
  })
  test('single variant with quantity tiers → configurable', () => {
    expect(isConfigurablePriceGrid(grid([{ tiers: 3 }]))).toBe(true)
  })
})

// ── Activation gate ──────────────────────────────────────────────────────────
const FUTURE = '2999-01-01T00:00:00.000Z'
const PAST = '2000-01-01T00:00:00.000Z'

const validInput = {
  title: 'Vota por el libro',
  description: 'Elige la próxima publicación.',
  vote_threshold: 3,
  ends_at: FUTURE,
  reward_percent: DEFAULT_REWARD_PERCENT,
  reward_product_id: 'prod_cpp',
  work_count: 2,
  reward_is_configurable: true,
}

test.describe('validateCampaignActivation (pure)', () => {
  test('a complete campaign passes', () => {
    expect(validateCampaignActivation(validInput)).toEqual([])
  })

  test('missing title / description are reported', () => {
    expect(validateCampaignActivation({ ...validInput, title: '' })).toContain('title')
    expect(validateCampaignActivation({ ...validInput, description: '  ' })).toContain('description')
  })

  test('zero / negative threshold is rejected', () => {
    expect(validateCampaignActivation({ ...validInput, vote_threshold: 0 })).toContain('vote_threshold')
    expect(validateCampaignActivation({ ...validInput, vote_threshold: -1 })).toContain('vote_threshold')
  })

  test('a past end date is rejected (future_end_date)', () => {
    expect(validateCampaignActivation({ ...validInput, ends_at: PAST })).toContain('future_end_date')
  })

  test('missing reward product is rejected', () => {
    expect(validateCampaignActivation({ ...validInput, reward_product_id: null })).toContain('reward_product_id')
  })

  test('a non-configurable reward is rejected (the money-path guard)', () => {
    expect(validateCampaignActivation({ ...validInput, reward_is_configurable: false })).toContain('reward_not_configurable')
  })

  test('a campaign with no works is rejected', () => {
    expect(validateCampaignActivation({ ...validInput, work_count: 0 })).toContain('works')
  })

  test('reward_percent out of 1–100 is rejected', () => {
    expect(validateCampaignActivation({ ...validInput, reward_percent: 0 })).toContain('reward_percent')
    expect(validateCampaignActivation({ ...validInput, reward_percent: 101 })).toContain('reward_percent')
  })
})

// ── Threshold + progress ─────────────────────────────────────────────────────
test.describe('threshold + progress (pure)', () => {
  test('threshold reached only at/above the count', () => {
    expect(thresholdReached(2, 3)).toBe(false)
    expect(thresholdReached(3, 3)).toBe(true)
    expect(thresholdReached(4, 3)).toBe(true)
  })
  test('a zero threshold is never "reached" (guards the mint)', () => {
    expect(thresholdReached(0, 0)).toBe(false)
    expect(thresholdReached(5, 0)).toBe(false)
  })
  test('progress clamps to [0,1] and never divides by zero', () => {
    expect(campaignProgress(0, 3)).toBe(0)
    expect(campaignProgress(3, 3)).toBe(1)
    expect(campaignProgress(6, 3)).toBe(1)
    expect(campaignProgress(1, 0)).toBe(0)
  })
})
