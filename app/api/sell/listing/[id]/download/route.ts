import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'

const BUCKET = 'digital-files'
const SIGNED_URL_EXPIRY_SECS = 3600 // 1 hour

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  const { id } = await params

  // ── Fetch listing ─────────────────────────────────────────────────────────
  const { data: listing } = await db
    .from('marketplace_listings')
    .select('id, listing_type, metadata, status, shop_id, marketplace_shops!inner(clerk_user_id)')
    .eq('id', id)
    .neq('status', 'deleted')
    .single()

  if (!listing) {
    return NextResponse.json({ error: 'Anuncio no encontrado.' }, { status: 404 })
  }

  if (listing.listing_type !== 'digital') {
    return NextResponse.json({ error: 'Este anuncio no tiene archivo digital.' }, { status: 400 })
  }

  const meta = listing.metadata as Record<string, unknown> | null
  const digitalFile = meta?.digital_file as { path?: string; name?: string; size?: number; mime?: string } | undefined

  if (!digitalFile?.path) {
    return NextResponse.json({ error: 'Archivo no disponible.' }, { status: 404 })
  }

  // ── Authorization ─────────────────────────────────────────────────────────
  // Currently: only the shop owner can download (preview mode).
  // When Stripe webhooks are added (Task #6), also allow verified buyers.
  const shops = listing.marketplace_shops as unknown as { clerk_user_id: string } | { clerk_user_id: string }[]
  const shop = Array.isArray(shops) ? shops[0] : shops
  const isOwner = userId && shop?.clerk_user_id === userId

  if (!isOwner) {
    // Payment gate: return 402 so the UI can show "Comprar para descargar"
    return NextResponse.json({
      error: 'Compra este producto para obtener el enlace de descarga.',
      code: 'PAYMENT_REQUIRED',
    }, { status: 402 })
  }

  // ── Generate signed URL ───────────────────────────────────────────────────
  const { data: signed, error } = await db.storage
    .from(BUCKET)
    .createSignedUrl(digitalFile.path, SIGNED_URL_EXPIRY_SECS, {
      download: digitalFile.name ?? 'download',
    })

  if (error || !signed?.signedUrl) {
    console.error('Signed URL error:', error)
    return NextResponse.json({ error: 'Error al generar enlace de descarga.' }, { status: 500 })
  }

  return NextResponse.json({
    url: signed.signedUrl,
    name: digitalFile.name,
    expiresIn: SIGNED_URL_EXPIRY_SECS,
  })
}
