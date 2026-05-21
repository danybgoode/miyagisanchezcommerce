/**
 * Cal.com shop connection
 *
 * POST  — validate API key, fetch event types, save connection
 * DELETE — disconnect (clear api_key + calcom metadata)
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import {
  getCalUser,
  getCalEventTypes,
  getCalBookingUrl,
  type CalcomShopSettings,
} from '@/lib/calcom'

// ── POST — connect ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { api_key?: string; event_type_id?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const apiKey = body.api_key?.trim()
  if (!apiKey) return NextResponse.json({ error: 'API key requerida.' }, { status: 422 })

  // ── Validate key against Cal.com ──────────────────────────────────────────
  let calUser, eventTypes
  try {
    ;[calUser, eventTypes] = await Promise.all([
      getCalUser(apiKey),
      getCalEventTypes(apiKey),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al conectar con Cal.com'
    return NextResponse.json({ error: `API key inválida: ${msg}` }, { status: 422 })
  }

  // If no event_type_id provided, return event types list so UI can show picker
  if (!body.event_type_id && eventTypes.length > 1) {
    return NextResponse.json({ step: 'pick_event_type', user: calUser, eventTypes })
  }

  // Pick the requested event type or default to first
  const eventType = body.event_type_id
    ? eventTypes.find(e => e.id === body.event_type_id) ?? eventTypes[0]
    : eventTypes[0]

  if (!eventType) {
    return NextResponse.json({ error: 'No encontramos tipos de evento en tu cuenta Cal.com. Crea al menos uno en cal.com.' }, { status: 422 })
  }

  // ── Fetch shop ────────────────────────────────────────────────────────────
  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  // ── Build calcom settings ─────────────────────────────────────────────────
  const calcomSettings: CalcomShopSettings = {
    connected:          true,
    username:           calUser.username,
    event_type_id:      eventType.id,
    event_type_slug:    eventType.slug,
    event_type_title:   eventType.title,
    event_duration_min: eventType.length,
    booking_url:        getCalBookingUrl(calUser.username, eventType.slug),
    connected_at:       new Date().toISOString(),
  }

  // Deep-merge into existing metadata
  const existingMeta     = (shop.metadata ?? {}) as Record<string, unknown>
  const existingSettings = (existingMeta.settings ?? {}) as Record<string, unknown>

  const { error } = await db
    .from('marketplace_shops')
    .update({
      calcom_api_key: apiKey,
      metadata: {
        ...existingMeta,
        settings: { ...existingSettings, calcom: calcomSettings },
      },
    })
    .eq('id', shop.id)

  if (error) {
    console.error('Cal.com save error:', error)
    return NextResponse.json({ error: 'Error al guardar la conexión.' }, { status: 500 })
  }

  return NextResponse.json({
    step:     'connected',
    username: calUser.username,
    eventType: {
      id:    eventType.id,
      slug:  eventType.slug,
      title: eventType.title,
    },
    bookingUrl: calcomSettings.booking_url,
  })
}

// ── DELETE — disconnect ────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data: shop } = await db
    .from('marketplace_shops')
    .select('id, metadata')
    .eq('clerk_user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (!shop) return NextResponse.json({ error: 'Tienda no encontrada.' }, { status: 404 })

  const existingMeta = (shop.metadata ?? {}) as Record<string, unknown>
  const existingSettings = (existingMeta.settings ?? {}) as Record<string, unknown>
  const { calcom: _removed, ...settingsWithout } = existingSettings as Record<string, unknown> & { calcom?: unknown }

  await db
    .from('marketplace_shops')
    .update({
      calcom_api_key: null,
      metadata: { ...existingMeta, settings: settingsWithout },
    })
    .eq('id', shop.id)

  return NextResponse.json({ ok: true })
}
