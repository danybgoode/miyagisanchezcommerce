/**
 * Referral Program — shared server helpers (storefront/Supabase + Clerk side).
 *
 * Reward economics: a referral reward is a coupon scoped to the platform's own
 * `miyagiprints` shop (print-ad placements), minted via the backend
 * /internal/platform-coupons route. That's the only funding-safe surface in a
 * no-commission marketplace (see the referral-program epic).
 *
 * Tables (supabase/migrations/20260603100000_referrals.sql):
 *   marketplace_referral_codes · marketplace_referrals · marketplace_referral_settings
 *
 * Every function tolerates the tables not existing yet (returns a safe default),
 * so the UI degrades gracefully until the migration is applied.
 */

import { db } from '@/lib/supabase'
import { getSellerEmail, sendReferralReward } from '@/lib/email'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars
const CODE_LEN = 6

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export interface ReferralCredit {
  code: string
  amount_cents: number | null
  status: string
}

export interface ReferralStats {
  invited: number
  qualified: number
  rewarded: number
  credits: ReferralCredit[]
}

function randomCode(len = CODE_LEN): string {
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return out
}

/**
 * Returns the user's stable referral code, creating it on first call. Returns
 * null if the referral tables aren't available yet.
 */
export async function getOrCreateReferralCode(clerkUserId: string): Promise<string | null> {
  if (!clerkUserId) return null

  const { data: existing, error: selErr } = await db
    .from('marketplace_referral_codes')
    .select('code')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle()
  if (selErr) {
    // Missing table or transient error — degrade gracefully.
    if (!/does not exist|relation/i.test(selErr.message ?? '')) {
      console.error('[referrals] code lookup failed:', selErr.message)
    }
    return null
  }
  if (existing?.code) return existing.code

  // Generate a unique code, retrying on the (rare) unique collision.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode()
    const { error: insErr } = await db
      .from('marketplace_referral_codes')
      .insert({ clerk_user_id: clerkUserId, code })
    if (!insErr) return code
    // 23505 = unique_violation. Could be the code OR a race on clerk_user_id.
    if (insErr.code === '23505') {
      const { data: row } = await db
        .from('marketplace_referral_codes')
        .select('code')
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle()
      if (row?.code) return row.code
      continue // code collided — try another
    }
    console.error('[referrals] code insert failed:', insErr.message)
    return null
  }
  return null
}

/** Look up the owner of a referral code (the referrer). Null if not found. */
export async function getReferrerByCode(code: string): Promise<string | null> {
  const normalized = (code ?? '').trim().toUpperCase()
  if (!normalized) return null
  const { data, error } = await db
    .from('marketplace_referral_codes')
    .select('clerk_user_id')
    .eq('code', normalized)
    .maybeSingle()
  if (error || !data) return null
  return data.clerk_user_id
}

export type AttributeResult = 'recorded' | 'skipped'

/**
 * Record that `referredClerkId` was referred by the owner of `code`.
 * Returns 'recorded' on a fresh attribution, 'skipped' for self-referral,
 * unknown code, already-referred, or any error. Idempotent — the unique
 * constraint on referred_clerk_user_id prevents double-credit.
 */
export async function attributeReferral(
  code: string,
  referredClerkId: string,
  referredEmail: string | null,
): Promise<AttributeResult> {
  if (!code || !referredClerkId) return 'skipped'

  const referrer = await getReferrerByCode(code)
  if (!referrer || referrer === referredClerkId) return 'skipped'

  // Don't overwrite an existing attribution for this user.
  const { data: already } = await db
    .from('marketplace_referrals')
    .select('id')
    .eq('referred_clerk_user_id', referredClerkId)
    .maybeSingle()
  if (already) return 'skipped'

  const { error } = await db.from('marketplace_referrals').insert({
    referrer_clerk_user_id: referrer,
    referred_clerk_user_id: referredClerkId,
    referred_email: referredEmail,
    status: 'signed_up',
  })
  if (error) {
    if (error.code !== '23505') console.error('[referrals] attribute insert failed:', error.message)
    return 'skipped'
  }
  return 'recorded'
}

/** Aggregate stats for the referrer's "Mis referidos" page. */
export async function getReferralStats(clerkUserId: string): Promise<ReferralStats> {
  const empty: ReferralStats = { invited: 0, qualified: 0, rewarded: 0, credits: [] }
  if (!clerkUserId) return empty

  const { data, error } = await db
    .from('marketplace_referrals')
    .select('status, reward_coupon_code, reward_amount_cents')
    .eq('referrer_clerk_user_id', clerkUserId)
  if (error || !data) return empty

  const stats: ReferralStats = { invited: data.length, qualified: 0, rewarded: 0, credits: [] }
  for (const r of data) {
    if (r.status === 'qualified') stats.qualified++
    if (r.status === 'rewarded') {
      stats.rewarded++
      if (r.reward_coupon_code) {
        stats.credits.push({ code: r.reward_coupon_code, amount_cents: r.reward_amount_cents ?? null, status: r.status })
      }
    }
  }
  return stats
}

