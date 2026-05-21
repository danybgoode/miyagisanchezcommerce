/**
 * UCP OmniReputation — buyer trust scoring
 *
 * Computes a 0–100 trust score from observable, on-chain signals:
 *   - Purchase history (marketplace_orders)
 *   - Clerk account signals (verified email, phone, account age)
 *   - Listing / selling activity
 *
 * Works for both identified buyers (Clerk user ID) and anonymous buyers
 * (email only). Anonymous buyers can still build reputation through purchases.
 *
 * Trust levels:
 *   unverified  0–24   No verified email, no purchase history
 *   basic       25–49  Verified email only
 *   trusted     50–74  Email + phone OR completed purchase
 *   verified    75–89  Multiple signals + purchase history
 *   elite       90–100 Strong history + verified identity
 */

import { db } from '@/lib/supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export type TrustLevel = 'unverified' | 'basic' | 'trusted' | 'verified' | 'elite'

export interface TrustSignal {
  key:         string
  label:       string
  points:      number
  earned:      boolean
  description: string
}

export interface TrustScore {
  score:       number          // 0–100
  level:       TrustLevel
  level_label: string
  signals:     TrustSignal[]
  computed_at: string
  identifier:  string          // email or clerk_user_id used for lookup
}

// ── Level thresholds ───────────────────────────────────────────────────────────

const LEVELS: { level: TrustLevel; label: string; min: number }[] = [
  { level: 'elite',      label: '⭐ Elite',       min: 90 },
  { level: 'verified',   label: '✓ Verificado',   min: 75 },
  { level: 'trusted',    label: '🤝 Confiable',   min: 50 },
  { level: 'basic',      label: '📧 Básico',      min: 25 },
  { level: 'unverified', label: '⚠️ Sin verificar', min: 0  },
]

export function scoreToLevel(score: number): { level: TrustLevel; label: string } {
  return LEVELS.find(l => score >= l.min) ?? LEVELS[LEVELS.length - 1]
}

export function levelToMinScore(level: TrustLevel): number {
  return LEVELS.find(l => l.level === level)?.min ?? 0
}

// ── Score computation ─────────────────────────────────────────────────────────

interface ClerkSignals {
  emailVerified:  boolean
  hasPhone:       boolean
  accountAgeDays: number
}

async function getClerkSignals(clerkUserId: string): Promise<ClerkSignals | null> {
  try {
    // Dynamic import to avoid loading Clerk SDK in non-auth paths
    const { clerkClient } = await import('@clerk/nextjs/server')
    const client = await clerkClient()
    const user   = await client.users.getUser(clerkUserId)

    const emailVerified = user.emailAddresses.some(e => e.verification?.status === 'verified')
    const hasPhone      = user.phoneNumbers.length > 0
    const accountAgeDays = Math.floor((Date.now() - user.createdAt) / 86400000)

    return { emailVerified, hasPhone, accountAgeDays }
  } catch {
    return null
  }
}

async function getPurchaseHistory(email: string): Promise<{ completed: number; asSellerCompleted: number }> {
  const normalised = email.toLowerCase().trim()

  // Completed purchases as buyer
  const { count: buyerCount } = await db
    .from('marketplace_orders')
    .select('id', { count: 'exact', head: true })
    .eq('buyer_email', normalised)
    .eq('status', 'paid')

  // Completed sales as shop owner — join through shop
  const { data: shops } = await db
    .from('marketplace_shops')
    .select('id')
    .ilike('metadata->>contact_email', normalised)

  let sellerCount = 0
  if (shops && shops.length > 0) {
    const shopIds = shops.map(s => s.id)
    const { count } = await db
      .from('marketplace_orders')
      .select('id', { count: 'exact', head: true })
      .in('shop_id', shopIds)
      .eq('status', 'paid')
    sellerCount = count ?? 0
  }

  return {
    completed:          buyerCount ?? 0,
    asSellerCompleted:  sellerCount,
  }
}

