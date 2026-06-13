import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { db } from '@/lib/supabase'
import {
  refreshBatchCounts,
  supplyItemToSellerBody,
  supplyItemToProductBody,
  type SupplyItem,
} from '@/lib/supply'
import {
  ensureUnclaimedShopMirror,
  syncSupabaseListingMirror,
  type MedusaSellerForMirror,
} from '@/lib/provisioning'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

function checkSecret(req: NextRequest): boolean {
  const secret = req.headers.get('x-admin-secret') ?? req.nextUrl.searchParams.get('secret')
  return secret === process.env.ADMIN_SECRET
}

function internalFetch(path: string, body: unknown) {
  return fetch(`${MEDUSA_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': INTERNAL_SECRET,
    },
    body: JSON.stringify(body),
  })
}

type MedusaSeller = MedusaSellerForMirror & {
  clerk_user_id: string | null
  source?: string | null
  source_url?: string | null
}

/**
 * Resolve the item's shop to a REAL Medusa seller (the storefront's only read
 * model) — created unclaimed (clerk_user_id NULL) when new, idempotent on
 * source_url — then make sure the Supabase mirror row exists (conversations /
 * offers / short links read the mirror; non-fatal when it fails).
 */
async function resolveSeller(item: SupplyItem): Promise<{ seller: MedusaSeller; mirrorId: string | null }> {
  const res = await internalFetch('/internal/sellers', supplyItemToSellerBody(item))
  const data = await res.json().catch(() => ({})) as { seller?: MedusaSeller; message?: string }
  if (!res.ok || !data.seller) {
    throw new Error(`Seller create failed (${res.status}): ${data.message ?? 'no data'}`)
  }

  const mirrorId = await ensureUnclaimedShopMirror(data.seller).catch((e) => {
    console.error('[supply/import] shop mirror failed (non-fatal):', e)
    return null
  })

  return { seller: data.seller, mirrorId }
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!INTERNAL_SECRET) {
    return NextResponse.json({ error: 'MEDUSA_INTERNAL_SECRET is not configured' }, { status: 500 })
  }

  const body = await req.json().catch(() => null) as {
    batchId?: string
    targetStatus?: string
  } | null

  if (!body?.batchId) return NextResponse.json({ error: 'batchId is required' }, { status: 422 })

  const { data: batch, error: batchErr } = await db
    .from('supply_batches')
    .select('*')
    .eq('id', body.batchId)
    .single()

  if (batchErr || !batch) {
    return NextResponse.json({ error: batchErr?.message ?? 'Batch not found' }, { status: 404 })
  }

  const targetStatus = body.targetStatus || batch.target_status || 'active'
  await db.from('supply_batches').update({ status: 'importing', error_message: null }).eq('id', batch.id)

  const { data: items, error: itemsErr } = await db
    .from('supply_items')
    .select('*')
    .eq('batch_id', batch.id)
    .eq('status', 'approved')
    .order('quality_score', { ascending: false })
    .limit(500)

  if (itemsErr) {
    await db.from('supply_batches').update({ status: 'failed', error_message: itemsErr.message }).eq('id', batch.id)
    return NextResponse.json({ error: itemsErr.message }, { status: 500 })
  }

  let imported = 0
  let duplicate = 0
  let failed = 0

  for (const item of (items ?? []) as SupplyItem[]) {
    try {
      if (!item.listing_title || item.listing_title.trim().length < 5) {
        throw new Error('Missing listing title')
      }
      if (!item.source_url) {
        throw new Error('Missing original source URL')
      }
      if (!item.category) {
        throw new Error('Missing category')
      }

      const { data: existingListing } = await db
        .from('marketplace_listings')
        .select('id')
        .eq('source_url', item.source_url)
        .maybeSingle()

      if (existingListing) {
        duplicate++
        await db.from('supply_items').update({
          status: 'duplicate',
          error_message: 'Listing source_url already exists',
          imported_listing_id: existingListing.id,
          imported_at: new Date().toISOString(),
        }).eq('id', item.id)
        continue
      }

      const { seller, mirrorId } = await resolveSeller(item)

      // ── Create the REAL listing: a Medusa product linked to the seller ────
      const productBody = supplyItemToProductBody(item, seller.slug, targetStatus)
      const productRes = await internalFetch('/internal/seller-products', productBody)
      const productData = await productRes.json().catch(() => ({})) as { product_id?: string; message?: string }
      if (!productRes.ok || !productData.product_id) {
        throw new Error(`Listing create failed (${productRes.status}): ${productData.message ?? 'no data'}`)
      }

      // ── Mirror the listing (short-code mint + conversations/offers) ───────
      let mirrorListingId: string | null = null
      if (mirrorId) {
        mirrorListingId = await syncSupabaseListingMirror(mirrorId, {
          id: productData.product_id,
          title: productBody.title,
          description: productBody.description,
          price_cents: productBody.price_cents,
          currency: productBody.currency,
          condition: productBody.condition,
          listing_type: productBody.listing_type,
          category: productBody.category,
          state: productBody.state,
          municipio: productBody.municipio,
          location: productBody.location,
          images: productBody.images,
          tags: productBody.tags,
          status: targetStatus,
          metadata: productBody.metadata,
          source: 'scraped',
          source_platform: item.source_platform,
          source_url: item.source_url,
        }).catch((e) => {
          console.error('[supply/import] listing mirror failed (non-fatal):', e)
          return null
        }) ?? null
      }

      imported++
      await db.from('supply_items').update({
        status: 'imported',
        imported_shop_id: mirrorId,
        imported_listing_id: mirrorListingId,
        imported_at: new Date().toISOString(),
        error_message: null,
      }).eq('id', item.id)
    } catch (err) {
      failed++
      await db.from('supply_items').update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : String(err),
      }).eq('id', item.id)
    }
  }

  // Fresh shops/listings should show up without waiting out the ISR window.
  if (imported > 0) {
    revalidateTag('shops', 'default')
    revalidateTag('listings', 'default')
  }

  const counts = await refreshBatchCounts(batch.id)
  const doneStatus = failed > 0 ? 'failed' : 'imported'
  await db.from('supply_batches').update({
    status: doneStatus,
    imported_at: new Date().toISOString(),
    error_message: failed > 0 ? `${failed} row(s) failed during import` : null,
  }).eq('id', batch.id)

  return NextResponse.json({
    imported,
    duplicate,
    failed,
    counts,
  })
}
