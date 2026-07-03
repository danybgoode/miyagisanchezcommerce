/**
 * Server-side helpers for the Print Edition API routes.
 *
 * Commerce data (the seller, the placement product) is read from Medusa; the
 * editorial layer (providers/editions/submissions) is read from Supabase.
 */

import { db } from '@/lib/supabase'
import { sendPrintAdReceivedToBuyer, sendPrintAdReceivedToMiyagi, sendPrintAdApproved, sendPrintAdRejected } from '@/lib/email'
import { markAttributionPaid } from '@/lib/promoter'
import { tg } from '@/lib/telegram'
import { decideNextEditionForClone, shouldAttemptClone, buildClone2x1Content } from '@/lib/promoter-print-2x1'
import {
  PRINT_OCCUPYING_STATUSES,
  type PrintEdition,
  type PrintEditionPublic,
  type PrintTier,
  type PrintAdSubmission,
} from '@/lib/print'

export type { PrintTier } from '@/lib/print'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const PUB_KEY = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export function medusaFetch(path: string, clerkJwt?: string, options?: RequestInit) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-publishable-api-key': PUB_KEY,
      ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
      ...(options?.headers ?? {}),
    },
  })
}

export interface SellerLite {
  id: string
  slug: string
  name: string
  description: string | null
  location: string | null
  logo_url: string | null
  metadata: Record<string, unknown> | null
}

/** Resolve the seller profile for the authenticated Clerk user (or null). */
export async function getSellerByClerk(clerkJwt: string): Promise<SellerLite | null> {
  try {
    const res = await medusaFetch('/store/sellers/me', clerkJwt)
    if (!res.ok) return null
    const { seller } = await res.json()
    return seller ?? null
  } catch {
    return null
  }
}

let _miyagiprintsSellerId: string | null = null
/** The miyagiprints shop is the constant selling seller for every placement. Cached. */
export async function getMiyagiprintsSellerId(): Promise<string | null> {
  if (_miyagiprintsSellerId) return _miyagiprintsSellerId
  try {
    const res = await medusaFetch('/store/sellers/miyagiprints')
    if (!res.ok) return null
    const { seller } = await res.json()
    _miyagiprintsSellerId = seller?.id ?? null
    return _miyagiprintsSellerId
  } catch {
    return null
  }
}

/**
 * Count occupying submissions (pending_payment/paid/approved/placed) per tier for
 * an edition. Returns a map of tier_key → count.
 */
export async function tierOccupancy(editionId: string): Promise<Record<string, number>> {
  const { data } = await db
    .from('print_ad_submissions')
    .select('tier_key, status')
    .eq('edition_id', editionId)
    .in('status', PRINT_OCCUPYING_STATUSES)

  const counts: Record<string, number> = {}
  for (const row of (data ?? []) as Array<{ tier_key: string }>) {
    counts[row.tier_key] = (counts[row.tier_key] ?? 0) + 1
  }
  return counts
}

/** Remaining slots for a single tier, given current occupancy. */
export function remainingForTier(tier: PrintTier, counts: Record<string, number>): number {
  return Math.max(0, (tier.capacity ?? 0) - (counts[tier.key] ?? 0))
}

