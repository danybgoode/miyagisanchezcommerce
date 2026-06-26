import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withSupplyAdmin } from '@/lib/admin/guard'
import { normalizePriceCents, qualityScore, refreshBatchCounts, SUPPLY_ITEM_STATUSES, SUPPLY_LISTING_TYPES } from '@/lib/supply'

export const GET = withSupplyAdmin(async (req: NextRequest) => {
  const batchId = req.nextUrl.searchParams.get('batchId')
  if (!batchId) return NextResponse.json({ error: 'batchId is required' }, { status: 422 })

  const { data, error } = await db
    .from('supply_items')
    .select('*')
    .eq('batch_id', batchId)
    .order('quality_score', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
})

export const PATCH = withSupplyAdmin(async (req: NextRequest) => {
  const body = await req.json().catch(() => null) as {
    ids?: string[]
    patch?: Record<string, unknown>
  } | null

  if (!body?.ids?.length || !body.patch) {
    return NextResponse.json({ error: 'ids and patch are required' }, { status: 422 })
  }

  const allowed = new Set([
    'status',
    'shop_name',
    'shop_source_url',
    'listing_title',
    'listing_description',
    'price_cents',
    'currency',
    'condition',
    'listing_type',
    'category',
    'state',
    'municipio',
    'location',
    'source_url',
  ])

  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body.patch)) {
    if (!allowed.has(key)) continue
    if (key === 'status' && !SUPPLY_ITEM_STATUSES.includes(value as never)) continue
    if (key === 'listing_type' && !SUPPLY_LISTING_TYPES.includes(value as never)) continue
    if (key === 'price_cents') {
      patch.price_cents = normalizePriceCents(value as string | number | null)
    } else {
      patch[key] = typeof value === 'string' ? value.trim() || null : value
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No supported fields in patch' }, { status: 422 })
  }

  const { data: current } = await db
    .from('supply_items')
    .select('id, batch_id, listing_title, source_url, shop_name, price_cents, images, location, listing_description')
    .in('id', body.ids)

  if (!current?.length) return NextResponse.json({ error: 'No matching items' }, { status: 404 })

  if (body.ids.length === 1) {
    const row = current[0]
    const merged = { ...row, ...patch }
    patch.quality_score = qualityScore({
      listing_title: merged.listing_title as string | null,
      source_url: merged.source_url as string | null,
      shop_name: merged.shop_name as string | null,
      price_cents: merged.price_cents as number | null,
      images: (merged.images ?? []) as Array<{ url: string }>,
      location: merged.location as string | null,
      listing_description: merged.listing_description as string | null,
    })
  }

  const { error } = await db
    .from('supply_items')
    .update(patch)
    .in('id', body.ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const batchIds = [...new Set(current.map(row => row.batch_id as string))]
  for (const batchId of batchIds) await refreshBatchCounts(batchId)

  return NextResponse.json({ updated: body.ids.length })
})
