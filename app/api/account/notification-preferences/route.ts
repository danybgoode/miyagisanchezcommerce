import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import {
  resolveBuyerPrefs,
  isBuyerForcedCell,
  BUYER_EVENT_GROUPS,
  CHANNELS,
  type PrefRow,
  type BuyerEventGroup,
  type Channel,
} from '@/lib/notifications/preferences'

/**
 * Buyer notification-preference center backing API (epic #5b).
 *   GET   → the buyer's resolved grid (BUYER_DEFAULT_PREFS overlaid with their
 *           buyer-namespaced rows; the Compras×Email receipt cell is forced-on).
 *   PATCH → upsert a single { channel, event_group, enabled } buyer cell.
 *
 * The buyer twin of /api/sell/notification-preferences — same sparse store, same
 * Clerk gate (anonymous → 401), but the `event_group` is buyer-namespaced
 * (`buyer.*`) so a person who is both buyer and seller keeps independent grids in
 * one table. Two writes are refused:
 *   • the FORCED receipt cell (buyer.compras × email) — can never be turned off;
 *   • Telegram — no buyer link flow until Sprint 2 (a channel that can't deliver
 *     can't be enabled).
 */

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data } = await db
    .from('notification_preferences')
    .select('channel, event_group, enabled')
    .eq('clerk_user_id', user.id)

  return NextResponse.json({ prefs: resolveBuyerPrefs((data as PrefRow[] | null) ?? []) })
}

export async function PATCH(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { channel?: unknown; event_group?: unknown; enabled?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }

  const { channel, event_group, enabled } = body
  const validChannel = typeof channel === 'string' && (CHANNELS as readonly string[]).includes(channel)
  const validGroup =
    typeof event_group === 'string' && (BUYER_EVENT_GROUPS as readonly string[]).includes(event_group)
  if (!validChannel || !validGroup || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Parámetros inválidos.' }, { status: 400 })
  }

  // The receipt cell is forced-on in the resolver — reject any attempt to flip it
  // (defence in depth: the resolver would override it anyway, but we never persist
  // a misleading row, and the UI renders it locked).
  if (isBuyerForcedCell(event_group as BuyerEventGroup, channel as Channel)) {
    return NextResponse.json(
      { error: 'El recibo de compra y pago siempre se envía por correo.' },
      { status: 400 },
    )
  }

  // Telegram is only togglable once the buyer links a chat — a channel that can't
  // deliver can't be enabled. (Mirrors the seller route.)
  if (channel === 'telegram') {
    const { data: link } = await db
      .from('telegram_links')
      .select('chat_id')
      .eq('clerk_user_id', user.id)
      .maybeSingle()
    if (!link) {
      return NextResponse.json({ error: 'Conecta Telegram para activar este canal.' }, { status: 400 })
    }
  }

  const { error } = await db.from('notification_preferences').upsert(
    {
      clerk_user_id: user.id,
      channel,
      event_group,
      enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'clerk_user_id,channel,event_group' },
  )
  if (error) return NextResponse.json({ error: 'No se pudo guardar.' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