// ── Reward settings (admin-editable, no deploy) ───────────────────────────────

export interface ReferralSettings {
  enabled: boolean
  reward_type: 'fixed' | 'percentage'
  reward_amount_cents: number
  reward_expiry_days: number
}

const DEFAULT_SETTINGS: ReferralSettings = {
  enabled: true,
  reward_type: 'fixed',
  reward_amount_cents: 10000,
  reward_expiry_days: 90,
}

export async function getReferralSettings(): Promise<ReferralSettings> {
  const { data, error } = await db
    .from('marketplace_referral_settings')
    .select('enabled, reward_type, reward_amount_cents, reward_expiry_days')
    .eq('id', 1)
    .maybeSingle()
  if (error || !data) return DEFAULT_SETTINGS
  return {
    enabled: data.enabled ?? true,
    reward_type: (data.reward_type as 'fixed' | 'percentage') ?? 'fixed',
    reward_amount_cents: data.reward_amount_cents ?? DEFAULT_SETTINGS.reward_amount_cents,
    reward_expiry_days: data.reward_expiry_days ?? DEFAULT_SETTINGS.reward_expiry_days,
  }
}

export async function updateReferralSettings(patch: Partial<ReferralSettings>): Promise<ReferralSettings> {
  const next = { ...(await getReferralSettings()), ...patch }
  await db
    .from('marketplace_referral_settings')
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq('id', 1)
  return next
}

// ── Reward issuance ───────────────────────────────────────────────────────────

/** Mints a platform (miyagiprints) coupon via the backend. Returns true on success. */
async function mintPlatformCoupon(code: string, amountCents: number, expiryDays: number): Promise<boolean> {
  try {
    const expiry = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString()
    const res = await fetch(`${MEDUSA_BASE}/internal/platform-coupons`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({
        code,
        type: 'fixed',
        value: amountCents / 100, // coupon `value` for 'fixed' is MXN major units
        usage_limit: 1,
        expiry,
        created_by: 'referral',
      }),
    })
    return res.ok
  } catch (e) {
    console.error('[referrals] mintPlatformCoupon failed:', e)
    return false
  }
}

/**
 * On a buyer's first completed order, reward whoever referred them.
 * Best-effort and idempotent: atomically claims a `signed_up` referral
 * (→ `qualified`), mints a one-use print-ad credit for the referrer, then marks
 * it `rewarded`. Safe to call from both payment webhooks.
 */
export async function maybeRewardReferralOnOrder(opts: {
  buyerClerkUserId?: string | null
  buyerEmail?: string | null
}): Promise<void> {
  const { buyerClerkUserId, buyerEmail } = opts
  if (!buyerClerkUserId && !buyerEmail) return

  // Atomically claim a pending referral for this buyer (clerk id preferred, else email).
  const claim = db
    .from('marketplace_referrals')
    .update({ status: 'qualified', qualified_at: new Date().toISOString() })
    .eq('status', 'signed_up')
  const { data: referral } = buyerClerkUserId
    ? await claim.eq('referred_clerk_user_id', buyerClerkUserId).select('id, referrer_clerk_user_id').maybeSingle()
    : await claim.eq('referred_email', buyerEmail!).select('id, referrer_clerk_user_id').maybeSingle()
  if (!referral) return // no pending referral, or another call already claimed it

  const settings = await getReferralSettings()
  if (!settings.enabled || settings.reward_amount_cents <= 0) return // left as 'qualified'

  const code = `GANA${randomCode(5)}`
  const minted = await mintPlatformCoupon(code, settings.reward_amount_cents, settings.reward_expiry_days)
  if (!minted) {
    console.error('[referrals] reward mint failed; referral left qualified:', referral.id)
    return
  }

  await db
    .from('marketplace_referrals')
    .update({
      status: 'rewarded',
      reward_coupon_code: code,
      reward_amount_cents: settings.reward_amount_cents,
      rewarded_at: new Date().toISOString(),
    })
    .eq('id', referral.id)

  // Notify the referrer (best-effort — the credit also shows in "Mis referidos").
  try {
    const email = await getSellerEmail(referral.referrer_clerk_user_id)
    if (email) {
      const label = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 })
        .format(settings.reward_amount_cents / 100)
      await sendReferralReward(email, code, label)
    }
  } catch (e) {
    console.error('[referrals] reward notification failed:', e)
  }
}
