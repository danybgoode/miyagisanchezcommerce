import { test, expect } from '@playwright/test'
import {
  annualSaving,
  planKey,
  groupTiersByPlan,
  hasBothIntervals,
  tierAnnualSaving,
  type PlanTier,
} from '../lib/subscription-pricing'

/**
 * PDP redesign (epic 01) — Sprint 4, S4.4 (subscriptions).
 *
 * The annual saving shown by the mensual/anual toggle MUST be exact, so the math
 * is a pure seam proven here (no network / no `next/*`; runs in the `api` gate).
 */

function tier(id: string, label: string, price_cents: number, interval: 'month' | 'year', is_highlighted = false): PlanTier {
  return { id, label, price_cents, interval, is_highlighted }
}

test.describe('subscription-pricing · annualSaving (exact)', () => {
  test('12 × monthly − annual, with rounded percentage', () => {
    // $199/mes (19900c) × 12 = 238800c; annual $1,990 (199000c) → saves 39800c (~17%).
    const s = annualSaving(19900, 199000)!
    expect(s.savingCents).toBe(39800)
    expect(s.savingPct).toBe(17)
  })

  test('exact saving for a clean example', () => {
    // $100/mes (10000c) × 12 = 120000c; annual 100000c → save 20000c (≈17%).
    const s = annualSaving(10000, 100000)!
    expect(s.savingCents).toBe(20000)
    expect(s.savingPct).toBe(17)
    expect(s.monthlyCents).toBe(10000)
    expect(s.annualCents).toBe(100000)
  })

  test('null when annual is not cheaper, or a price is missing', () => {
    expect(annualSaving(10000, 120000)).toBeNull() // exactly 12× → no saving
    expect(annualSaving(10000, 130000)).toBeNull() // more expensive
    expect(annualSaving(0, 100000)).toBeNull()
    expect(annualSaving(10000, 0)).toBeNull()
  })
})

test.describe('subscription-pricing · planKey + grouping', () => {
  test('interval words are stripped so month/year of one plan group together', () => {
    expect(planKey('Pro Mensual')).toBe('pro')
    expect(planKey('Pro Anual')).toBe('pro')
    expect(planKey('Plan Básico')).toBe('plan básico')
  })

  test('groupTiersByPlan pairs the monthly and annual tier of a plan', () => {
    const tiers = [
      tier('m', 'Pro Mensual', 10000, 'month', true),
      tier('y', 'Pro Anual', 100000, 'year'),
    ]
    const groups = groupTiersByPlan(tiers)
    expect(groups).toHaveLength(1)
    expect(groups[0].monthly?.id).toBe('m')
    expect(groups[0].annual?.id).toBe('y')
    expect(groups[0].is_highlighted).toBe(true)
    expect(groups[0].label).toBe('Pro')
  })

  test('separate plans stay separate; first-seen order preserved', () => {
    const groups = groupTiersByPlan([
      tier('b', 'Básico Mensual', 5000, 'month'),
      tier('p', 'Pro Mensual', 10000, 'month'),
    ])
    expect(groups.map(g => g.key)).toEqual(['básico', 'pro'])
  })

  test('hasBothIntervals only when a month AND a year tier exist', () => {
    expect(hasBothIntervals([tier('m', 'Pro', 10000, 'month')])).toBe(false)
    expect(hasBothIntervals([tier('m', 'Pro', 10000, 'month'), tier('y', 'Pro', 100000, 'year')])).toBe(true)
  })

  test('tierAnnualSaving resolves the saving from either tier id of a paired plan', () => {
    const tiers = [tier('m', 'Pro Mensual', 10000, 'month'), tier('y', 'Pro Anual', 100000, 'year')]
    const groups = groupTiersByPlan(tiers)
    expect(tierAnnualSaving(groups, 'm')?.savingCents).toBe(20000)
    expect(tierAnnualSaving(groups, 'y')?.savingCents).toBe(20000)
    // a plan with no annual variant → null
    const lone = groupTiersByPlan([tier('s', 'Solo', 10000, 'month')])
    expect(tierAnnualSaving(lone, 's')).toBeNull()
  })
})
