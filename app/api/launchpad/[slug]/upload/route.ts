/**
 * POST /api/launchpad/[slug]/upload — multipart form-data: file=<manuscript>
 *
 * Fully public, unauthenticated (bookshop-launchpad S1.1) — a writer uploads
 * before there's any account. Only the formData/size MECHANICS of the digital
 * upload are mirrored; the real validation (magic-byte sniff → PDF/EPUB/DOCX)
 * and the PRIVATE-bucket store live in `ingestManuscript`. Returns the storage
 * key (never a public URL) which the submit route re-verifies is shop-scoped.
 */
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'
import { isEnabled } from '@/lib/flags'
import { getLaunchpadShopBySlug, ingestManuscript } from '@/lib/launchpad'
import { MAX_MANUSCRIPT_SIZE_MB } from '@/lib/launchpad-types'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const rl = await checkRateLimit('launchpad', getClientIp(req))
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Demasiadas subidas. Espera un momento e inténtalo de nuevo.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })
  }

  if (!(await isEnabled('launchpad.enabled'))) {
    return NextResponse.json({ error: 'La convocatoria no está disponible.' }, { status: 423 })
  }

  const { slug } = await params
  const shop = await getLaunchpadShopBySlug(slug)
  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })
  if (!shop.acceptsManuscripts) return NextResponse.json({ error: 'Esta tienda no está recibiendo manuscritos.' }, { status: 422 })

  let formData: FormData
  try { formData = await req.formData() } catch { return NextResponse.json({ error: 'No se pudo leer el archivo.' }, { status: 400 }) }

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) {
    return NextResponse.json({ error: 'No se recibió ningún archivo.' }, { status: 400 })
  }

  // Cheap fast-fail against the absolute ceiling using File.size BEFORE ever
  // materializing the buffer — ingestManuscript re-checks on the bytes too.
  if (file.size > MAX_MANUSCRIPT_SIZE_MB * 1024 * 1024) {
    return NextResponse.json({
      error: `El archivo es demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). El máximo es ${MAX_MANUSCRIPT_SIZE_MB} MB.`,
    }, { status: 400 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const result = await ingestManuscript(bytes, file.name, shop)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({
    key: result.key,
    format: result.format,
    name: result.name,
    size: result.size,
  })
}
