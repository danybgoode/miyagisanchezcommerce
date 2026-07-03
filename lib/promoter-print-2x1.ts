/**
 * Promoter Funnel v2 · Sprint 3 (US-3.3) — 2x1 printed ad: pay 1 edition, appear
 * in 2 consecutive ones.
 *
 * Pure decision seam: given the ORIGINAL edition + the full list of editions from
 * the SAME provider, pick the immediate next edition still accepting content
 * (status `draft`/`open`, submission deadline not yet passed). No eligible next
 * edition (not yet created, or its deadline already passed) ⇒ the documented
 * admin-manual "clonar a la siguiente edición" fallback (v1, per the sprint-3.md
 * build note) — never silently drops the perk.
 *
 * Pure + next-free (no DB, no `next/cache`) — directly unit-testable
 * (e2e/promoter-print-2x1.spec.ts). The Supabase reads/inserts (find editions,
 * clone the submission row) live in lib/print-server.ts, exactly like every other
 * print-editorial seam.
 */

import type { PrintAdContent, PrintEditionStatus } from '@/lib/print'

export type NextEditionDecision =
  | { ok: true; editionId: string }
  | { ok: false; reason: 'no_next_edition' | 'deadline_passed' | 'tier_unavailable' }

/** The slim slice of a `PrintEdition` this deriver needs — any object with at
 *  least these fields works (a full `PrintEdition` row satisfies it as-is). */
export interface EditionForCloneDecision {
  id: string
  provider_id: string
  status: PrintEditionStatus
  submission_deadline: string | null
  distribution_date: string | null
  created_at: string
  tiers: readonly { key: string; medusa_product_id?: string | null }[]
}

/**
 * Pick the immediate next SAME-provider edition still open for content, ordered
 * by `distribution_date` (falling back to `created_at` when unset — a freshly
 * scaffolded edition may not have a distribution date yet). Only `draft`/`open`
 * editions are eligible (closed/in_production/distributed can't take a new
 * submission). A candidate whose `submission_deadline` has already passed, or
 * that's missing the required tier, is skipped in favor of the NEXT candidate
 * (fixed in cross-agent review of PR #165 — previously only the single closest
 * candidate was checked, contradicting this comment's own stated intent) — the
 * failure reason on a total miss is whichever the CLOSEST candidate failed on
 * (the most actionable one for the admin-manual fallback to report).
 */
export function decideNextEditionForClone(input: {
  currentEdition: Pick<EditionForCloneDecision, 'id' | 'provider_id' | 'distribution_date' | 'created_at'>
  editions: readonly EditionForCloneDecision[]
  requiredTierKey: string
  now?: Date
}): NextEditionDecision {
  const { currentEdition, editions, requiredTierKey } = input
  const now = input.now ?? new Date()
  const currentRank = Date.parse(currentEdition.distribution_date ?? currentEdition.created_at)

  const candidates = editions
    .filter((e) => e.provider_id === currentEdition.provider_id && e.id !== currentEdition.id)
    .filter((e) => e.status === 'draft' || e.status === 'open')
    .map((e) => ({ edition: e, rank: Date.parse(e.distribution_date ?? e.created_at) }))
    .filter((c) => Number.isFinite(c.rank) && c.rank > currentRank)
    .sort((a, b) => a.rank - b.rank)

  if (candidates.length === 0) return { ok: false, reason: 'no_next_edition' }

  let closestFailure: NextEditionDecision = { ok: false, reason: 'no_next_edition' }
  for (const { edition } of candidates) {
    if (edition.submission_deadline && Date.parse(edition.submission_deadline) < now.getTime()) {
      closestFailure = { ok: false, reason: 'deadline_passed' }
      continue
    }
    const tier = (edition.tiers ?? []).find((t) => t.key === requiredTierKey)
    if (!tier?.medusa_product_id) {
      closestFailure = { ok: false, reason: 'tier_unavailable' }
      continue
    }
    return { ok: true, editionId: edition.id }
  }
  return closestFailure
}

/**
 * Whether a submission should attempt a 2x1 clone: it was sold as 2x1 and hasn't
 * already been cloned or flagged for the manual fallback (idempotent — a webhook
 * retry or a second admin confirm never double-clones).
 */
export function shouldAttemptClone(content: Pick<PrintAdContent, 'is_2x1' | 'is_2x1_cloned' | 'is_2x1_needs_manual_clone'>): boolean {
  return content.is_2x1 === true && !content.is_2x1_cloned && !content.is_2x1_needs_manual_clone
}

/**
 * Build the comped clone's insert payload — same tier/seller, content STRIPPED of
 * payment/contact-report fields (a fresh clone, not a copy of the original's
 * payment trail) and marked `is_2x1_clone_of`. Status `paid`: it re-enters the
 * editorial queue exactly like a real paid submission (needs admin approval), but
 * accrues no commission (never created by markAttributionPaid).
 */
export function buildClone2x1Content(original: PrintAdContent, originalSubmissionId: string): PrintAdContent {
  const {
    payment_reported: _payment_reported,
    payment_reported_at: _payment_reported_at,
    payment_reminded: _payment_reminded,
    manual_payment: _manual_payment,
    change_requests: _change_requests,
    is_2x1: _is_2x1,
    is_2x1_cloned: _is_2x1_cloned,
    is_2x1_clone_id: _is_2x1_clone_id,
    is_2x1_needs_manual_clone: _is_2x1_needs_manual_clone,
    ...rest
  } = original
  return { ...rest, is_2x1_clone_of: originalSubmissionId }
}
