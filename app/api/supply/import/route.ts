import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { refreshBatchCounts, slugify, type SupplyItem } from '@/lib/supply'

function checkSecret(req: NextRequest): boolean {
  const secret = req.headers.get('x-admin-secret') ?? req.nextUrl.searchParams.get('secret')
  return secret === process.env.ADMIN_SECRET
}

async function uniqueShopSlug(name: string) {
  const base = slugify(name, 40) || 'tienda'
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 6)
    const slug = `${base}-${suffix}`
    const { data } = await db.from('marketplace_shops').select('id').eq('slug', slug).maybeSingle()
    if (!data) return slug
  }
  return `${base}-${Date.now().toString(36)}`
}

async function resolveShop(item: SupplyItem) {
  const shopSourceUrl = item.shop_source_url ?? item.source_url
  if (shopSourceUrl) {
    const { data: existing } = await db
      .from('marketplace_shops')
      .select('id, slug')
      .eq('source_url', shopSourceUrl)
      .maybeSingle()

    if (existing) return existing
  }

  const shopName = item.shop_name?.trim() || 'Vendedor sin reclamar'
  const slug = await uniqueShopSlug(shopName)
  const { data: created, error } = await db
    .from('marketplace_shops')
    .insert({
      slug,
      name: shopName.slice(0, 80),
      description: item.shop_description,
      location: item.shop_location ?? item.location,
      logo_url: item.shop_logo_url,
      clerk_user_id: null,
      source: 'scraped',
      source_url: shopSourceUrl,
      verified: false,
      metadata: {
        ...(item.shop_metadata ?? {}),
        supply: {
          batch_id: item.batch_id,
          item_id: item.id,
          source_platform: item.source_platform,
          unclaimed: true,
        },
      },
    })
    .select('id, slug')
    .single()

  if (error || !created) throw new Error(`Shop insert failed: ${error?.message ?? 'no data'}`)
  return created
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

      const shop = await resolveShop(item)
      const { data: listing, error: listingErr } = await db
        .from('marketplace_listings')
        .insert({
          shop_id: shop.id,
          title: item.listing_title.trim().slice(0, 100),
          description: item.listing_description,
          price_cents: item.price_cents,
          currency: item.currency || 'MXN',
          condition: item.listing_type === 'product' ? item.condition : null,
          listing_type: item.listing_type || 'product',
          category: item.category,
          state: item.state,
          municipio: item.municipio,
          location: item.location,
          images: item.images ?? [],
          tags: item.tags ?? [],
          status: targetStatus,
          source: 'scraped',
          source_platform: item.source_platform,
          source_url: item.source_url,
          metadata: {
            ...(item.listing_metadata ?? {}),
            original_source_url: item.source_url,
            supply: {
              batch_id: item.batch_id,
              item_id: item.id,
              source_id: item.source_id,
              quality_score: item.quality_score,
              unclaimed_shop: true,
            },
          },
        })
        .select('id')
        .single()

      if (listingErr || !listing) throw new Error(`Listing insert failed: ${listingErr?.message ?? 'no data'}`)

      imported++
      await db.from('supply_items').update({
        status: 'imported',
        imported_shop_id: shop.id,
        imported_listing_id: listing.id,
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
