/**
 * Bookshop launchpad — server-side spine (bookshop-launchpad S1).
 *
 * Reuses, deliberately, four existing rails rather than rebuilding:
 *  - Email-code verification: the SAME pure crypto helpers as the sweepstakes
 *    spine (`cleanEmail`/`isValidEmail`/`hashSweepstakesEmail`/
 *    `hashVerificationCode`/`safeCompare`/`makeCode`), scoped by shop id instead
 *    of campaign id, persisting to `launchpad_email_verifications` (a mirror of
 *    `marketplace_sweepstakes_email_verifications`).
 *  - Private-bucket upload: `uploadDigitalToR2` (the digital-goods bucket) — the
 *    manuscript is unpublished IP, so it never touches a public bucket; only its
 *    storage key is persisted, served later via a short-lived presigned URL.
 *  - Magic-byte sniff: `sniffManuscript` (container magic + extension).
 *  - State machine: `lib/launchpad-types.ts` (pure).
 *
 * Submissions are non-commerce → Supabase (AGENTS rule #2). The PUBLISHED work
 * becomes a native Medusa digital product in Story 1.3.
 */
import 'server-only'

import { randomUUID } from 'crypto'
import { db } from '@/lib/supabase'
import {
  cleanEmail,
  isValidEmail,
  hashSweepstakesEmail,
  hashVerificationCode,
  safeCompare,
  makeCode,
} from '@/lib/sweepstakes'
import { uploadDigitalToR2, isR2DigitalConfigured, getR2DigitalSignedUrl } from '@/lib/r2'
import { sendLaunchpadVerificationCode, sendLaunchpadStatusEmail, sendLaunchpadPublishedEmail } from '@/lib/email'
import { createSellerProductViaInternal } from '@/lib/seller-products'
import { sniffManuscript } from '@/lib/manuscript-sniff'
import {
  MAX_MANUSCRIPT_SIZE_MB,
  canTransition,
  transitionRequiresNote,
  type LaunchpadSubmission,
  type ManuscriptFormat,
  type SubmissionStatus,
} from '@/lib/launchpad-types'

export { isValidEmail } from '@/lib/sweepstakes'

const CODE_TTL_MS = 15 * 60 * 1000
const SUPABASE_BUCKET = 'digital-files' // fallback when R2 digital not configured

/** The shop, resolved for a public convocatoria surface. */
export interface LaunchpadShop {
  id: string                 // marketplace_shops.id (UUID)
  slug: string
  name: string
  medusaSellerId: string
  acceptsManuscripts: boolean
  guidelines: string | null
}

interface ShopRow {
  id: string
  slug: string
  name: string | null
  metadata: Record<string, unknown> | null
}

function parseShopRow(row: ShopRow): LaunchpadShop {
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  const settings = (meta.settings ?? {}) as Record<string, unknown>
  const lp = (settings.launchpad ?? {}) as Record<string, unknown>
  return {
    id: row.id,
    slug: row.slug,
    name: (row.name ?? row.slug) as string,
    medusaSellerId: typeof meta.medusa_seller_id === 'string' ? meta.medusa_seller_id : '',
    acceptsManuscripts: lp.accepts_manuscripts === true,
    guidelines: typeof lp.guidelines === 'string' && lp.guidelines.trim() ? lp.guidelines : null,
  }
}

/** Resolve a shop by its storefront slug for the public submission portal. */
export async function getLaunchpadShopBySlug(slug: string): Promise<LaunchpadShop | null> {
  const { data, error } = await db
    .from('marketplace_shops')
    .select('id, slug, name, metadata')
    .eq('slug', slug)
    .maybeSingle()
  if (error || !data) return null
  return parseShopRow(data as ShopRow)
}

