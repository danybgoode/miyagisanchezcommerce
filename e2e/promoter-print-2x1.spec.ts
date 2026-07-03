import { test, expect } from '@playwright/test'
import {
  decideNextEditionForClone,
  shouldAttemptClone,
  buildClone2x1Content,
} from '../lib/promoter-print-2x1'
import type { PrintAdContent, PrintEditionStatus } from '../lib/print'

/**
 * Promoter Funnel v2 · Sprint 3 (US-3.3) — 2x1 printed ad (api project — pure
 * logic, no network, no Supabase).
 */

type EditionFixture = {
  id: string; provider_id: string; status: PrintEditionStatus; submission_deadline: string | null
  distribution_date: string | null; created_at: string
  tiers: { key: string; medusa_product_id?: string | null }[]
}

const edition = (over: Partial<EditionFixture> = {}): EditionFixture => ({
  id: 'ed_current', provider_id: 'prov_1', status: 'open',
  submission_deadline: null, distribution_date: '2026-08-01T00:00:00Z',
  created_at: '2026-06-01T00:00:00Z',
  tiers: [{ key: 'half', medusa_product_id: 'prod_half' }],
  ...over,
})

test.describe('decideNextEditionForClone', () => {
  const current = edition({ id: 'ed_current', distribution_date: '2026-08-01T00:00:00Z' })

  test('no other editions from this provider ⇒ no_next_edition', () => {
    const decision = decideNextEditionForClone({ currentEdition: current, editions: [current], requiredTierKey: 'half' })
    expect(decision).toEqual({ ok: false, reason: 'no_next_edition' })
  })

  test('picks the immediate NEXT edition by distribution_date, not any later one', () => {
    const next = edition({ id: 'ed_next', distribution_date: '2026-09-01T00:00:00Z' })
    const later = edition({ id: 'ed_later', distribution_date: '2026-10-01T00:00:00Z' })
    const decision = decideNextEditionForClone({ currentEdition: current, editions: [current, later, next], requiredTierKey: 'half' })
    expect(decision).toEqual({ ok: true, editionId: 'ed_next' })
  })

  test('ignores editions from a DIFFERENT provider', () => {
    const otherProvider = edition({ id: 'ed_other', provider_id: 'prov_2', distribution_date: '2026-09-01T00:00:00Z' })
    const decision = decideNextEditionForClone({ currentEdition: current, editions: [current, otherProvider], requiredTierKey: 'half' })
    expect(decision).toEqual({ ok: false, reason: 'no_next_edition' })
  })

  test('ignores a closed/in_production/distributed edition — not accepting content', () => {
    const closedNext = edition({ id: 'ed_closed', status: 'closed', distribution_date: '2026-09-01T00:00:00Z' })
    const decision = decideNextEditionForClone({ currentEdition: current, editions: [current, closedNext], requiredTierKey: 'half' })
    expect(decision).toEqual({ ok: false, reason: 'no_next_edition' })
  })

  test('a next edition whose deadline already passed ⇒ deadline_passed (admin-manual fallback)', () => {
    const pastDeadline = edition({
      id: 'ed_next', distribution_date: '2026-09-01T00:00:00Z', submission_deadline: '2026-01-01T00:00:00Z',
    })
    const decision = decideNextEditionForClone({
      currentEdition: current, editions: [current, pastDeadline], requiredTierKey: 'half',
      now: new Date('2026-07-03T00:00:00Z'),
    })
    expect(decision).toEqual({ ok: false, reason: 'deadline_passed' })
  })

  test('a next edition missing the required tier (or its Medusa product) ⇒ tier_unavailable', () => {
    const noTier = edition({ id: 'ed_next', distribution_date: '2026-09-01T00:00:00Z', tiers: [{ key: 'full', medusa_product_id: 'prod_full' }] })
    const decision = decideNextEditionForClone({ currentEdition: current, editions: [current, noTier], requiredTierKey: 'half' })
    expect(decision).toEqual({ ok: false, reason: 'tier_unavailable' })
  })

  test('falls through a disqualified CLOSEST candidate to the next qualifying one (not just no_next_edition)', () => {
    const closestButPastDeadline = edition({
      id: 'ed_closest', distribution_date: '2026-09-01T00:00:00Z', submission_deadline: '2026-01-01T00:00:00Z',
    })
    const laterButQualifies = edition({ id: 'ed_later', distribution_date: '2026-10-01T00:00:00Z' })
    const decision = decideNextEditionForClone({
      currentEdition: current, editions: [current, closestButPastDeadline, laterButQualifies], requiredTierKey: 'half',
      now: new Date('2026-07-03T00:00:00Z'),
    })
    expect(decision).toEqual({ ok: true, editionId: 'ed_later' })
  })
})

test.describe('shouldAttemptClone', () => {
  test('only attempts for a real 2x1 sale not already handled', () => {
    expect(shouldAttemptClone({})).toBe(false)
    expect(shouldAttemptClone({ is_2x1: true })).toBe(true)
    expect(shouldAttemptClone({ is_2x1: true, is_2x1_cloned: true })).toBe(false)
    expect(shouldAttemptClone({ is_2x1: true, is_2x1_needs_manual_clone: true })).toBe(false)
  })
})

test.describe('buildClone2x1Content', () => {
  test('strips payment/report fields, carries editorial content, and marks provenance', () => {
    const original: PrintAdContent = {
      headline: 'Café Don Memo', photos: ['a.jpg'],
      payment_reported: true, payment_reported_at: '2026-07-01T00:00:00Z',
      manual_payment: { cash: { note: 'entregado' } },
      change_requests: [{ message: 'cambiar foto', at: '2026-07-01T00:00:00Z' }],
      is_2x1: true,
    }
    const clone = buildClone2x1Content(original, 'sub_original')
    expect(clone).toEqual({ headline: 'Café Don Memo', photos: ['a.jpg'], is_2x1_clone_of: 'sub_original' })
  })
})
