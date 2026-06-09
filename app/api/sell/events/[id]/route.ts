import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { getEventStats, publicEventUrl } from '@/lib/events'
import { getSellerEvent } from '@/lib/events-seller'
import type { MarketplaceEvent } from '@/lib/events-types'

export const dynamic = 'force-dynamic'

type EventPayload = {
  title?: string
  description?: string | null
  starts_at?: string | null
  venue_name?: string
  venue_address?: string | null
  capacity?: number | string | null
  status?: 'active' | 'cancelled'
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
    status: body.status === 'cancelled' ? 'cancelled' : 'active',
  }
}

function validate(payload: ReturnType<typeof clean>): string | null {
  if (!payload.title) return 'title_required'
  if (!payload.venue_name) return 'venue_required'
  if (!payload.starts_at || Number.isNaN(new Date(payload.starts_at).getTime())) return 'starts_at_required'
  return null
}

async function responseEvent(event: MarketplaceEvent) {
  return {
    ...event,
    public_url: publicEventUrl(event.slug),
    stats: await getEventStats(event),
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const found = await getSellerEvent(id)
  if (!found) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })

  let body: EventPayload
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const payload = clean(body)
  const invalid = validate(payload)
  if (invalid) return NextResponse.json({ error: invalid }, { status: 422 })

  const { data, error } = await db
    .from('marketplace_events')
    .update(payload)
    .eq('id', found.event.id)
    .eq('shop_id', found.event.shop_id)
    .select('*')
    .single()

  if (error || !data) {
    console.error('[events] update failed:', error)
    return NextResponse.json({ error: 'No se pudo guardar el evento.' }, { status: 500 })
  }

  return NextResponse.json({ event: await responseEvent(data as MarketplaceEvent) })
}
