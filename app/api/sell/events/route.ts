import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { getEventStats, publicEventUrl, uniqueEventSlug } from '@/lib/events'
import { resolveEventSeller } from '@/lib/events-seller'
import type { MarketplaceEvent } from '@/lib/events-types'

export const dynamic = 'force-dynamic'

type EventPayload = {
  title?: string
  description?: string | null
  starts_at?: string | null
  venue_name?: string
  venue_address?: string | null
  capacity?: number | string | null
}

function clean(body: EventPayload) {
  const capacityValue = body.capacity === '' || body.capacity == null ? null : Number(body.capacity)
  return {
    title: body.title?.trim() ?? '',
    description: body.description?.trim() || null,
    starts_at: body.starts_at || null,
    venue_name: body.venue_name?.trim() ?? '',
    venue_address: body.venue_address?.trim() || null,
    capacity: capacityValue && Number.isFinite(capacityValue)
      ? Math.max(1, Math.min(100000, Math.floor(capacityValue)))
      : null,
  }
}

function validate(payload: ReturnType<typeof clean>): string | null {
  if (!payload.title) return 'title_required'
  if (!payload.venue_name) return 'venue_required'
  if (!payload.starts_at || Number.isNaN(new Date(payload.starts_at).getTime())) return 'starts_at_required'
  return null
}

async function withStats(event: MarketplaceEvent) {
  return {
    ...event,
    public_url: publicEventUrl(event.slug),
    stats: await getEventStats(event),
  }
}

export async function GET() {
  const context = await resolveEventSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data, error } = await db
    .from('marketplace_events')
    .select('*')
    .eq('shop_id', context.shop.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: 'No se pudieron cargar los eventos.' }, { status: 500 })

  const events = await Promise.all(((data ?? []) as MarketplaceEvent[]).map(withStats))
  return NextResponse.json({ events })
}

export async function POST(req: NextRequest) {
  const context = await resolveEventSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: EventPayload
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const payload = clean(body)
  const invalid = validate(payload)
  if (invalid) return NextResponse.json({ error: invalid }, { status: 422 })

  const slug = await uniqueEventSlug(payload.title)
  const { data, error } = await db
    .from('marketplace_events')
    .insert({
      ...payload,
      slug,
      shop_id: context.shop.id,
      medusa_seller_id: context.seller.id,
      created_by: context.userId,
      status: 'active',
    })
    .select('*')
    .single()

  if (error || !data) {
    console.error('[events] create failed:', error)
    return NextResponse.json({ error: 'No se pudo crear el evento.' }, { status: 500 })
  }

  return NextResponse.json({ event: await withStats(data as MarketplaceEvent) }, { status: 201 })
}