/** Shape an edition for the seller portal with live remaining capacity per tier. */
export function toEditionPublic(
  edition: PrintEdition & { print_providers?: { name?: string } | null },
  counts: Record<string, number>,
): PrintEditionPublic {
  return {
    id: edition.id,
    title: edition.title,
    status: edition.status,
    submission_deadline: edition.submission_deadline,
    distribution_date: edition.distribution_date,
    coverage_zones: edition.coverage_zones ?? [],
    provider_name: edition.print_providers?.name ?? '',
    tiers: (edition.tiers ?? []).map((t) => {
      const remaining = remainingForTier(t, counts)
      return { ...t, remaining, sold_out: remaining <= 0 }
    }),
  }
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com'

/**
 * Called from the Stripe + MercadoPago webhooks after a cart completes. If the
 * cart belongs to a print-ad placement, marks the submission paid, fires the
 * print-specific emails, and returns true so the caller SKIPS the generic
 * product/coordinated emails. Returns false for ordinary product orders.
 */
export async function handlePrintAdPaid(input: {
  cartId: string
  medusaOrderId: string | null
  amountCents: number
  currency: string
  buyerEmail: string | null
  buyerName: string | null
}): Promise<boolean> {
  const { cartId, medusaOrderId, amountCents, currency, buyerEmail, buyerName } = input
  if (!cartId) return false

  const { data: submission } = await db
    .from('print_ad_submissions')
    .select('*')
    .eq('cart_id', cartId)
    .maybeSingle()
  if (!submission) return false

  // Idempotent: only flip pending_payment → paid (webhooks can fire twice).
  if (submission.status === 'pending_payment' || submission.status === 'draft') {
    await db
      .from('print_ad_submissions')
      .update({ status: 'paid', medusa_order_id: medusaOrderId ?? submission.medusa_order_id ?? null })
      .eq('id', submission.id)
  }

  // Promoter Program (epic 08 · S2): if this ad was sold through a promoter, flip
  // the attribution to `paid` with the real amount + one-time cadence. Idempotent
  // (markAttributionPaid re-writes the same deterministic values on a webhook retry).
  const content = (submission.content ?? {}) as Record<string, unknown>
  const promoterId = typeof content.promoter_id === 'string' ? content.promoter_id : null
  const promoterSellerId = typeof content.promoter_seller_id === 'string' ? content.promoter_seller_id : null
  if (promoterId && promoterSellerId) {
    await markAttributionPaid({
      promoterId,
      sellerId: promoterSellerId,
      sku: 'print_ad',
      grossAmountCents: amountCents,
      cadence: 'one_time',
    })
  }

  // Sprint 3 (US-3.3) — a 2x1 sale clones into the next edition once paid.
  await maybeClone2x1Submission(submission as PrintAdSubmission)

  await sendPrintAdPaidEmails(submission, { amountCents, currency, buyerEmail, buyerName })
  return true
}

/**
 * Promoter Funnel v2 · Sprint 3 (US-3.3) — attempt the 2x1 clone once a
 * `content.is_2x1` submission is paid. Idempotent (`shouldAttemptClone` refuses a
 * submission already cloned/flagged — a webhook retry or a second manual confirm
 * never double-clones). Called from BOTH the card webhook (`handlePrintAdPaid`)
 * and the admin manual-payment-confirm route, so a 2x1 sale clones regardless of
 * how it was paid.
 *
 * No eligible next edition (not created yet, or its deadline already passed) ⇒
 * stamps `is_2x1_needs_manual_clone` + alerts — the admin-manual "clonar a la
 * siguiente edición" fallback (v1, per the sprint-3.md build note) picks it up
 * from there (`POST /api/admin/print/submissions/[id]/clone-2x1`).
 */
export async function maybeClone2x1Submission(submission: PrintAdSubmission): Promise<void> {
  const content = submission.content ?? {}
  if (!shouldAttemptClone(content)) return

  const { data: current } = await db
    .from('print_editions')
    .select('*')
    .eq('id', submission.edition_id)
    .maybeSingle() as { data: PrintEdition | null }
  if (!current) return

  const { data: editions } = await db
    .from('print_editions')
    .select('id, provider_id, status, submission_deadline, distribution_date, created_at, tiers')
    .eq('provider_id', current.provider_id)
  const decision = decideNextEditionForClone({
    currentEdition: current,
    editions: (editions ?? []) as Parameters<typeof decideNextEditionForClone>[0]['editions'],
    requiredTierKey: submission.tier_key,
  })

  if (!decision.ok) {
    await db
      .from('print_ad_submissions')
      .update({ content: { ...content, is_2x1_needs_manual_clone: true } })
      .eq('id', submission.id)
    tg.alert(
      `⚠️ Anuncio 2x1 pagado sin edición siguiente disponible (${decision.reason}) — clonar a mano.\n` +
      `Submission: ${submission.id}\nEdición actual: ${current.id}`,
    )
    return
  }

  const result = await cloneSubmissionInto2x1Edition(submission, decision.editionId)
  if (!result.ok) {
    await db
      .from('print_ad_submissions')
      .update({ content: { ...content, is_2x1_needs_manual_clone: true } })
      .eq('id', submission.id)
    tg.alert(`⚠️ Anuncio 2x1 pagado — el clon automático falló, clonar a mano.\nSubmission: ${submission.id}`)
    return
  }

  tg.alert(`✅ Anuncio 2x1: clon comped creado en la siguiente edición\nOriginal: ${submission.id}\nClon: ${result.cloneId}`)
}

export type Clone2x1Result = { ok: true; cloneId: string } | { ok: false; error: string }

/**
 * Insert the comped clone into `targetEditionId` + stamp the original as cloned.
 * Shared by the automatic path above and the admin-manual "clonar a la siguiente
 * edición" fallback (`POST /api/admin/print/submissions/[id]/clone-2x1`) — same
 * write, two callers. Does NOT re-check `shouldAttemptClone` (the caller decides
 * whether to call this); does validate the target edition is real, from the SAME
 * provider as the original, still accepting content (draft/open — not
 * closed/in_production/distributed), and has the required tier (caught in
 * cross-agent review of PR #165 — the admin-manual fallback previously accepted
 * ANY edition id, including a different provider's or an already-closed one).
 *
 * Race-safety: a partial UNIQUE index on `content->>'is_2x1_clone_of'`
 * (`print_ad_submissions_2x1_clone_of_uniq`, 20260703130000) means two concurrent
 * callers for the SAME original (e.g. a Stripe webhook retry racing itself) can't
 * both succeed — the second insert hits 23505, swallowed here as "already cloned"
 * (also caught in cross-agent review).
 */
export async function cloneSubmissionInto2x1Edition(
  submission: PrintAdSubmission,
  targetEditionId: string,
): Promise<Clone2x1Result> {
  const content = submission.content ?? {}

  const { data: original } = await db
    .from('print_editions')
    .select('provider_id')
    .eq('id', submission.edition_id)
    .maybeSingle() as { data: Pick<PrintEdition, 'provider_id'> | null }

  const { data: targetEdition } = await db
    .from('print_editions')
    .select('id, provider_id, status, tiers')
    .eq('id', targetEditionId)
    .maybeSingle() as { data: Pick<PrintEdition, 'id' | 'provider_id' | 'status' | 'tiers'> | null }
  if (!targetEdition) return { ok: false, error: 'Edición de destino no encontrada.' }
  if (!original || targetEdition.provider_id !== original.provider_id) {
    return { ok: false, error: 'La edición de destino debe ser del mismo proveedor.' }
  }
  if (targetEdition.status !== 'draft' && targetEdition.status !== 'open') {
    return { ok: false, error: 'La edición de destino ya no acepta anuncios.' }
  }
  const targetTier = targetEdition.tiers.find((t) => t.key === submission.tier_key)
  if (!targetTier?.medusa_product_id) {
    return { ok: false, error: 'La edición de destino no tiene ese tamaño disponible.' }
  }

  const { data: clone, error } = await db
    .from('print_ad_submissions')
    .insert({
      edition_id: targetEditionId,
      tier_key: submission.tier_key,
      seller_id: submission.seller_id,
      buyer_clerk_user_id: submission.buyer_clerk_user_id,
      buyer_email: submission.buyer_email,
      medusa_product_id: targetTier.medusa_product_id,
      status: 'paid', // re-enters the editorial queue exactly like a real paid ad
      content: buildClone2x1Content(content, submission.id),
    })
    .select('id')
    .maybeSingle()
  if (error?.code === '23505') {
    // A concurrent call already cloned this exact original — not a failure.
    return { ok: true, cloneId: 'already-cloned' }
  }
  if (error || !clone) {
    console.error('[promoter 2x1] clone insert failed:', error?.message ?? 'no row')
    return { ok: false, error: 'No se pudo crear el clon.' }
  }

  await db
    .from('print_ad_submissions')
    .update({ content: { ...content, is_2x1_cloned: true, is_2x1_clone_id: clone.id, is_2x1_needs_manual_clone: false } })
    .eq('id', submission.id)
  return { ok: true, cloneId: clone.id }
}

/**
 * Send the buyer + Miyagi "ad paid" emails for a submission. Loads edition/provider/
 * tier for context. Reused by the payment webhooks (card) and the admin console
 * (manual/SPEI reconciliation). Best-effort — never throws into the caller.
 */
export async function sendPrintAdPaidEmails(
  submission: PrintAdSubmission,
  opts: { amountCents?: number; currency?: string; buyerEmail?: string | null; buyerName?: string | null },
): Promise<void> {
  const { data: edition } = await db
    .from('print_editions')
    .select('*, print_providers(name)')
    .eq('id', submission.edition_id)
    .single() as { data: (PrintEdition & { print_providers?: { name?: string } | null }) | null }

  const tier = (edition?.tiers ?? []).find((t) => t.key === submission.tier_key)
  const tierLabel = tier?.label ?? submission.tier_key
  // Fall back to the tier's list price when the caller doesn't know the amount (manual reconciliation).
  const amountCents = opts.amountCents ?? tier?.price_cents ?? 0
  const amountFmt = new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: opts.currency || 'MXN',
  }).format(amountCents / 100)
  const email = opts.buyerEmail ?? submission.buyer_email ?? null

  if (email) {
    sendPrintAdReceivedToBuyer({
      buyerEmail: email,
      buyerName: opts.buyerName,
      editionTitle: edition?.title ?? 'Edición impresa',
      providerName: edition?.print_providers?.name ?? 'Miyagi Prints',
      tierLabel,
      amountPaid: amountFmt,
      submissionDeadline: edition?.submission_deadline ?? null,
      distributionDate: edition?.distribution_date ?? null,
      manageUrl: `${SITE_URL}/account/print-ads`,
    }).catch((e) => console.error('[print] buyer email failed:', e))
  }

  const adminEmail = process.env.MIYAGI_ADMIN_EMAIL ?? process.env.ADMIN_EMAIL ?? null
  if (adminEmail) {
    const content = (submission.content ?? {}) as { photos?: unknown[]; cta_target?: { url?: string } }
    sendPrintAdReceivedToMiyagi({
      adminEmail,
      editionTitle: edition?.title ?? 'Edición impresa',
      tierLabel,
      sellerName: submission.seller_id,
      buyerEmail: email,
      amountPaid: amountFmt,
      ctaUrl: content.cta_target?.url ?? null,
      photosCount: Array.isArray(content.photos) ? content.photos.length : 0,
      adminUrl: `${SITE_URL}/admin/print`,
    }).catch((e) => console.error('[print] admin email failed:', e))
  }
}

