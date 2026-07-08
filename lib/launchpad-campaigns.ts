/**
 * Bookshop launchpad · Sprint 3 — voting-campaign server spine.
 *
 * Reuses, deliberately, the rails S1/S2 and the sweepstakes epic already built:
 *  - Seller resolution: `resolveSweepstakesSeller` (currentUser → Medusa seller →
 *    Supabase shop mirror) — a generic seller+shop resolver, not sweepstakes-only.
 *  - CPP detection: `getPriceGrid` (server, cached) + `isConfigurablePriceGrid`
 *    (pure) — the reward MUST be a print-configurator listing.
 *  - Ownership: `getListing` — a work / reward product must belong to this shop.
 *  - State machine + activation gate: `lib/launchpad-campaign-types.ts` (pure).
 *
 * Votes + the email-code verification + the reward mint live further down (Stories
 * 3.2 / 3.3). Non-commerce vote/intake data → Supabase (AGENTS rule #2).
 */
import 'server-only'

import { randomBytes } from 'crypto'
import { db } from '@/lib/supabase'
import { resolveSweepstakesSeller } from '@/lib/sweepstakes-seller'
import { getPriceGrid, getListing } from '@/lib/listings'
import {
  cleanEmail,
  hashSweepstakesEmail,
  hashVerificationCode,
  safeCompare,
  makeCode,
  isValidEmail,
} from '@/lib/sweepstakes'
import { sendLaunchpadCampaignVoteCode } from '@/lib/email'
import {
  canTransitionCampaign,
  campaignAcceptsVotes,
  isConfigurablePriceGrid,
  thresholdReached,
  validateCampaignActivation,
  type LaunchpadCampaign,
  type LaunchpadCampaignWork,
} from '@/lib/launchpad-campaign-types'

export { isValidEmail } from '@/lib/sweepstakes'

export type SellerContext = NonNullable<Awaited<ReturnType<typeof resolveSweepstakesSeller>>>

// ── Slug ─────────────────────────────────────────────────────────────────────

function slugifyCampaign(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    || `campana-${randomBytes(3).toString('hex')}`
}

