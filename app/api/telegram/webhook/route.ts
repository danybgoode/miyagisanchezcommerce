import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/supabase'
import { tgSend } from '@/lib/telegram'
import { parseStartCommand, isTokenExpired } from '@/lib/notifications/telegram-link'
import { checkRateLimit } from '@/lib/ratelimit'

/**
 * Telegram Bot API webhook (Granular Notifications · Sprint 2).
 *
 * Security (new inbound surface):
 *   • Verify the `X-Telegram-Bot-Api-Secret-Token` header equals TELEGRAM_WEBHOOK_SECRET.
 *     Per the live docs (https://core.telegram.org/bots/api#setwebhook) Telegram
 *     sends this header on EVERY webhook request when setWebhook was called with a
 *     `secret_token` — so a mismatch means the call did not come from our webhook.
 *   • Rate-limit by IP.
 *   • Linking tokens are single-use (deleted on redemption) + short-TTL.
 *
 * Only the `/start <token>` linking flow is handled; every other update is a
 * silent 200 (Telegram retries on non-2xx — never give it a reason to storm).
 */

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET

type TgUpdate = {
  message?: {
    text?: string
    chat?: { id?: number | string }
  }
}

export async function POST(req: NextRequest) {
  // 1. Secret-token gate — the real security boundary. If we have a secret
  // configured, the header must match; anything else is rejected.
  const provided = req.headers.get('x-telegram-bot-api-secret-token')
  if (!WEBHOOK_SECRET || provided !== WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 2. Parse the update. Any parse failure is a silent ack.
  let update: TgUpdate
  try {
    update = (await req.json()) as TgUpdate
  } catch {
    return NextResponse.json({ ok: true })
  }

  const text = update.message?.text
  const chatId = update.message?.chat?.id
  const token = parseStartCommand(text)

  // Not a /start <token> message → ignore (silent ack).
  if (!token || chatId == null) return NextResponse.json({ ok: true })

  const chatIdStr = String(chatId)

  // 3. Rate-limit redemption per chat — not per IP: every webhook call shares
  // Telegram's server IPs, so an IP bucket would throttle all sellers at once.
  // Per-chat caps a single user's /start spam without affecting anyone else.
  const rl = await checkRateLimit('telegram_webhook', chatIdStr)
  if (!rl.allowed) return NextResponse.json({ ok: true }, { status: 200 })

  try {
    // 4. Redeem the token: must exist and not be expired.
    const { data: row } = await db
      .from('telegram_link_tokens')
      .select('clerk_user_id, expires_at')
      .eq('token', token)
      .maybeSingle()

    if (!row || isTokenExpired(row.expires_at)) {
      // Burn an expired token if it was found, then nudge the user to retry.
      if (row) await db.from('telegram_link_tokens').delete().eq('token', token)
      await tgSend(chatIdStr, 'Este enlace ya expiró. Vuelve a tu configuración y genera uno nuevo. ⏳')
      return NextResponse.json({ ok: true })
    }

    // 5. Bind the seller's chat, single-use the token, confirm.
    await db.from('telegram_links').upsert(
      { clerk_user_id: row.clerk_user_id, chat_id: chatIdStr, linked_at: new Date().toISOString() },
      { onConflict: 'clerk_user_id' },
    )
    await db.from('telegram_link_tokens').delete().eq('token', token)

    await tgSend(
      chatIdStr,
      '¡Conectado! ✅ Ya puedes recibir aquí los avisos de tu tienda. Elige qué te llega por Telegram en tu configuración.',
    )
  } catch {
    // Never surface internal errors to Telegram (it would retry). Best-effort ack.
  }

  return NextResponse.json({ ok: true })
}