/**
 * Fire the buyer lifecycle email when the editor approves/rejects an ad.
 * Loads edition + tier for context. Best-effort.
 */
export async function sendPrintAdLifecycleEmail(
  submission: PrintAdSubmission,
  kind: 'approved' | 'rejected',
): Promise<void> {
  const email = submission.buyer_email
  if (!email) return
  const { data: edition } = await db
    .from('print_editions').select('*').eq('id', submission.edition_id).single() as { data: PrintEdition | null }
  const tierLabel = (edition?.tiers ?? []).find((t) => t.key === submission.tier_key)?.label ?? submission.tier_key
  const manageUrl = `${SITE_URL}/account/print-ads`
  const editionTitle = edition?.title ?? 'Edición impresa'
  if (kind === 'approved') {
    sendPrintAdApproved({ buyerEmail: email, editionTitle, tierLabel, distributionDate: edition?.distribution_date ?? null, manageUrl })
      .catch((e) => console.error('[print] approved email failed:', e))
  } else {
    sendPrintAdRejected({ buyerEmail: email, editionTitle, tierLabel, reason: submission.admin_notes ?? null, manageUrl })
      .catch((e) => console.error('[print] rejected email failed:', e))
  }
}

/**
 * Create a Medusa placement product for one edition tier via the backend internal
 * route, returning its product id. Requires MEDUSA_INTERNAL_SECRET in the env.
 */
