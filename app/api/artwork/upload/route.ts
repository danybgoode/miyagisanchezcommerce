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
 * The actual validate-and-store logic (real magic-byte sniffing, real
 * field-def resolution, R2/Supabase store) lives in `lib/artwork-ingest.ts`
 * (Sprint 4, Story 4.2 extracted it) — shared with the MCP checkout path,
 * which fetches an agent-supplied artwork URL server-side and must apply
 * the identical validation.
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { ingestArtworkBytes } from '@/lib/artwork-ingest'

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

  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = await ingestArtworkBytes(bytes, listingId, fieldId)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ url: result.url })
}