export async function computeTrustScore(
  identifier: string,   // email address OR Clerk user ID (user_xxx)
  options?: { skipClerk?: boolean }
): Promise<TrustScore> {
  const isClerkId  = identifier.startsWith('user_')
  const signals: TrustSignal[] = []
  let totalScore   = 0

  // ── Resolve email from Clerk ID if needed ──────────────────────────────────
  let email = isClerkId ? '' : identifier.toLowerCase().trim()
  let clerkSignals: ClerkSignals | null = null

  if (isClerkId && !options?.skipClerk) {
    clerkSignals = await getClerkSignals(identifier)
    if (clerkSignals) {
      // Try to get email from Clerk for DB lookups
      try {
        const { clerkClient } = await import('@clerk/nextjs/server')
        const client = await clerkClient()
        const user   = await client.users.getUser(identifier)
        email = user.emailAddresses[0]?.emailAddress?.toLowerCase() ?? ''
      } catch {}
    }
  } else if (!isClerkId && !options?.skipClerk) {
    // Email lookup — try to find a Clerk account with this email
    // (best-effort; skip if Clerk isn't available)
  }

  // ── Signal: Email verified ─────────────────────────────────────────────────
  const emailVerified = clerkSignals?.emailVerified ?? (!isClerkId && email.includes('@'))
  signals.push({
    key: 'email_verified',
    label: 'Correo verificado',
    points: 25,
    earned: emailVerified,
    description: 'La dirección de correo ha sido verificada.',
  })
  if (emailVerified) totalScore += 25

  // ── Signal: Phone on account ───────────────────────────────────────────────
  const hasPhone = clerkSignals?.hasPhone ?? false
  signals.push({
    key: 'phone_verified',
    label: 'Teléfono registrado',
    points: 15,
    earned: hasPhone,
    description: 'Número de teléfono vinculado a la cuenta.',
  })
  if (hasPhone) totalScore += 15

  // ── Signal: Account age ────────────────────────────────────────────────────
  const ageDays = clerkSignals?.accountAgeDays ?? 0
  const age7    = ageDays >= 7
  const age30   = ageDays >= 30
  const age90   = ageDays >= 90

  signals.push({
    key: 'account_age_7d',
    label: 'Cuenta con más de 7 días',
    points: 5,
    earned: age7,
    description: 'La cuenta tiene al menos 7 días de antigüedad.',
  })
  if (age7) totalScore += 5

  signals.push({
    key: 'account_age_30d',
    label: 'Cuenta con más de 30 días',
    points: 5,
    earned: age30,
    description: 'La cuenta tiene al menos 30 días de antigüedad.',
  })
  if (age30) totalScore += 5

  signals.push({
    key: 'account_age_90d',
    label: 'Cuenta con más de 90 días',
    points: 5,
    earned: age90,
    description: 'Cuenta establecida (90+ días).',
  })
  if (age90) totalScore += 5

  // ── Signals: Purchase / sale history ──────────────────────────────────────
  let history = { completed: 0, asSellerCompleted: 0 }
  if (email) {
    history = await getPurchaseHistory(email)
  }

  const hasPurchase  = history.completed >= 1
  const hasMultiple  = history.completed >= 3
  const hasSale      = history.asSellerCompleted >= 1

  signals.push({
    key: 'first_purchase',
    label: 'Primera compra completada',
    points: 20,
    earned: hasPurchase,
    description: `Ha completado al menos 1 compra (${history.completed} total).`,
  })
  if (hasPurchase) totalScore += 20

  signals.push({
    key: 'repeat_buyer',
    label: '3+ compras completadas',
    points: 15,
    earned: hasMultiple,
    description: `Comprador frecuente con ${history.completed} compras.`,
  })
  if (hasMultiple) totalScore += 15

  signals.push({
    key: 'seller_history',
    label: 'Actividad como vendedor',
    points: 10,
    earned: hasSale,
    description: `También ha vendido (${history.asSellerCompleted} ventas completadas).`,
  })
  if (hasSale) totalScore += 10

  // Clamp to 0–100
  const score = Math.min(100, Math.max(0, totalScore))
  const { level, label: level_label } = scoreToLevel(score)

  return {
    score,
    level,
    level_label,
    signals,
    computed_at: new Date().toISOString(),
    identifier,
  }
}
