/**
 * Bookshop launchpad · Sprint 3.3 — threshold + close automation (the mint path).
 *
 * Two entry points, both idempotent and replay-safe:
 *  - `closeCampaignIfThresholdMet(id)` — fired from the vote route the moment a
 *    vote takes a campaign to its threshold. Optimistically claims the mint (via
 *    `coupon_promotion_id`, the promoter-mint precedent), mints the PRODUCT-SCOPED
 *    reward coupon through the backend internal route, records it, then notifies.
 *  - `runCampaignCloseCron()` — the daily sweep: every `active` campaign past its
 *    `ends_at` closes met (mint) or unmet (honest, no coupon), notifying either way.
 *
 * The coupon is minted on the CAMPAIGN's seller and scoped to ONE print product,
 * so it can only ever discount that book's print listing (never shop-wide) — the
 * scope is enforced at checkout by the backend (`resolveCouponForCheckout`).
 */
import 'server-only'

import { db } from '@/lib/supabase'
import {
  sendLaunchpadCampaignCouponEmail,
  sendLaunchpadCampaignResultEmail,
  sendLaunchpadCampaignVoterUnmet,
} from '@/lib/email'
import { thresholdReached, decideCampaignClose } from '@/lib/launchpad-campaign-types'
import { getCampaignByIdInternal, type CampaignWithMeta } from '@/lib/launchpad-campaigns'

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com').replace(/\/+$/, '')
const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

// The coupon is valid for a generous window after the unlock (readers need time
// to order the print run).
const COUPON_VALIDITY_DAYS = 60
// Sentinel written to `coupon_promotion_id` while a mint is in flight, so a
// concurrent fire loses the conditional claim (mirrors publishSubmission).
const PENDING_PREFIX = 'pending:'

/** Deterministic, per-campaign coupon code (the unique slug keeps it collision-free). */
function campaignCouponCode(campaign: CampaignWithMeta): string {
  return `VOTO-${campaign.reward_percent}-${campaign.slug}`.toUpperCase().slice(0, 40)
}

interface MintResult { code: string; promotionId: string }

/** Mint (find-or-create) the product-scoped seller coupon via the backend internal route. */
async function mintCampaignCoupon(campaign: CampaignWithMeta, code: string): Promise<MintResult | null> {
  if (!INTERNAL_SECRET || !campaign.reward_product_id) return null
  const expiry = new Date(Date.now() + COUPON_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/launchpad-campaign-coupon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({
        seller_id: campaign.medusa_seller_id,
        code,
        percent: campaign.reward_percent,
        product_id: campaign.reward_product_id,
        expiry,
      }),
    })
    if (!res.ok) {
      console.error('[launchpad-campaign] mint failed:', res.status, await res.text().catch(() => ''))
      return null
    }
    const data = (await res.json()) as { coupon?: { id?: string; code?: string } }
    if (!data.coupon?.id || !data.coupon.code) return null
    return { code: data.coupon.code, promotionId: data.coupon.id }
  } catch (e) {
    console.error('[launchpad-campaign] mint request error:', e)
    return null
  }
}

// ── Notification helpers ─────────────────────────────────────────────────────

async function distinctVoterEmails(campaignId: string): Promise<string[]> {
  const { data } = await db.from('launchpad_campaign_votes').select('email').eq('campaign_id', campaignId)
  return Array.from(new Set((data ?? []).map((r) => (r as { email: string }).email).filter(Boolean)))
}

interface WriterContact { email: string; name: string; title: string }

/** Authors of the campaign's candidate works (via each work's publish provenance). */
async function writerContacts(workProductIds: string[]): Promise<WriterContact[]> {
  if (!workProductIds.length) return []
  const { data } = await db
    .from('launchpad_submissions')
    .select('author_email, author_name, title')
    .in('published_product_id', workProductIds)
  const seen = new Set<string>()
  const out: WriterContact[] = []
  for (const r of data ?? []) {
    const row = r as { author_email: string; author_name: string; title: string }
    if (!row.author_email || seen.has(row.author_email)) continue
    seen.add(row.author_email)
    out.push({ email: row.author_email, name: row.author_name, title: row.title })
  }
  return out
}