export async function uniqueCampaignSlug(input: string): Promise<string> {
  const base = slugifyCampaign(input)
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`
    const { data } = await db.from('launchpad_campaigns').select('id').eq('slug', slug).maybeSingle()
    if (!data) return slug
  }
  return `${base}-${Date.now().toString(36)}`
}

// ── Seller resolution ────────────────────────────────────────────────────────

/** Resolve the authenticated seller's shop context (or null when unauthenticated). */
export async function resolveCampaignSeller(): Promise<SellerContext | null> {
  return resolveSweepstakesSeller()
}

// ── Reads ────────────────────────────────────────────────────────────────────

export interface CampaignWithMeta extends LaunchpadCampaign {
  works: LaunchpadCampaignWork[]
  vote_count: number
}

async function worksFor(campaignId: string): Promise<LaunchpadCampaignWork[]> {
  const { data } = await db
    .from('launchpad_campaign_works')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('position', { ascending: true })
  return (data ?? []) as LaunchpadCampaignWork[]
}

/** Total verified votes for a campaign — honest count, never a stored counter. */
export async function getCampaignVoteCount(campaignId: string): Promise<number> {
  const { count } = await db
    .from('launchpad_campaign_votes')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
  return count ?? 0
}

/** Per-work verified vote tallies, keyed by product id. */
export async function getCampaignVoteTallies(campaignId: string): Promise<Record<string, number>> {
  const { data } = await db
    .from('launchpad_campaign_votes')
    .select('work_product_id')
    .eq('campaign_id', campaignId)
  const tallies: Record<string, number> = {}
  for (const row of data ?? []) {
    const key = (row as { work_product_id: string }).work_product_id
    tallies[key] = (tallies[key] ?? 0) + 1
  }
  return tallies
}

export async function listCampaignsForShop(shopId: string): Promise<CampaignWithMeta[]> {
  const { data } = await db
    .from('launchpad_campaigns')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
  const campaigns = (data ?? []) as LaunchpadCampaign[]
  return Promise.all(campaigns.map(async (c) => ({
    ...c,
    works: await worksFor(c.id),
    vote_count: await getCampaignVoteCount(c.id),
  })))
}

export async function getCampaignForShop(shopId: string, id: string): Promise<CampaignWithMeta | null> {
  const { data } = await db
    .from('launchpad_campaigns')
    .select('*')
    .eq('id', id)
    .eq('shop_id', shopId)
    .maybeSingle()
  if (!data) return null
  const campaign = data as LaunchpadCampaign
  return { ...campaign, works: await worksFor(campaign.id), vote_count: await getCampaignVoteCount(campaign.id) }
}

/** Public read by slug (for /v/[slug]); returns the campaign regardless of shop. */
export async function getCampaignBySlug(slug: string): Promise<CampaignWithMeta | null> {
  const { data } = await db.from('launchpad_campaigns').select('*').eq('slug', slug).maybeSingle()
  if (!data) return null
  const campaign = data as LaunchpadCampaign
  return { ...campaign, works: await worksFor(campaign.id), vote_count: await getCampaignVoteCount(campaign.id) }
}

// ── Ownership + CPP checks ───────────────────────────────────────────────────

/** True iff `productId` is a published listing owned by this shop (Medusa seller). */
async function productBelongsToShop(productId: string, sellerId: string): Promise<boolean> {
  const listing = await getListing(productId)
  return !!listing && listing.shop_id === sellerId
}

/** True iff `productId` resolves to a CPP-configured price grid (multi-variant / tiers). */
export async function rewardIsConfigurable(productId: string): Promise<boolean> {
  return isConfigurablePriceGrid(await getPriceGrid(productId))
}

// ── Writes ───────────────────────────────────────────────────────────────────

export interface CreateCampaignInput {
  context: SellerContext
  title: string
  description?: string | null
  terms?: string | null
  vote_threshold: number
  ends_at?: string | null
  reward_percent?: number | null
  reward_product_id?: string | null
  work_product_ids?: string[]
}

export type CampaignWriteResult =
  | { ok: true; campaign: CampaignWithMeta }
  | { ok: false; status: number; error: string; missing?: string[] }

/**
 * Create a DRAFT campaign + set its candidate works. Validates that every work
 * and the reward product (if given) belong to this shop; the reward is checked
 * for CPP-configuration here so the builder surfaces it early (the activation
 * gate re-checks). Reward defaults to 50%.
 */
export async function createCampaign(input: CreateCampaignInput): Promise<CampaignWriteResult> {
  const { context } = input
  const title = input.title?.trim()
  if (!title) return { ok: false, status: 422, error: 'title_required' }

  const rewardPercent = Math.max(1, Math.min(100, Math.floor(Number(input.reward_percent ?? 50)) || 50))
  const threshold = Math.max(0, Math.floor(Number(input.vote_threshold ?? 0)) || 0)
  const workIds = Array.from(new Set((input.work_product_ids ?? []).filter((x) => typeof x === 'string' && x.trim())))

  // Ownership: every candidate work must be this shop's product.
  for (const pid of workIds) {
    if (!(await productBelongsToShop(pid, context.seller.id))) {
      return { ok: false, status: 422, error: 'work_not_owned' }
    }
  }
  // Reward (optional at draft time): must be this shop's product AND CPP-configured.
  const rewardProductId = input.reward_product_id?.trim() || null
  if (rewardProductId) {
    if (!(await productBelongsToShop(rewardProductId, context.seller.id))) {
      return { ok: false, status: 422, error: 'reward_not_owned' }
    }
    if (!(await rewardIsConfigurable(rewardProductId))) {
      return { ok: false, status: 422, error: 'reward_not_configurable' }
    }
  }

  const slug = await uniqueCampaignSlug(title)
  const { data, error } = await db
    .from('launchpad_campaigns')
    .insert({
      shop_id: context.shop.id,
      medusa_seller_id: context.seller.id,
      slug,
      status: 'draft',
      title,
      description: input.description?.trim() || null,
      terms: input.terms?.trim() || null,
      vote_threshold: threshold,
      ends_at: input.ends_at || null,
      reward_percent: rewardPercent,
      reward_product_id: rewardProductId,
      created_by: context.userId,
    })
    .select('*')
    .single()
  if (error || !data) {
    console.error('[launchpad-campaign] create failed:', error)
    return { ok: false, status: 500, error: 'create_failed' }
  }

  const campaign = data as LaunchpadCampaign
  if (workIds.length) {
    const rows = workIds.map((pid, i) => ({ campaign_id: campaign.id, product_id: pid, position: i }))
    await db.from('launchpad_campaign_works').insert(rows)
  }

  const full = await getCampaignForShop(context.shop.id, campaign.id)
  return full ? { ok: true, campaign: full } : { ok: false, status: 500, error: 'reload_failed' }
}

/** Replace the candidate works of a DRAFT campaign (ownership-checked). */
export async function setCampaignWorks(
  context: SellerContext,
  campaignId: string,
  productIds: string[],
): Promise<CampaignWriteResult> {
  const current = await getCampaignForShop(context.shop.id, campaignId)
  if (!current) return { ok: false, status: 404, error: 'not_found' }
  if (current.status !== 'draft') return { ok: false, status: 422, error: 'not_editable' }

  const ids = Array.from(new Set(productIds.filter((x) => typeof x === 'string' && x.trim())))
  for (const pid of ids) {
    if (!(await productBelongsToShop(pid, context.seller.id))) {
      return { ok: false, status: 422, error: 'work_not_owned' }
    }
  }
  await db.from('launchpad_campaign_works').delete().eq('campaign_id', campaignId)
  if (ids.length) {
    await db.from('launchpad_campaign_works').insert(ids.map((pid, i) => ({ campaign_id: campaignId, product_id: pid, position: i })))
  }
  const full = await getCampaignForShop(context.shop.id, campaignId)
  return full ? { ok: true, campaign: full } : { ok: false, status: 500, error: 'reload_failed' }
}

/**
 * Activate a draft campaign (draft → active). Runs the full activation gate,
 * including a live CPP re-check on the reward product. Returns `missing` on a
 * gate failure so the builder can point at the offending fields.
 */
export async function activateCampaign(context: SellerContext, campaignId: string): Promise<CampaignWriteResult> {
  const current = await getCampaignForShop(context.shop.id, campaignId)
  if (!current) return { ok: false, status: 404, error: 'not_found' }
  if (!canTransitionCampaign(current.status, 'active')) {
    return { ok: false, status: 422, error: 'invalid_transition' }
  }

  const rewardConfigurable = current.reward_product_id
    ? await rewardIsConfigurable(current.reward_product_id)
    : false

  const missing = validateCampaignActivation({
    title: current.title,
    description: current.description,
    vote_threshold: current.vote_threshold,
    ends_at: current.ends_at,
    reward_percent: current.reward_percent,
    reward_product_id: current.reward_product_id,
    work_count: current.works.length,
    reward_is_configurable: rewardConfigurable,
  })
  if (missing.length) return { ok: false, status: 422, error: 'incomplete', missing }

  const { error } = await db
    .from('launchpad_campaigns')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('shop_id', context.shop.id)
    .eq('status', 'draft')
  if (error) return { ok: false, status: 500, error: 'activate_failed' }

  const full = await getCampaignForShop(context.shop.id, campaignId)
  return full ? { ok: true, campaign: full } : { ok: false, status: 500, error: 'reload_failed' }
}

export interface UpdateCampaignInput {
  title?: string | null
  description?: string | null
  terms?: string | null
  vote_threshold?: number | null
  ends_at?: string | null
  reward_percent?: number | null
  reward_product_id?: string | null
  work_product_ids?: string[]
}

/**
 * Update the editable fields of a DRAFT campaign (+ optionally its works). Only
 * drafts are editable — an active campaign's terms are locked (honest-campaign
 * posture). Reward ownership + CPP-config are re-checked when it changes.
 */
export async function updateCampaign(
  context: SellerContext,
  campaignId: string,
  input: UpdateCampaignInput,
): Promise<CampaignWriteResult> {
  const current = await getCampaignForShop(context.shop.id, campaignId)
  if (!current) return { ok: false, status: 404, error: 'not_found' }
  if (current.status !== 'draft') return { ok: false, status: 422, error: 'not_editable' }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.title !== undefined) patch.title = input.title?.trim() || null
  if (input.description !== undefined) patch.description = input.description?.trim() || null
  if (input.terms !== undefined) patch.terms = input.terms?.trim() || null
  if (input.vote_threshold !== undefined) patch.vote_threshold = Math.max(0, Math.floor(Number(input.vote_threshold ?? 0)) || 0)
  if (input.ends_at !== undefined) patch.ends_at = input.ends_at || null
  if (input.reward_percent !== undefined) patch.reward_percent = Math.max(1, Math.min(100, Math.floor(Number(input.reward_percent ?? 50)) || 50))

  if (input.reward_product_id !== undefined) {
    const rewardProductId = input.reward_product_id?.trim() || null
    if (rewardProductId) {
      if (!(await productBelongsToShop(rewardProductId, context.seller.id))) {
        return { ok: false, status: 422, error: 'reward_not_owned' }
      }
      if (!(await rewardIsConfigurable(rewardProductId))) {
        return { ok: false, status: 422, error: 'reward_not_configurable' }
      }
    }
    patch.reward_product_id = rewardProductId
  }

  const { error } = await db
    .from('launchpad_campaigns')
    .update(patch)
    .eq('id', campaignId)
    .eq('shop_id', context.shop.id)
    .eq('status', 'draft')
  if (error) return { ok: false, status: 500, error: 'update_failed' }

  if (input.work_product_ids !== undefined) {
    return setCampaignWorks(context, campaignId, input.work_product_ids)
  }

  const full = await getCampaignForShop(context.shop.id, campaignId)
  return full ? { ok: true, campaign: full } : { ok: false, status: 500, error: 'reload_failed' }
}

/** Cancel a draft/active campaign (terminal). */
export async function cancelCampaign(context: SellerContext, campaignId: string): Promise<CampaignWriteResult> {
  const current = await getCampaignForShop(context.shop.id, campaignId)
  if (!current) return { ok: false, status: 404, error: 'not_found' }
  if (!canTransitionCampaign(current.status, 'cancelled')) {
    return { ok: false, status: 422, error: 'invalid_transition' }
  }
  const { error } = await db
    .from('launchpad_campaigns')
    .update({ status: 'cancelled', closed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', campaignId)
    .eq('shop_id', context.shop.id)
  if (error) return { ok: false, status: 500, error: 'cancel_failed' }
  const full = await getCampaignForShop(context.shop.id, campaignId)
  return full ? { ok: true, campaign: full } : { ok: false, status: 500, error: 'reload_failed' }
}

// ── Public voting (Story 3.2) ────────────────────────────────────────────────
// Email-code verification scoped by CAMPAIGN id, persisting to
// `launchpad_campaign_verifications` — the exact shape as the sweepstakes/S1
// launchpad flows, just a different scope table.

const CODE_TTL_MS = 15 * 60 * 1000

/** Send a 6-char code to a voter about to cast a vote. Persists before emailing. */
export async function sendCampaignVoteCode(campaign: LaunchpadCampaign, email: string): Promise<void> {
  const normalized = cleanEmail(email)
  const emailHash = hashSweepstakesEmail(normalized)
  const code = makeCode()
  const codeHash = hashVerificationCode(campaign.id, emailHash, code)

  const { error } = await db.from('launchpad_campaign_verifications').insert({
    campaign_id: campaign.id,
    email_hash: emailHash,
    email: normalized,
    code_hash: codeHash,
    locale: 'es',
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) throw new Error(`campaign verification insert failed: ${error.message}`)

  await sendLaunchpadCampaignVoteCode({ to: normalized, code, campaignTitle: campaign.title ?? 'la votación' })
}

/** Verify a code (consumes on success). Same 5-attempt / 15-min TTL as the launchpad/sweepstakes flows. */
export async function verifyCampaignCode(campaign: LaunchpadCampaign, email: string, code: string): Promise<boolean> {
  const normalized = cleanEmail(email)
  const emailHash = hashSweepstakesEmail(normalized)
  const { data } = await db
    .from('launchpad_campaign_verifications')
    .select('id, code_hash, attempts, expires_at, consumed_at')
    .eq('campaign_id', campaign.id)
    .eq('email_hash', emailHash)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data || data.consumed_at || data.attempts >= 5 || new Date(data.expires_at).getTime() < Date.now()) return false

  const expected = hashVerificationCode(campaign.id, emailHash, code)
  const ok = safeCompare(expected, data.code_hash)
  await db
    .from('launchpad_campaign_verifications')
    .update({ attempts: (data.attempts ?? 0) + 1, ...(ok ? { consumed_at: new Date().toISOString() } : {}) })
    .eq('id', data.id)
  return ok
}

export type CastVoteResult =
  | { ok: true; already_voted: boolean; vote_count: number; threshold_reached: boolean }
  | { ok: false; status: number; error: string }

/**
 * Record one verified vote for a work in a campaign. Enforces: campaign open
 * (active + before end date), the work IS a candidate of this campaign, and the
 * code verifies. Idempotent on the DB UNIQUE (campaign_id, work_product_id,
 * email_hash) — a repeat vote for the same work returns `already_voted` rather
 * than erroring. Returns the fresh honest vote count + whether the threshold is
 * now reached (the caller fires the mint — Story 3.3).
 */
export async function castVote(input: {
  campaign: CampaignWithMeta
  workProductId: string
  email: string
  code: string
}): Promise<CastVoteResult> {
  const { campaign } = input
  if (!campaignAcceptsVotes(campaign)) return { ok: false, status: 422, error: 'not_open' }
  if (!isValidEmail(input.email)) return { ok: false, status: 422, error: 'invalid_email' }
  if (!campaign.works.some((w) => w.product_id === input.workProductId)) {
    return { ok: false, status: 422, error: 'unknown_work' }
  }

  const verified = await verifyCampaignCode(campaign, input.email, input.code)
  if (!verified) return { ok: false, status: 422, error: 'invalid_code' }

  const email = cleanEmail(input.email)
  const emailHash = hashSweepstakesEmail(email)

  // Idempotent insert: the UNIQUE key makes a repeat vote a no-op (ignoreDuplicates).
  const { data: inserted, error } = await db
    .from('launchpad_campaign_votes')
    .upsert(
      { campaign_id: campaign.id, work_product_id: input.workProductId, email, email_hash: emailHash, locale: 'es' },
      { onConflict: 'campaign_id,work_product_id,email_hash', ignoreDuplicates: true },
    )
    .select('id')
  if (error) {
    console.error('[launchpad-campaign] vote insert failed:', error.message)
    return { ok: false, status: 500, error: 'vote_failed' }
  }
  const alreadyVoted = !inserted || inserted.length === 0

  const voteCount = await getCampaignVoteCount(campaign.id)
  return {
    ok: true,
    already_voted: alreadyVoted,
    vote_count: voteCount,
    threshold_reached: thresholdReached(voteCount, campaign.vote_threshold),
  }
}