export async function createPlacementProduct(input: {
  title: string
  description?: string | null
  price_cents: number
  currency?: string
  edition_id?: string
  tier_key?: string
}): Promise<string | null> {
  const internalSecret = process.env.MEDUSA_INTERNAL_SECRET
  if (!internalSecret) {
    console.error('[print] MEDUSA_INTERNAL_SECRET not set — cannot create placement product')
    return null
  }
  try {
    const res = await medusaFetch('/internal/print/placement-product', undefined, {
      method: 'POST',
      headers: { 'x-internal-secret': internalSecret },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      console.error('[print] placement-product create failed:', await res.text().catch(() => ''))
      return null
    }
    const { product_id } = await res.json()
    return product_id ?? null
  } catch (e) {
    console.error('[print] placement-product create error:', e)
    return null
  }
}

/**
 * Ensure every tier has a backing Medusa placement product, minting any that are
 * missing. Returns { tiers, failed } — `failed` lists tier keys whose product
 * could not be created (caller decides whether to surface a warning).
 */
export async function ensureTierProducts(
  editionTitle: string,
  editionId: string,
  tiers: PrintTier[],
): Promise<{ tiers: PrintTier[]; failed: string[] }> {
  const failed: string[] = []
  const out: PrintTier[] = []
  for (const tier of tiers) {
    if (tier.medusa_product_id || !tier.price_cents || tier.price_cents <= 0) {
      out.push(tier)
      if (!tier.medusa_product_id && tier.price_cents > 0) failed.push(tier.key)
      continue
    }
    const productId = await createPlacementProduct({
      title: `${editionTitle} — ${tier.label}`.slice(0, 100),
      description: `Anuncio impreso (${tier.label}) en "${editionTitle}".`,
      price_cents: tier.price_cents,
      edition_id: editionId,
      tier_key: tier.key,
    })
    if (productId) out.push({ ...tier, medusa_product_id: productId })
    else { out.push(tier); failed.push(tier.key) }
  }
  return { tiers: out, failed }
}
