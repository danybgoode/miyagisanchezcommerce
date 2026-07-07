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

import { db } from '@/lib/supabase'
import {
  cleanEmail,
  isValidEmail,
  hashSweepstakesEmail,
  hashVerificationCode,
  safeCompare,
  makeCode,
} from '@/lib/sweepstakes'
import { uploadDigitalToR2, isR2DigitalConfigured } from '@/lib/r2'
import { sendLaunchpadVerificationCode } from '@/lib/email'
import { sniffManuscript } from '@/lib/manuscript-sniff'
import {
  MAX_MANUSCRIPT_SIZE_MB,
  type LaunchpadSubmission,
  type ManuscriptFormat,
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

// ── Email-code verification (scope = shop id) ────────────────────────────────

export async function sendLaunchpadCode(shop: LaunchpadShop, email: string): Promise<void> {
  const normalized = cleanEmail(email)
  const emailHash = hashSweepstakesEmail(normalized)
  const code = makeCode()
  const codeHash = hashVerificationCode(shop.id, emailHash, code)

  await db.from('launchpad_email_verifications').insert({
    shop_id: shop.id,
    email_hash: emailHash,
    email: normalized,
    code_hash: codeHash,
    locale: 'es',
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })

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
