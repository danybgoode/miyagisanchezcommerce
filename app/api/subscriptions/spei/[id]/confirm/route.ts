/**
 * POST /api/subscriptions/spei/[id]/confirm
 * Seller confirms that SPEI payment was received → activates the subscription.
 * Protected by Clerk auth + shop ownership check.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { tg } from '@/lib/telegram'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  }

  const { id } = await params

  // ── Fetch subscription ────────────────────────────────────────────────────
  const { data: sub } = await db
    .from('marketplace_subscriptions')
    .select('id, status, shop_id, buyer_email, buyer_name, listing_id, marketplace_shops!inner(clerk_user_id, name)')
    .eq('id', id)
    .maybeSingle()

  if (!sub) {
    return NextResponse.json({ error: 'Suscripción no encontrada.' }, { status: 404 })
  }

  // ── Verify caller is the shop owner ──────────────────────────────────────
  const shop = sub.marketplace_shops as unknown as { clerk_user_id: string | null; name: string }
  if (shop.clerk_user_id !== userId) {
    return NextResponse.json({ error: 'Sin permisos para confirmar esta suscripción.' }, { status: 403 })
  }

  if (sub.status !== 'pending_confirmation') {
    return NextResponse.json({
      error: `Esta suscripción ya tiene estado "${sub.status}". Solo se pueden confirmar las pendientes.`,
    }, { status: 409 })
  }

  // ── Activate subscription ─────────────────────────────────────────────────
  await db
    .from('marketplace_subscriptions')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', id)

  // ── Notify buyer via Telegram ─────────────────────────────────────────────
  tg.alert(
    `✅ <b>Suscripción SPEI confirmada</b>\n` +
    `Comprador: ${sub.buyer_name ?? ''} (${sub.buyer_email})\n` +
    `Tienda: ${shop.name}\n` +
    `La suscripción está ahora activa.`,
  )

  return NextResponse.json({ ok: true, message: 'Suscripción activada correctamente.' })
}
