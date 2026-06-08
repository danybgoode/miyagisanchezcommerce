import { NextRequest, NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getBotUsername } from '@/lib/telegram'
import { genLinkToken, LINK_TOKEN_TTL_MS } from '@/lib/notifications/telegram-link'
import { audienceTelegramInUse, EVENT_GROUPS, type PrefRow } from '@/lib/notifications/preferences'
import { checkRateLimit, getClientIp } from '@/lib/ratelimit'

/**
 * Seller Telegram link control (Granular Notifications · Sprint 2).
 *   GET    → { linked, chatId? } — is this seller's Telegram connected?
 *   POST   → mint a single-use, short-TTL token and return its t.me deep link.
 *   DELETE → disconnect (clear the link).
 * Clerk-gated; anonymous → 401. The webhook (POST /api/telegram/webhook) redeems
 * the token and writes telegram_links once the seller sends /start in Telegram.
 */

export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data } = await db
    .from('telegram_links')
    .select('chat_id')
    .eq('clerk_user_id', user.id)
    .maybeSingle()

  return NextResponse.json({ linked: !!data, chatId: data?.chat_id ?? null })
}

export async function POST(req: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const rl = await checkRateLimit('telegram_link', `${user.id}:${getClientIp(req)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Demasiados intentos. Espera un momento.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const username = await getBotUsername()
  if (!username) {
    return NextResponse.json(
      { error: 'Telegram no está disponible por ahora. Inténtalo más tarde.' },
      { status: 503 },
    )
  }

  const token = genLinkToken()
  const { error } = await db.from('telegram_link_tokens').insert({
    token,
    clerk_user_id: user.id,
    expires_at: new Date(Date.now() + LINK_TOKEN_TTL_MS).toISOString(),
  })
  if (error) {
    return NextResponse.json({ error: 'No se pudo generar el enlace.' }, { status: 500 })
  }

  return NextResponse.json({ url: `https://t.me/${username}?start=${token}` })
}

export async function DELETE() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  // Per-audience-safe unlink (epic #5b): stop the SELLER's Telegram (turn off all
  // seller-group telegram prefs), then remove the shared chat row ONLY when the
  // buyer audience doesn't still use Telegram — so the person's buyer Telegram
  // (if any) keeps working. Symmetric to /api/account/telegram/link DELETE.
  await db
    .from('notification_preferences')
    .delete()
    .eq('clerk_user_id', user.id)
    .eq('channel', 'telegram')
    .in('event_group', [...EVENT_GROUPS])

  const { data } = await db
    .from('notification_preferences')
    .select('channel, event_group, enabled')
    .eq('clerk_user_id', user.id)

  let rowDeleted = false
  if (!audienceTelegramInUse((data as PrefRow[] | null) ?? [], 'buyer')) {
    const { error } = await db.from('telegram_links').delete().eq('clerk_user_id', user.id)
    if (error) return NextResponse.json({ error: 'No se pudo desconectar.' }, { status: 500 })
    rowDeleted = true
  }

  return NextResponse.json({ ok: true, rowDeleted })
}
