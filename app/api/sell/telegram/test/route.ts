import { NextResponse } from 'next/server'
import { currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { tgSend } from '@/lib/telegram'

/**
 * "Enviar prueba" — send a test message to the seller's linked Telegram chat
 * (Granular Notifications · Sprint 2). Clerk-gated. 400 when not linked, so the
 * UI only offers it once a chat is connected.
 */
export async function POST() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const { data } = await db
    .from('telegram_links')
    .select('chat_id')
    .eq('clerk_user_id', user.id)
    .maybeSingle()

  if (!data?.chat_id) {
    return NextResponse.json({ error: 'Conecta Telegram primero.' }, { status: 400 })
  }

  await tgSend(
    data.chat_id,
    '🔔 <b>Prueba</b>\nTu Telegram está conectado a tu tienda de Miyagi Sánchez. Aquí te llegarán los avisos que actives.',
  )

  return NextResponse.json({ ok: true })
}
