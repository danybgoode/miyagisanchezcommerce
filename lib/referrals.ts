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

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars
const CODE_LEN = 6

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
