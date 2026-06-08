import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import {
  createOrRefreshEventVerification,
  publicEventUrl,
  uniqueEventSlug,
  verifyEventRegistration,
} from '@/lib/events'
import type { MarketplaceEvent } from '@/lib/events-types'

export const dynamic = 'force-dynamic'

function authorized(req: NextRequest) {
  const configured = process.env.EVENTS_TICKETING_SMOKE_SECRET
  if (!configured) return { ok: false as const, status: 404 }
  if (req.headers.get('x-events-ticketing-test-secret') !== configured) return { ok: false as const, status: 401 }
  return { ok: true as const }
}

export async function POST(req: NextRequest) {
  const auth = authorized(req)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 404 ? 'Not found' : 'Unauthorized' }, { status: auth.status })

  let body: { keep?: boolean; register?: boolean } = {}
  try { body = await req.json() } catch {}

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .limit(1)
    .maybeSingle()

  if (!shop?.id) return NextResponse.json({ error: 'No shop available for test.' }, { status: 412 })

  const metadata = (shop.metadata ?? {}) as Record<string, unknown>
  const sellerId = String(metadata.medusa_seller_id ?? shop.id)
  const now = Date.now()
  const slug = await uniqueEventSlug(`eventos-smoke-${now}`)

  const { data: event, error } = await db
    .from('marketplace_events')
    .insert({
      shop_id: shop.id,
      medusa_seller_id: sellerId,
      slug,
      status: 'active',
      title: 'Evento de prueba RSVP',
      description: 'Evento temporal para probar la pagina publica.',
      venue_name: 'Foro Miyagi',
      venue_address: 'Centro, CDMX',
      starts_at: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
      capacity: 1,
      created_by: 'internal-test',
    })
    .select('*')
    .single()

  if (error || !event) return NextResponse.json({ error: 'Event test setup failed.' }, { status: 500 })

  const typed = event as MarketplaceEvent
  try {
    if (body.register === false) {
      const payload = {
        ok: true,
        event_id: typed.id,
        slug: typed.slug,
        public_url: publicEventUrl(typed.slug),
        created_event: true,
        first_registered: false,
        duplicate_idempotent: false,
        capacity_full: false,
        registered_count: 0,
      }
      if (!body.keep) {
        await db.from('marketplace_events').delete().eq('id', typed.id).eq('created_by', 'internal-test')
      }
      return NextResponse.json(payload)
    }

    const email = `events-smoke-${now}@example.com`
    const secondEmail = `events-smoke-full-${now}@example.com`

    await createOrRefreshEventVerification({
      event: typed,
      email,
      locale: 'es',
      codeOverride: 'EVT123',
      sendEmail: false,
    })
    const first = await verifyEventRegistration({
      event: typed,
      name: 'Registro Smoke',
      email,
      code: 'EVT123',
      locale: 'es',
      sendConfirmation: false,
    })
    const duplicate = await verifyEventRegistration({
      event: typed,
      name: 'Registro Smoke',
      email,
      code: 'BAD000',
      locale: 'es',
      sendConfirmation: false,
    })
    const blocked = await createOrRefreshEventVerification({
      event: typed,
      email: secondEmail,
      locale: 'es',
      codeOverride: 'EVT999',
      sendEmail: false,
    })

    const payload = {
      ok: true,
      event_id: typed.id,
      slug: typed.slug,
      public_url: publicEventUrl(typed.slug),
      created_event: !!typed.id,
      first_registered: first.ok === true,
      duplicate_idempotent: duplicate.ok === true && duplicate.alreadyRegistered === true,
      capacity_full: blocked.capacityFull === true,
      registered_count: first.stats?.registrations ?? 0,
    }

    if (!body.keep) {
      await db.from('marketplace_events').delete().eq('id', typed.id).eq('created_by', 'internal-test')
    }

    return NextResponse.json(payload)
  } finally {
    if (!body.keep) {
      await db.from('marketplace_events').delete().eq('id', typed.id).eq('created_by', 'internal-test')
    }
  }
}

export async function DELETE(req: NextRequest) {
  const auth = authorized(req)
  if (!auth.ok) return NextResponse.json({ error: auth.status === 404 ? 'Not found' : 'Unauthorized' }, { status: auth.status })

  let body: { event_id?: string; slug?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  if (!body.event_id && !body.slug) return NextResponse.json({ error: 'event_id requerido.' }, { status: 400 })

  let query = db
    .from('marketplace_events')
    .delete()
    .eq('created_by', 'internal-test')

  query = body.event_id ? query.eq('id', body.event_id) : query.eq('slug', body.slug!)
  await query

  return NextResponse.json({ ok: true })
}
