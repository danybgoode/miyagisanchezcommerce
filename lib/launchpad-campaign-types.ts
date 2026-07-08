/**
 * Bookshop launchpad · Sprint 3 — voting-campaign shared types + pure logic.
 *
 * Deliberately next-free and side-effect-free (no `server-only`, no `db`, no
 * `next/cache`, no crypto) so the Playwright `api` runner can import and
 * unit-test the state machine, the activation gate, and the threshold/progress
 * derivers without loading a route. The DB/email/mint plumbing lives in
 * `lib/launchpad-campaigns.ts` (server-only) which imports THIS.
 *
 * Only dependency is `lib/price-grid.ts` (also pure — no network, no next) for
 * the CPP-configured check.
 */
import type { PriceGrid } from '@/lib/price-grid'

/**
 * Campaign lifecycle:
 * - `draft`      → the shop is still editing; not public.
 * - `active`     → public at /v/[slug], accepting votes.
 * - `closed_met` → threshold reached; the reward coupon was minted (terminal).
 * - `closed_unmet` → ended below threshold; honest close, no coupon (terminal).
 * - `cancelled`  → the shop pulled it before/while active (terminal).
 */
export type CampaignStatus = 'draft' | 'active' | 'closed_met' | 'closed_unmet' | 'cancelled'

export const CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'draft', 'active', 'closed_met', 'closed_unmet', 'cancelled',
] as const

/** A closed campaign no longer accepts votes or edits (met, unmet, or cancelled). */
export const TERMINAL_CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  'closed_met', 'closed_unmet', 'cancelled',
] as const

export const DEFAULT_REWARD_PERCENT = 50

export interface LaunchpadCampaign {
  id: string
  shop_id: string
  medusa_seller_id: string
  slug: string
  status: CampaignStatus
  title: string | null
  description: string | null
  terms: string | null
  vote_threshold: number
  ends_at: string | null
  reward_percent: number
  reward_product_id: string | null
  coupon_code: string | null
  coupon_promotion_id: string | null
  minted_at: string | null
  closed_at: string | null
  closed_notified_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface LaunchpadCampaignWork {
  id: string
  campaign_id: string
  product_id: string
  position: number
  created_at: string
}

/**
 * The state machine, as an adjacency map: from → allowed next states.
 * - `draft`  → activate (public) or cancel.
 * - `active` → close met / close unmet (automation), or cancel (shop pulls it).
 * - closed_* / cancelled are terminal.
 */
const TRANSITIONS: Record<CampaignStatus, readonly CampaignStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['closed_met', 'closed_unmet', 'cancelled'],
  closed_met: [],
  closed_unmet: [],
  cancelled: [],
}

/** Pure predicate — no I/O. */
export function canTransitionCampaign(from: CampaignStatus, to: CampaignStatus): boolean {
  if (from === to) return false
  return TRANSITIONS[from]?.includes(to) ?? false
}

/**
 * A listing is CPP-configured (the reward can be a print product) when its price
 * grid has real multi-variant choice OR quantity tiers — the SAME test the PDP
 * uses to decide `hasConfigurator` (`app/(shell)/l/[id]/page.tsx`). Pure over an
 * already-fetched grid; the server route does the fetch via `getPriceGrid`.
 */
export function isConfigurablePriceGrid(grid: PriceGrid | null): boolean {
  if (!grid) return false
  return grid.variants.length > 1 || grid.variants.some((v) => v.tiers.length > 1)
}

export interface CampaignActivationInput {
  title?: string | null
  description?: string | null
  vote_threshold?: number | null
  ends_at?: string | null
  reward_percent?: number | null
  reward_product_id?: string | null
  work_count?: number
  /** From the server: did the reward product resolve to a CPP-configured grid? */
  reward_is_configurable?: boolean
  now?: number
}

/**
 * Returns the list of missing/invalid requirements for taking a campaign
 * `active`. Empty ⇒ ready. Mirrors `validatePublishGate` in `lib/sweepstakes.ts`.
 * Pure — the route supplies `reward_is_configurable` (needs Medusa) and `now`.
 */
export function validateCampaignActivation(input: CampaignActivationInput): string[] {
  const missing: string[] = []
  const now = input.now ?? Date.now()

  if (!input.title || !input.title.trim()) missing.push('title')
  if (!input.description || !input.description.trim()) missing.push('description')

  const threshold = Number(input.vote_threshold)
  if (!Number.isFinite(threshold) || threshold <= 0) missing.push('vote_threshold')

  const percent = Number(input.reward_percent)
  if (!Number.isFinite(percent) || percent < 1 || percent > 100) missing.push('reward_percent')

  if (!input.ends_at) {
    missing.push('ends_at')
  } else if (new Date(input.ends_at).getTime() <= now) {
    missing.push('future_end_date')
  }

  if (!input.reward_product_id || !input.reward_product_id.trim()) {
    missing.push('reward_product_id')
  } else if (input.reward_is_configurable === false) {
    missing.push('reward_not_configurable')
  }

  if ((input.work_count ?? 0) <= 0) missing.push('works')

  return missing
}

/** Has the campaign's total verified vote count reached its threshold? */
export function thresholdReached(voteCount: number, threshold: number): boolean {
  return threshold > 0 && voteCount >= threshold
}

/** Progress toward the threshold, clamped to [0, 1]. `0` threshold ⇒ 0 (never divide by zero). */
export function campaignProgress(voteCount: number, threshold: number): number {
  if (threshold <= 0) return 0
  return Math.max(0, Math.min(1, voteCount / threshold))
}

/**
 * Is the campaign currently accepting votes? Only an `active` campaign whose end
 * date hasn't passed. Pure — the route/cron supplies `now`. (A campaign past its
 * end date but still `active` is closed by the automation, not by this check.)
 */
export function campaignAcceptsVotes(
  campaign: Pick<LaunchpadCampaign, 'status' | 'ends_at'>,
  now = Date.now(),
): boolean {
  if (campaign.status !== 'active') return false
  if (campaign.ends_at && new Date(campaign.ends_at).getTime() <= now) return false
  return true
}

/**
 * The dedup key for a single vote — "one vote per email per WORK". Mirrors the
 * DB UNIQUE (campaign_id, work_product_id, email_hash); scoping is by campaign,
 * so the key omits the campaign id (callers are always within one campaign).
 */
export function voteKey(workProductId: string, emailHash: string): string {
  return `${workProductId}:${emailHash}`
}

/** Would this vote duplicate an existing one? A voter may vote once PER work. */
export function isDuplicateVote(
  existing: Iterable<string>,
  workProductId: string,
  emailHash: string,
): boolean {
  const key = voteKey(workProductId, emailHash)
  for (const k of existing) if (k === key) return true
  return false
}