/** Resolve the authenticated seller's own shop (for the review-queue routes). */
export async function getLaunchpadShopForClerk(clerkUserId: string): Promise<LaunchpadShop | null> {
  const { data, error } = await db
    .from('marketplace_shops')
    .select('id, slug, name, metadata')
    .eq('clerk_user_id', clerkUserId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return parseShopRow(data as ShopRow)
}

// ── Email-code verification (scope = shop id) ────────────────────────────────

export async function sendLaunchpadCode(shop: LaunchpadShop, email: string): Promise<void> {
  const normalized = cleanEmail(email)
  const emailHash = hashSweepstakesEmail(normalized)
  const code = makeCode()
  const codeHash = hashVerificationCode(shop.id, emailHash, code)

  // Persist the code BEFORE emailing — if the insert fails, never email a code
  // that verifyLaunchpadCode could never match (the route surfaces a 500 retry).
  const { error: insertError } = await db.from('launchpad_email_verifications').insert({
    shop_id: shop.id,
    email_hash: emailHash,
    email: normalized,
    code_hash: codeHash,
    locale: 'es',
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (insertError) throw new Error(`launchpad verification insert failed: ${insertError.message}`)

  await sendLaunchpadVerificationCode({ to: normalized, code, shopName: shop.name })
}

/** Verify a code without consuming it — used to gate a submit. Consumes on success. */
export async function verifyLaunchpadCode(shop: LaunchpadShop, email: string, code: string): Promise<boolean> {
  const normalized = cleanEmail(email)
  const emailHash = hashSweepstakesEmail(normalized)
  const { data } = await db
    .from('launchpad_email_verifications')
    .select('id, code_hash, attempts, expires_at, consumed_at')
    .eq('shop_id', shop.id)
    .eq('email_hash', emailHash)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data || data.consumed_at || data.attempts >= 5 || new Date(data.expires_at).getTime() < Date.now()) return false

  const expected = hashVerificationCode(shop.id, emailHash, code)
  const ok = safeCompare(expected, data.code_hash)
  await db
    .from('launchpad_email_verifications')
    .update({
      attempts: (data.attempts ?? 0) + 1,
      ...(ok ? { consumed_at: new Date().toISOString() } : {}),
    })
    .eq('id', data.id)

  return ok
}

// ── Manuscript ingest → private digital bucket ───────────────────────────────

export interface ManuscriptIngestOk {
  ok: true
  key: string
  format: ManuscriptFormat
  name: string
  size: number
}
export interface ManuscriptIngestError {
  ok: false
  status: number
  error: string
}

/**
 * Validates the manuscript bytes (size + real magic-byte sniff) and stores them
 * in the PRIVATE digital bucket under a shop-scoped key. Never trusts the
 * client-declared Content-Type/extension for the format — sniffs the bytes.
 */
export async function ingestManuscript(
  bytes: Uint8Array,
  filename: string,
  shop: LaunchpadShop,
): Promise<ManuscriptIngestOk | ManuscriptIngestError> {
  if (bytes.byteLength === 0) {
    return { ok: false, status: 400, error: 'No se recibió ningún archivo.' }
  }
  if (bytes.byteLength > MAX_MANUSCRIPT_SIZE_MB * 1024 * 1024) {
    return {
      ok: false, status: 400,
      error: `El archivo es demasiado grande (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB). El máximo es ${MAX_MANUSCRIPT_SIZE_MB} MB.`,
    }
  }

  const format = sniffManuscript(bytes, filename)
  if (!format) {
    return {
      ok: false, status: 400,
      error: 'Formato no soportado o el archivo no coincide con su tipo. Usa PDF, EPUB o DOCX.',
    }
  }

  const safeName = (filename.split(/[\\/]/).pop() ?? `manuscrito.${format}`)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80)
  const key = `launchpad/${shop.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}_${safeName}`
  const contentType = format === 'pdf' ? 'application/pdf'
    : format === 'epub' ? 'application/epub+zip'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  if (isR2DigitalConfigured()) {
    try {
      await uploadDigitalToR2(bytes.buffer as ArrayBuffer, key, contentType)
      return { ok: true, key, format, name: safeName, size: bytes.byteLength }
    } catch (e) {
      console.error('[launchpad] R2 digital upload failed, falling back to Supabase:', e)
    }
  }

  // Supabase private-bucket fallback (same ladder as /api/sell/digital-upload).
  await db.storage.createBucket(SUPABASE_BUCKET, { public: false }).catch(() => {})
  const { error: uploadError } = await db.storage
    .from(SUPABASE_BUCKET)
    .upload(key, bytes, { contentType, upsert: false })
  if (uploadError) {
    console.error('[launchpad] Supabase private upload error:', uploadError)
    return { ok: false, status: 500, error: 'Error al subir el archivo. Inténtalo de nuevo.' }
  }
  return { ok: true, key, format, name: safeName, size: bytes.byteLength }
}

// ── Submissions ──────────────────────────────────────────────────────────────

export interface CreateSubmissionInput {
  shop: LaunchpadShop
  title: string
  synopsis?: string | null
  genre?: string | null
  authorName: string
  authorEmail: string
  manuscript: { key: string; format: ManuscriptFormat; name: string; size: number }
}

export async function createSubmission(input: CreateSubmissionInput): Promise<LaunchpadSubmission> {
  const email = cleanEmail(input.authorEmail)
  const { data, error } = await db
    .from('launchpad_submissions')
    .insert({
      shop_id: input.shop.id,
      medusa_seller_id: input.shop.medusaSellerId,
      status: 'submitted',
      title: input.title.trim(),
      synopsis: input.synopsis?.trim() || null,
      genre: input.genre?.trim() || null,
      author_name: input.authorName.trim(),
      author_email: email,
      author_email_hash: hashSweepstakesEmail(email),
      manuscript_key: input.manuscript.key,
      manuscript_name: input.manuscript.name,
      manuscript_format: input.manuscript.format,
      manuscript_size: input.manuscript.size,
      locale: 'es',
    })
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'submission failed')
  return data as LaunchpadSubmission
}