/** Best-effort seller contact email (marketplace_shops.metadata.contact_email). */
async function sellerEmail(shopId: string): Promise<string | null> {
  const { data } = await db.from('marketplace_shops').select('metadata').eq('id', shopId).maybeSingle()
  const meta = (data?.metadata ?? {}) as Record<string, unknown>
  const email = meta.contact_email
  return typeof email === 'string' && email.includes('@') ? email : null
}

async function notifyMet(campaign: CampaignWithMeta, couponCode: string): Promise<void> {
  const productUrl = `${SITE_URL}/l/${campaign.reward_product_id}`
  const expiresAt = new Date(Date.now() + COUPON_VALIDITY_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const title = campaign.title ?? 'la campaña'

  const voters = await distinctVoterEmails(campaign.id)
  for (const to of voters) {
    try {
      await sendLaunchpadCampaignCouponEmail({ to, campaignTitle: title, couponCode, percent: campaign.reward_percent, productUrl, expiresAt })
    } catch (e) { console.error('[launchpad-campaign] voter coupon email failed (non-fatal):', e) }
  }

  const writers = await writerContacts(campaign.works.map((w) => w.product_id))
  const seller = await sellerEmail(campaign.shop_id)
  const recipients = [...writers.map((w) => w.email), ...(seller ? [seller] : [])]
  for (const to of Array.from(new Set(recipients))) {
    try {
      await sendLaunchpadCampaignResultEmail({ to, campaignTitle: title, met: true, voteCount: campaign.vote_count, threshold: campaign.vote_threshold, couponCode })
    } catch (e) { console.error('[launchpad-campaign] result email failed (non-fatal):', e) }
  }
}

async function notifyUnmet(campaign: CampaignWithMeta): Promise<void> {
  const title = campaign.title ?? 'la campaña'
  const voters = await distinctVoterEmails(campaign.id)
  for (const to of voters) {
    try { await sendLaunchpadCampaignVoterUnmet({ to, campaignTitle: title }) }
    catch (e) { console.error('[launchpad-campaign] voter unmet email failed (non-fatal):', e) }
  }
  const writers = await writerContacts(campaign.works.map((w) => w.product_id))
  const seller = await sellerEmail(campaign.shop_id)
  for (const to of Array.from(new Set([...writers.map((w) => w.email), ...(seller ? [seller] : [])]))) {
    try { await sendLaunchpadCampaignResultEmail({ to, campaignTitle: title, met: false, voteCount: campaign.vote_count, threshold: campaign.vote_threshold }) }
    catch (e) { console.error('[launchpad-campaign] result email failed (non-fatal):', e) }
  }
}

// ── Close (met) — claim → mint → finalize → notify ───────────────────────────

export type CloseResult =
  | { ok: true; outcome: 'met' | 'unmet' | 'noop' }
  | { ok: false; reason: string }

/**
 * Close an active campaign as MET: mint the product-scoped coupon (idempotently)
 * and notify. Safe to call from the vote route AND the cron — the optimistic
 * `coupon_promotion_id` claim means only one caller mints; the rest no-op.
 */
async function closeCampaignMet(campaign: CampaignWithMeta): Promise<CloseResult> {
  const now = new Date().toISOString()
  const code = campaignCouponCode(campaign)

  // Claim: flip coupon_promotion_id null → sentinel, only while still active.
  const { data: claimed } = await db
    .from('launchpad_campaigns')
    .update({ coupon_promotion_id: `${PENDING_PREFIX}${now}`, updated_at: now })
    .eq('id', campaign.id)
    .eq('status', 'active')
    .is('coupon_promotion_id', null)
    .select('id')
  if (!claimed || claimed.length === 0) {
    // Someone already minting/closed this campaign → idempotent no-op.
    return { ok: true, outcome: 'noop' }
  }

  const mint = await mintCampaignCoupon(campaign, code)
  if (!mint) {
    // Release the claim so a later cron pass can retry (campaign stays active).
    await db.from('launchpad_campaigns').update({ coupon_promotion_id: null })
      .eq('id', campaign.id).like('coupon_promotion_id', `${PENDING_PREFIX}%`)
    return { ok: false, reason: 'mint_failed' }
  }

  await db.from('launchpad_campaigns').update({
    status: 'closed_met',
    coupon_code: mint.code,
    coupon_promotion_id: mint.promotionId,
    minted_at: now,
    closed_at: now,
    closed_notified_at: now,
    updated_at: now,
  }).eq('id', campaign.id)

  await notifyMet(campaign, mint.code)
  return { ok: true, outcome: 'met' }
}

/** Close an active campaign as UNMET: no coupon, honest notify. Idempotent. */
async function closeCampaignUnmet(campaign: CampaignWithMeta): Promise<CloseResult> {
  const now = new Date().toISOString()
  const { data: claimed } = await db
    .from('launchpad_campaigns')
    .update({ status: 'closed_unmet', closed_at: now, closed_notified_at: now, updated_at: now })
    .eq('id', campaign.id)
    .eq('status', 'active')
    .select('id')
  if (!claimed || claimed.length === 0) return { ok: true, outcome: 'noop' }

  await notifyUnmet(campaign)
  return { ok: true, outcome: 'unmet' }
}

/**
 * Vote-route hook: if the campaign is active and its votes now meet the
 * threshold, close it MET (mint + notify). No-op otherwise. Best-effort — the
 * caller must never fail the voter's own request on a mint hiccup.
 */
export async function closeCampaignIfThresholdMet(campaignId: string): Promise<CloseResult> {
  const campaign = await getCampaignByIdInternal(campaignId)
  if (!campaign) return { ok: false, reason: 'not_found' }
  if (campaign.status !== 'active') return { ok: true, outcome: 'noop' }
  if (!thresholdReached(campaign.vote_count, campaign.vote_threshold)) return { ok: true, outcome: 'noop' }
  return closeCampaignMet(campaign)
}

// ── Cron ─────────────────────────────────────────────────────────────────────

/**
 * Daily sweep: close every active campaign whose end date has passed — MET (mint)
 * if it reached the threshold, UNMET (honest) otherwise. Also mints any campaign
 * that reached the threshold before its end date but whose vote-route mint didn't
 * land (belt-and-suspenders). Replay-safe via the same claims.
 */
export async function runCampaignCloseCron(): Promise<{ scanned: number; met: number; unmet: number; errors: number }> {
  const nowIso = new Date().toISOString()
  // Ended campaigns still active → must close one way or the other.
  const { data: ended } = await db
    .from('launchpad_campaigns')
    .select('id')
    .eq('status', 'active')
    .lte('ends_at', nowIso)

  // Not-yet-ended but already-over-threshold (a missed vote-route mint).
  const { data: active } = await db
    .from('launchpad_campaigns')
    .select('id')
    .eq('status', 'active')
    .gt('ends_at', nowIso)

  const ids = new Set<string>([
    ...((ended ?? []).map((r) => (r as { id: string }).id)),
    ...((active ?? []).map((r) => (r as { id: string }).id)),
  ])

  let met = 0, unmet = 0, errors = 0
  for (const id of ids) {
    const campaign = await getCampaignByIdInternal(id)
    if (!campaign) continue
    const decision = decideCampaignClose({
      status: campaign.status,
      voteCount: campaign.vote_count,
      threshold: campaign.vote_threshold,
      endsAt: campaign.ends_at,
    })
    if (decision === 'skip' || decision === 'noop') continue

    const result = decision === 'mint' ? await closeCampaignMet(campaign) : await closeCampaignUnmet(campaign)
    if (!result.ok) { errors++; continue }
    if (result.outcome === 'met') met++
    else if (result.outcome === 'unmet') unmet++
  }
  return { scanned: ids.size, met, unmet, errors }
}
