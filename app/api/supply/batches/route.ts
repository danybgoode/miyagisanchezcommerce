import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { withSupplyAdmin } from '@/lib/admin/guard'
import {
  googleLocalToSupplyItem,
  normalizeSupplyItem,
  refreshBatchCounts,
  SUPPLY_LISTING_TYPES,
  type IncomingSupplyItem,
} from '@/lib/supply'

async function collectGoogleLocal(body: {
  category?: string
  listing_type?: string
  state?: string
  municipio?: string
  location?: string
  acquisition_settings?: Record<string, unknown>
}) {
  const query = String(body.acquisition_settings?.query ?? '').trim()
  const location = String(body.location ?? body.state ?? 'Ciudad de México, Mexico').trim()
  const limit = Math.min(Math.max(Number(body.acquisition_settings?.limit ?? 20), 1), 40)

  if (!query) throw new Error('Google Local keyword search requires a search term.')
  if (!process.env.SERPAPI_KEY) throw new Error('SERPAPI_KEY is not configured.')

  const url = new URL('https://serpapi.com/search.json')
  url.searchParams.set('engine', 'google_local')
  url.searchParams.set('q', query)
  url.searchParams.set('location', location)
  url.searchParams.set('hl', 'es')
  url.searchParams.set('gl', 'mx')
  url.searchParams.set('api_key', process.env.SERPAPI_KEY)

  const res = await fetch(url.toString(), {
    cache: 'no-store',
    signal: AbortSignal.timeout(45000),
  })
  const data = await res.json().catch(() => ({})) as {
    error?: string
    local_results?: Parameters<typeof googleLocalToSupplyItem>[0][]
  }

  if (!res.ok || data.error) {
    throw new Error(data.error ?? `SerpAPI HTTP ${res.status}`)
  }

  return (data.local_results ?? []).slice(0, limit).map(result => googleLocalToSupplyItem(result, {
    source_platform: 'google_local',
    category: body.category ?? 'servicios',
    listing_type: 'service',
    state: body.state ?? null,
    municipio: body.municipio ?? null,
    location,
  }, query))
}

export const GET = withSupplyAdmin(async () => {
  const { data, error } = await db
    .from('supply_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ batches: data ?? [] })
})

export const POST = withSupplyAdmin(async (req: NextRequest) => {
  const body = await req.json().catch(() => null) as {
    name?: string
    source_platform?: string
    source_mode?: string
    category?: string
    listing_type?: string
    state?: string
    municipio?: string
    location?: string
    target_status?: string
    acquisition_settings?: Record<string, unknown>
    items?: IncomingSupplyItem[]
  } | null

  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const name = body.name?.trim()
  if (!name || name.length < 3) {
    return NextResponse.json({ error: 'Batch name must be at least 3 characters.' }, { status: 422 })
  }

  const listingType = SUPPLY_LISTING_TYPES.includes(body.listing_type as never)
    ? body.listing_type!
    : 'product'

  let collectedItems = body.items ?? []
  if (body.source_platform === 'google_local' && body.source_mode === 'keyword_geo') {
    try {
      collectedItems = await collectGoogleLocal(body)
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 422 })
    }
  }

  const { data: batch, error: batchErr } = await db
    .from('supply_batches')
    .insert({
      name,
      source_platform: body.source_platform ?? 'manual',
      source_mode: body.source_mode ?? 'csv',
      category: body.category || null,
      listing_type: listingType,
      state: body.state || null,
      municipio: body.municipio || null,
      location: body.location || null,
      target_status: body.target_status || 'active',
      acquisition_settings: body.acquisition_settings ?? {},
      status: 'reviewing',
    })
    .select('*')
    .single()

  if (batchErr || !batch) {
    return NextResponse.json({ error: batchErr?.message ?? 'Failed to create batch' }, { status: 500 })
  }

  const normalized = collectedItems
    .map(item => normalizeSupplyItem(item, {
      source_platform: batch.source_platform,
      category: batch.category,
      listing_type: batch.listing_type,
      state: batch.state,
      municipio: batch.municipio,
      location: batch.location,
    }))
    .filter(item => item.listing_title || item.source_url || item.shop_name)

  if (normalized.length > 0) {
    const { error: itemsErr } = await db
      .from('supply_items')
      .insert(normalized.map(item => ({ ...item, batch_id: batch.id })))

    if (itemsErr) {
      await db.from('supply_batches').update({
        status: 'failed',
        error_message: itemsErr.message,
      }).eq('id', batch.id)
      return NextResponse.json({ error: itemsErr.message, batch }, { status: 500 })
    }
  }

  const counts = await refreshBatchCounts(batch.id)
  return NextResponse.json({ batch: { ...batch, ...counts }, inserted: normalized.length }, { status: 201 })
})