// ── Review queue (Story 1.2) — shop-scoped reads + transitions ───────────────

/** Every submission for a shop, newest first. */
export async function listSubmissionsForShop(shopId: string): Promise<LaunchpadSubmission[]> {
  const { data } = await db
    .from('launchpad_submissions')
    .select('*')
    .eq('shop_id', shopId)
    .order('created_at', { ascending: false })
  return (data ?? []) as LaunchpadSubmission[]
}

/** One submission, scoped to the shop (returns null if it belongs to another shop). */
export async function getSubmissionForShop(shopId: string, id: string): Promise<LaunchpadSubmission | null> {
  const { data } = await db
    .from('launchpad_submissions')
    .select('*')
    .eq('id', id)
    .eq('shop_id', shopId)
    .maybeSingle()
  return (data as LaunchpadSubmission | null) ?? null
}

export type TransitionResult =
  | { ok: true; submission: LaunchpadSubmission }
  | { ok: false; status: number; error: string }

/**
 * Move a submission to a new curation state (Story 1.2). Enforces the pure state
 * machine + the note requirement, asserts shop ownership, persists, then emails
 * the writer on the transition (es-MX). `reject`/`changes_requested` require a note.
 */
export async function transitionSubmission(input: {
  shop: LaunchpadShop
  id: string
  to: SubmissionStatus
  note?: string | null
}): Promise<TransitionResult> {
  const current = await getSubmissionForShop(input.shop.id, input.id)
  if (!current) return { ok: false, status: 404, error: 'not_found' }

  if (!canTransition(current.status, input.to)) {
    return { ok: false, status: 422, error: 'invalid_transition' }
  }
  const note = input.note?.trim() || null
  if (transitionRequiresNote(input.to) && !note) {
    return { ok: false, status: 422, error: 'note_required' }
  }

  const { data, error } = await db
    .from('launchpad_submissions')
    .update({ status: input.to, review_note: note, updated_at: new Date().toISOString() })
    .eq('id', input.id)
    .eq('shop_id', input.shop.id)
    .select('*')
    .single()
  if (error || !data) return { ok: false, status: 500, error: 'update_failed' }

  const submission = data as LaunchpadSubmission
  // Email the writer on the transition (best-effort — never fail the write on it).
  try {
    await sendLaunchpadStatusEmail({
      to: submission.author_email,
      authorName: submission.author_name,
      title: submission.title,
      shopName: input.shop.name,
      status: input.to,
      note,
    })
  } catch (e) {
    console.error('[launchpad] status email failed (non-fatal):', e)
  }

  return { ok: true, submission }
}

/**
 * A short-lived (5 min) signed URL to the manuscript file — shop-only download.
 * Handles both the R2 private bucket and the Supabase private-bucket fallback.
 */
export async function getManuscriptSignedUrl(submission: LaunchpadSubmission): Promise<string | null> {
  const key = submission.manuscript_key
  const fileName = submission.manuscript_name ?? `manuscrito.${submission.manuscript_format}`
  if (isR2DigitalConfigured()) {
    try {
      return await getR2DigitalSignedUrl(key, 300, fileName)
    } catch (e) {
      console.error('[launchpad] R2 signed URL failed:', e)
    }
  }
  const { data } = await db.storage.from('digital-files').createSignedUrl(key, 300, { download: fileName })
  return data?.signedUrl ?? null
}

// ── Publish (Story 1.3) — mint an approved submission as a draft digital product ─

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://miyagisanchez.com').replace(/\/+$/, '')

// Optimistic-lock sentinel written to `published_product_id` while a mint is in
// flight, so a concurrent publish loses the conditional claim (see publishSubmission).
const PENDING_PREFIX = 'pending:'

const FORMAT_MIME: Record<ManuscriptFormat, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export type PublishResult =
  | { ok: true; productId: string; manageUrl: string }
  | { ok: false; status: number; error: string }

/**
 * Mint an approved submission as a **draft** digital product under the shop,
 * reusing the seller-product internal write path. The manuscript already lives
 * in the private digital bucket (Story 1.1), so we point `metadata.digital_file`
 * at its key — the existing digital-delivery webhooks then serve it to buyers
 * unchanged. Synopsis → description, genre → category. Draft: the seller sets
 * price + cover and activates from the listings dashboard. Idempotent: a second
 * call returns the already-minted product.
 */
