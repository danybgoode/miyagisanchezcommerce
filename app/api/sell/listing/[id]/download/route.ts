import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getR2DigitalSignedUrl, isR2DigitalConfigured } from '@/lib/r2'
import {
  PAID_DOWNLOAD_ORDER_STATUSES,
  normalizeBuyerEmails,
  resolveDigitalDownloadAccess,
  type DigitalDownloadOrderEvidence,
} from '@/lib/digital-download-access'

const SUPABASE_BUCKET = 'digital-files'
const SIGNED_URL_EXPIRY_SECS = 3600 // 1 hour

function isUuid(value: string) {
  return /^[0-9a-f-]{36}$/i.test(value)
}

type DownloadListing = {
  id: string
  medusa_product_id: string | null
  listing_type: string
  metadata: Record<string, unknown> | null
  status: string
  shop_id: string
  marketplace_shops: { clerk_user_id: string | null } | { clerk_user_id: string | null }[]
}

async function resolveDownloadListing(id: string): Promise<DownloadListing | null> {
  const select = 'id, medusa_product_id, listing_type, metadata, status, shop_id, marketplace_shops!inner(clerk_user_id)'

  const { data: byMedusa } = await db
    .from('marketplace_listings')
    .select(select)
    .eq('medusa_product_id', id)
    .neq('status', 'deleted')
    .maybeSingle()

  if (byMedusa) return byMedusa as DownloadListing
  if (!isUuid(id)) return null

  const { data: byId } = await db
    .from('marketplace_listings')
    .select(select)
    .eq('id', id)
    .neq('status', 'deleted')
    .maybeSingle()

  return (byId as DownloadListing | null) ?? null
}

async function findPaidBuyerOrder({
  listingId,
  userId,
  buyerEmails,
}: {
  listingId: string
  userId: string | null
  buyerEmails: string[]
}): Promise<DigitalDownloadOrderEvidence | null> {
  const paidStatuses = [...PAID_DOWNLOAD_ORDER_STATUSES]

  if (userId) {
    const { data, error } = await db
      .from('marketplace_orders')
      .select('id, status')
      .eq('listing_id', listingId)
      .eq('buyer_clerk_user_id', userId)
      .in('status', paidStatuses)
      .limit(1)
      .maybeSingle()

    if (error) console.error('[digital-download] buyer_clerk lookup failed:', error)
    if (data) return data as DigitalDownloadOrderEvidence
  }

  if (buyerEmails.length > 0) {
    const { data, error } = await db
      .from('marketplace_orders')
      .select('id, status')
      .eq('listing_id', listingId)
      .in('buyer_email', buyerEmails)
      .in('status', paidStatuses)
      .limit(1)
      .maybeSingle()

    if (error) console.error('[digital-download] buyer_email lookup failed:', error)
    if (data) return data as DigitalDownloadOrderEvidence
  }

  return null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser()
  const userId = user?.id ?? null
  const { id } = await params

  // ── Fetch listing ─────────────────────────────────────────────────────────
  const listing = await resolveDownloadListing(id)
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
  const shops = listing.marketplace_shops as unknown as { clerk_user_id: string } | { clerk_user_id: string }[]
  const shop = Array.isArray(shops) ? shops[0] : shops
  const buyerEmails = normalizeBuyerEmails(user?.emailAddresses?.map(email => email.emailAddress) ?? [])
  const paidOrder = userId && shop?.clerk_user_id === userId
    ? null
    : await findPaidBuyerOrder({ listingId: listing.id, userId, buyerEmails })
  const access = resolveDigitalDownloadAccess({
    actor: { userId, buyerEmails },
    ownerClerkUserId: shop?.clerk_user_id,
    paidOrder,
  })

  if (!access.allowed) {
    // Payment gate: return 402 so the UI can show "Comprar para descargar"
    return NextResponse.json({
      error: 'Compra este producto para obtener el enlace de descarga.',
      code: 'PAYMENT_REQUIRED',
    }, { status: access.deniedStatus ?? 402 })
  }

  // ── Generate signed URL ───────────────────────────────────────────────────
  let signedUrl: string

  if (isR2DigitalConfigured()) {
    try {
      signedUrl = await getR2DigitalSignedUrl(
        digitalFile.path,
        SIGNED_URL_EXPIRY_SECS,
        digitalFile.name ?? 'download',
      )
    } catch (e) {
      console.error('[r2-digital] signed URL error:', e)
      return NextResponse.json({ error: 'Error al generar enlace de descarga.' }, { status: 500 })
    }
  } else {
    // Supabase fallback (existing files uploaded before R2 migration)
    const { data: signed, error } = await db.storage
      .from(SUPABASE_BUCKET)
      .createSignedUrl(digitalFile.path, SIGNED_URL_EXPIRY_SECS, {
        download: digitalFile.name ?? 'download',
      })
    if (error || !signed?.signedUrl) {
      console.error('Signed URL error:', error)
      return NextResponse.json({ error: 'Error al generar enlace de descarga.' }, { status: 500 })
    }
    signedUrl = signed.signedUrl
  }

  return NextResponse.json({
    url: signedUrl,
    name: digitalFile.name,
    expiresIn: SIGNED_URL_EXPIRY_SECS,
  })
}
