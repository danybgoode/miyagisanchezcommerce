import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import {
  resolvePrefs,
  EVENT_GROUPS,
  CHANNELS,
  type PrefRow,
} from '@/lib/notifications/preferences'

/**
 * Seller notification-preference center backing API.
 *   GET   → the seller's resolved grid (DEFAULT_PREFS overlaid with their rows).
 *   PATCH → upsert a single { channel, event_group, enabled } cell.
 * Auth-gated (Clerk). Anonymous → 401. The store is sparse: only explicit
 * toggles persist; absent cells resolve to enabled (default-on, zero regression).
 */

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data } = await db
    .from('notification_preferences')
    .select('channel, event_group, enabled')
    .eq('clerk_user_id', user.id)

  return NextResponse.json({ prefs: resolvePrefs((data as PrefRow[] | null) ?? []) })
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
  const validGroup = typeof event_group === 'string' && (EVENT_GROUPS as readonly string[]).includes(event_group)
  if (!validChannel || !validGroup || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Parámetros inválidos.' }, { status: 400 })
  }

  // Telegram isn't togglable until the seller links a chat (Sprint 2). Keep the
  // column inert so a stray write can't enable a channel that can't deliver.
  if (channel === 'telegram') {
    return NextResponse.json({ error: 'Conecta Telegram para activar este canal.' }, { status: 400 })
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
