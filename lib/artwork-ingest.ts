/**
 * Shared artwork validate-and-store logic (custom-print-products epic).
 *
 * Extracted from `POST /api/artwork/upload` (Sprint 3, Story 3.2) so a SECOND
 * caller — the MCP checkout path (Sprint 4, Story 4.2), which fetches an
 * agent-supplied artwork URL server-side — reuses the exact same real
 * magic-byte sniff + real-field-def resolution + R2/Supabase store, instead
 * of a second copy of this security-sensitive path. No behavior change to
 * the existing upload route.
 */
import 'server-only'
import { db } from '@/lib/supabase'
import { uploadToR2, isR2Configured } from '@/lib/r2'
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

export interface ArtworkIngestOk {
  ok: true
  url: string
}
export interface ArtworkIngestError {
  ok: false
  status: number
  error: string
}

/**
 * Validates `bytes` against the listing's REAL `file` field def (never a
 * caller-supplied limit) and stores it, returning the public URL. Never
 * trusts a client-declared extension/Content-Type — always sniffs the real
 * magic bytes.
 */
export async function ingestArtworkBytes(
  bytes: Uint8Array,
  listingId: string,
  fieldId: string,
): Promise<ArtworkIngestOk | ArtworkIngestError> {
  if (bytes.byteLength === 0) {
    return { ok: false, status: 400, error: 'No se recibió ningún archivo.' }
  }
  if (bytes.byteLength > MAX_ARTWORK_SIZE_MB * 1024 * 1024) {
    return {
      ok: false, status: 400,
      error: `El archivo es demasiado grande (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB). El máximo es ${MAX_ARTWORK_SIZE_MB} MB.`,
    }
  }

  // Resolve the REAL field def from the listing — never trust a caller-
  // supplied limit. A field that doesn't resolve at all is rejected outright
  // (never falls back to the global cap), same discipline as the human
  // upload route (cross-agent review catch, 2026-07-06).
  const defs = await getListingCustomFieldsUncached(listingId)
  const fieldDef = defs.find(d => d.id === fieldId && d.type === 'file')
  if (!fieldDef) {
    return { ok: false, status: 400, error: 'Campo de archivo no válido.' }
  }
  const allowedFormats = fieldDef.allowed_formats ?? [...ARTWORK_FORMATS]
  const maxSizeMb = fieldDef.max_size_mb ?? MAX_ARTWORK_SIZE_MB
  const maxSizeBytes = Math.min(maxSizeMb, MAX_ARTWORK_SIZE_MB) * 1024 * 1024

  if (bytes.byteLength > maxSizeBytes) {
    return {
      ok: false, status: 400,
      error: `El archivo es demasiado grande (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB). El máximo es ${maxSizeMb} MB.`,
    }
  }

  const sniffed = sniffFileFormat(bytes)
  if (!sniffed || !formatSatisfiesAllowlist(sniffed, allowedFormats)) {
    return {
      ok: false, status: 400,
      error: `Formato no soportado o el archivo no coincide con su tipo. Usa ${allowedFormats.join(', ').toUpperCase()}.`,
    }
  }

  const ext = EXT_FOR_FORMAT[sniffed]
  const contentType = sniffed === 'svg' ? 'image/svg+xml' : sniffed === 'pdf' ? 'application/pdf' : `image/${sniffed}`
  const path = `artwork/${listingId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  // ── R2 (preferred) with Supabase fallback — same ladder as /api/supply/upload ─
  if (isR2Configured()) {
    try {
      const url = await uploadToR2(bytes.buffer as ArrayBuffer, path, contentType)
      return { ok: true, url }
    } catch (e) {
      console.error('[artwork-ingest] R2 failed, falling back to Supabase:', e)
    }
  }

  await db.storage.createBucket(BUCKET, { public: true }).catch(() => {})
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType, upsert: false })

  if (uploadError) {
    console.error('[artwork-ingest] Supabase Storage upload error:', uploadError)
    return { ok: false, status: 500, error: 'Error al subir el archivo. Inténtalo de nuevo.' }
  }

  const { data: { publicUrl } } = db.storage.from(BUCKET).getPublicUrl(path)
  return { ok: true, url: publicUrl }
}
