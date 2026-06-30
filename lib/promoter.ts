/**
 * Promoter Program — shared server helpers (Supabase side).
 *
 * A commission-paid, in-person seller-acquisition force. A promoter has a stable
 * code (PRM-XXXXXX); applying it at a paid-SKU checkout previews a seller discount
 * (Sprint 1) and records an attribution row so Sprint 3 can compute commission.
 *
 * Mirrors the referral spine (lib/referrals.ts) in a DISTINCT promoter namespace —
 * the `PRM-` prefix + a separate table — so promoter codes never collide with the
 * bare buyer referral codes. Promoter attribution is a concept Medusa has no notion
 * of → Supabase (AGENTS rule #2). The money path (real charge + cadence) is Sprint 2.
 *
 * Pure + next-free (no `next/cache`, no `server-only`) so the code-gen and discount
 * rules are directly unit-testable (e2e/promoter-program.spec.ts); the Supabase
 * calls live here too, exactly like lib/referrals.ts.
 *
 * Tables (supabase/migrations/20260629120000_promoter.sql):
 *   marketplace_promoters · marketplace_promoter_attributions · marketplace_promoter_settings
 *
 * Every function tolerates the tables not existing yet (returns a safe default),
 * so the UI degrades gracefully until the migration is applied. The whole feature
 * is gated by the Flagsmith flag `promoter.enabled` (lib/flags.ts, default off).
 */

import { db } from '@/lib/supabase'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no ambiguous chars (shared with referrals)
const CODE_LEN = 6

/** Distinct prefix so a promoter code is never mistaken for a buyer referral code. */
export const PROMOTER_CODE_PREFIX = 'PRM-'

/** Shape of a well-formed promoter code: PRM- + 4–12 unambiguous chars. */
export const PROMOTER_CODE_RE = /^PRM-[A-Z0-9]{4,12}$/

export interface Promoter {
  id: string
  code: string
  name: string | null
  created_at?: string
}

function randomCode(len = CODE_LEN): string {
  let out = ''
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  return out
}

/** A fresh, prefixed promoter code (PRM-XXXXXX). */
export function generatePromoterCode(): string {
  return PROMOTER_CODE_PREFIX + randomCode()
}

/** Normalize user-entered codes: trim, upper-case. Does not validate shape. */
export function normalizePromoterCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase()
}

/** Is this a well-formed promoter code (after normalization)? */
export function isPromoterCodeShape(raw: string | null | undefined): boolean {
  return PROMOTER_CODE_RE.test(normalizePromoterCode(raw))
}

// ── Promoter provisioning (admin) ─────────────────────────────────────────────

/**
 * Create a promoter with a stable, unique code. Retries on the (rare) unique
 * collision. Returns the new promoter, or null if the tables aren't available.
 */
export async function createPromoter(name: string | null): Promise<Promoter | null> {
  const cleanName = (name ?? '').trim() || null
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generatePromoterCode()
    const { data, error } = await db
      .from('marketplace_promoters')
      .insert({ code, name: cleanName })
      .select('id, code, name, created_at')
      .maybeSingle()
    if (!error && data) return data as Promoter
    if (error?.code === '23505') continue // code collided — try another
    if (error && !/does not exist|relation/i.test(error.message ?? '')) {
      console.error('[promoter] create failed:', error.message)
    }
    return null
  }
  return null
}

/** Look up a promoter by code. Null if not found / tables missing. */
export async function getPromoterByCode(code: string): Promise<Promoter | null> {
  const normalized = normalizePromoterCode(code)
  if (!normalized) return null
  const { data, error } = await db
    .from('marketplace_promoters')
    .select('id, code, name, created_at')
    .eq('code', normalized)
    .maybeSingle()
  if (error || !data) return null
  return data as Promoter
}

/** All promoters, newest first (admin console). Empty on missing tables/error. */
export async function listPromoters(): Promise<Promoter[]> {
  const { data, error } = await db
    .from('marketplace_promoters')
    .select('id, code, name, created_at')
    .order('created_at', { ascending: false })
  if (error || !data) return []
  return data as Promoter[]
}

// ── Discount settings (admin-editable, no deploy) ─────────────────────────────

export interface PromoterSettings {
  /** Admin toggle for the seller discount (distinct from the `promoter.enabled` flag). */
  enabled: boolean
  discount_type: 'fixed' | 'percentage'
  /** Pesos×100 when `fixed`; the raw percent when `percentage` (same column). */
  discount_amount_cents: number
}

const DEFAULT_SETTINGS: PromoterSettings = {
  enabled: true,
  discount_type: 'fixed',
  discount_amount_cents: 10000, // $100 MXN off the SKU
}

export async function getPromoterSettings(): Promise<PromoterSettings> {
  const { data, error } = await db
    .from('marketplace_promoter_settings')
    .select('enabled, discount_type, discount_amount_cents')
    .eq('id', 1)
    .maybeSingle()
  if (error || !data) return DEFAULT_SETTINGS
  return {
    enabled: data.enabled ?? true,
    discount_type: (data.discount_type as 'fixed' | 'percentage') ?? 'fixed',
    discount_amount_cents: data.discount_amount_cents ?? DEFAULT_SETTINGS.discount_amount_cents,
  }
}

export async function updatePromoterSettings(patch: Partial<PromoterSettings>): Promise<PromoterSettings> {
  const next = { ...(await getPromoterSettings()), ...patch }
  await db
    .from('marketplace_promoter_settings')
    .update({ ...next, updated_at: new Date().toISOString() })
    .eq('id', 1)
  return next
}