export async function publishSubmission(input: { shop: LaunchpadShop; id: string }): Promise<PublishResult> {
  const submission = await getSubmissionForShop(input.shop.id, input.id)
  if (!submission) return { ok: false, status: 404, error: 'not_found' }
  if (submission.status !== 'approved') return { ok: false, status: 422, error: 'not_approved' }

  // Already minted → idempotent no-op (never create a duplicate product).
  if (submission.published_product_id && !submission.published_product_id.startsWith(PENDING_PREFIX)) {
    return { ok: true, productId: submission.published_product_id, manageUrl: '/shop/manage/catalogo' }
  }
  if (!input.shop.slug) return { ok: false, status: 422, error: 'shop_slug_missing' }

  // Optimistic claim BEFORE the (external, non-transactional) mint: only the
  // request that flips the null → sentinel wins; a concurrent double-click loses
  // the conditional update and bails, so two products can never be minted.
  const lockToken = `${PENDING_PREFIX}${randomUUID()}`
  const { data: claimed } = await db
    .from('launchpad_submissions')
    .update({ published_product_id: lockToken, updated_at: new Date().toISOString() })
    .eq('id', submission.id)
    .eq('shop_id', input.shop.id)
    .is('published_product_id', null)
    .select('id')
  if (!claimed || claimed.length === 0) {
    // Lost the race — another request is minting or already minted. Return the
    // real product if it's already linked, else signal a transient conflict.
    const current = await getSubmissionForShop(input.shop.id, input.id)
    if (current?.published_product_id && !current.published_product_id.startsWith(PENDING_PREFIX)) {
      return { ok: true, productId: current.published_product_id, manageUrl: '/shop/manage/catalogo' }
    }
    return { ok: false, status: 409, error: 'already_publishing' }
  }

  const fmt = submission.manuscript_format
  const result = await createSellerProductViaInternal(input.shop.slug, {
    title: submission.title,
    description: submission.synopsis ?? null,
    listing_type: 'digital',
    status: 'draft',
    ...(submission.genre ? { category: submission.genre } : {}),
    metadata: {
      digital_file: {
        path: submission.manuscript_key,
        name: submission.manuscript_name ?? `${submission.title}.${fmt}`,
        size: submission.manuscript_size ?? 0,
        mime: FORMAT_MIME[fmt],
        label: fmt.toUpperCase(),
      },
      // Provenance — links the listing back to the submission so the activation
      // seam can notify the writer with the live URL exactly once.
      launchpad_submission_id: submission.id,
    },
  })

  if (!result.ok || !result.product_id) {
    // Mint failed — release the claim so the seller can retry (and the queue
    // shows "Publicar" again, not a stuck sentinel).
    await db.from('launchpad_submissions')
      .update({ published_product_id: null })
      .eq('id', submission.id).eq('published_product_id', lockToken)
    return { ok: false, status: result.status || 500, error: result.error ?? 'mint_failed' }
  }

  const { error: linkError } = await db
    .from('launchpad_submissions')
    .update({ published_product_id: result.product_id, updated_at: new Date().toISOString() })
    .eq('id', submission.id)
    .eq('shop_id', input.shop.id)
  if (linkError) {
    // The product exists but we couldn't record the link — surface it rather than
    // report success (the writer-notify + re-mint guard both key off this column).
    console.error('[launchpad] publish link update failed:', linkError.message)
    return { ok: false, status: 500, error: 'link_failed' }
  }

  return { ok: true, productId: result.product_id, manageUrl: '/shop/manage/catalogo' }
}

/**
 * Called from the listing-activation seam: when a launchpad-minted product is
 * first ACTIVATED (draft → published), email the writer the live URL — once.
 * Best-effort + idempotent (guarded by `published_notified_at`). No-op for any
 * product that isn't a launchpad publication.
 */
export async function notifyWriterOnPublish(productId: string): Promise<void> {
  const { data } = await db
    .from('launchpad_submissions')
    .select('*')
    .eq('published_product_id', productId)
    .is('published_notified_at', null)
    .maybeSingle()
  if (!data) return

  const submission = data as LaunchpadSubmission
  const { name: shopName } = await shopNameForId(submission.shop_id)
  try {
    await sendLaunchpadPublishedEmail({
      to: submission.author_email,
      authorName: submission.author_name,
      title: submission.title,
      shopName,
      url: `${SITE_URL}/l/${productId}`,
    })
    await db
      .from('launchpad_submissions')
      .update({ published_notified_at: new Date().toISOString() })
      .eq('id', submission.id)
  } catch (e) {
    console.error('[launchpad] published email failed (non-fatal):', e)
  }
}

async function shopNameForId(shopId: string): Promise<{ name: string }> {
  const { data } = await db.from('marketplace_shops').select('name, slug').eq('id', shopId).maybeSingle()
  return { name: (data?.name ?? data?.slug ?? 'La librería') as string }
}
