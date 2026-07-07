/**
 * Buyer artwork upload — custom-print-products Sprint 3, Story 3.2.
 *
 *   POST /api/artwork/upload   multipart form-data: file=<artwork>, listingId, fieldId
 *   Auth: NONE — genuinely public. A guest must be able to upload artwork
 *   before ever signing in (the buy-now hand-off happens before checkout).
 *   Only the formData/size-cap MECHANICS of /api/supply/upload are mirrored
 *   here, never its `withSupplyAdmin` auth wrapper.
 *   → { url }
 *
 * Unlike every other upload route in this codebase, this one does real
 * magic-byte format sniffing (`lib/file-sniff.ts`) instead of trusting the
 * client's Content-Type/extension — a fully public, unauthenticated upload
 * surface is the one place that verification actually matters. The stored
 * file's extension is derived from the SNIFFED format, never `file.name`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { uploadToR2, isR2Configured } from '@/lib/r2'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { sniffFileFormat } from '@/lib/file-sniff'
import { getListingCustomFieldsUncached } from '@/lib/listings'
import { ARTWORK_FORMATS, MAX_ARTWORK_SIZE_MB, type ArtworkFormat } from '@/lib/personalization'

const BUCKET = 'listing-images'

// A sniffed format never lies about which extension to store it under — 'ai'
// isn't a sniff result (see lib/file-sniff.ts), only ever an allowlist entry.
const EXT_FOR_FORMAT: Record<'png' | 'jpg' | 'pdf' | 'svg', string> = {
  png: 'png', jpg: 'jpg', pdf: 'pdf', svg: 'svg',
}

/** A sniffed 'pdf' also satisfies an allowlist that only ticked 'ai' — modern
 *  Illustrator files ARE valid PDF containers by default. */
function formatSatisfiesAllowlist(sniffed: 'png' | 'jpg' | 'pdf' | 'svg', allowed: ArtworkFormat[]): boolean {
  if (allowed.includes(sniffed as ArtworkFormat)) return true
  if (sniffed === 'pdf' && allowed.includes('ai')) return true
  return false
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  const rl = await checkRateLimit('artwork_upload', ip)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiadas subidas. Espera un momento e inténtalo de nuevo.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'No se pudo leer el archivo.' }, { status: 400 })
  }

  const file = formData.get('file') as File | null
  const listingId = String(formData.get('listingId') ?? '')
  const fieldId = String(formData.get('fieldId') ?? '')

  if (!file || file.size === 0) {
    return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 })
  }
  if (!listingId) {
    return NextResponse.json({ error: 'Falta el anuncio.' }, { status: 400 })
  }

  // Cheap fast-fail against the ABSOLUTE global ceiling before paying for a
  // Medusa round-trip — a per-field cap can only ever be smaller than this,
  // never larger (sanitizeFieldDefs clamps it), so this can never wrongly
  // reject a file a real field would have accepted.
  if (file.size > MAX_ARTWORK_SIZE_MB * 1024 * 1024) {
    return NextResponse.json({
      error: `El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). El máximo es ${MAX_ARTWORK_SIZE_MB} MB.`,
    }, { status: 400 })
  }

  // Resolve the REAL field def from the listing — never trust a client-
  // supplied limit for a fully public surface. Unlike the format/size limits
  // (which fall back to the global hard cap when the listing/field lookup
  // fails, biasing toward not blocking a legitimate buyer on a transient
  // fetch hiccup), a field that doesn't resolve at all is rejected outright:
  // without this, ANY caller could pass a fake listingId/fieldId and use
  // this route as an unrestricted anonymous file host, bounded only by the
  // global format/size caps rather than a real listing's actual field
  // (cross-agent review catch, 2026-07-06).
  const defs = await getListingCustomFieldsUncached(listingId)
  const fieldDef = defs.find(d => d.id === fieldId && d.type === 'file')
  if (!fieldDef) {
    return NextResponse.json({ error: 'Campo de archivo no válido.' }, { status: 400 })
  }
  const allowedFormats = fieldDef.allowed_formats ?? [...ARTWORK_FORMATS]
  const maxSizeMb = fieldDef.max_size_mb ?? MAX_ARTWORK_SIZE_MB
  const maxSizeBytes = Math.min(maxSizeMb, MAX_ARTWORK_SIZE_MB) * 1024 * 1024

  if (file.size > maxSizeBytes) {
    return NextResponse.json({
      error: `El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). El máximo es ${maxSizeMb} MB.`,
    }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const sniffed = sniffFileFormat(bytes)

  if (!sniffed || !formatSatisfiesAllowlist(sniffed, allowedFormats)) {
    // Reflect the field's ACTUAL allowlist, not the full static list — a
    // seller who narrowed formats shouldn't have buyers told a format is
    // fine when their listing doesn't actually accept it.
    return NextResponse.json({
      error: `Formato no soportado o el archivo no coincide con su tipo. Usa ${allowedFormats.join(', ').toUpperCase()}.`,
    }, { status: 400 })
  }

  const ext = EXT_FOR_FORMAT[sniffed]
  const contentType = sniffed === 'svg' ? 'image/svg+xml' : sniffed === 'pdf' ? 'application/pdf' : `image/${sniffed}`
  const path = `artwork/${listingId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  // ── R2 (preferred) with Supabase fallback — same ladder as /api/supply/upload ─
  if (isR2Configured()) {
    try {
      const url = await uploadToR2(bytes.buffer as ArrayBuffer, path, contentType)
      return NextResponse.json({ url })
    } catch (e) {
      console.error('[artwork/upload] R2 failed, falling back to Supabase:', e)
    }
  }

  await db.storage.createBucket(BUCKET, { public: true }).catch(() => {})
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: false })

  if (uploadError) {
    console.error('[artwork/upload] Supabase Storage upload error:', uploadError)
    return NextResponse.json({ error: 'Error al subir el archivo. Inténtalo de nuevo.' }, { status: 500 })
  }

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(path)
  return NextResponse.json({ url: publicUrl })
}
