/**
 * POST /api/orders/[id]/report-payment
 *
 * Buyer presses "Ya hice el pago" on a manual (SPEI/cash/DiMo) order. Two effects:
 *   1. Durably persists `buyer_reported_paid` on the Medusa order (the authoritative
 *      side-effect) so the state survives reload and both sides + agents read it.
 *   2. Pings the seller channel (Telegram) — best-effort nudge.
 * The authoritative confirmation is still the seller's "Confirmar pago recibido"
 * (which captures the payment).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { tgNotify } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_PUB_KEY = process.env.MEDUSA_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? ''

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  // ── Durable persist on the Medusa order (the authoritative effect) ──────────
  // Medusa-backed orders carry an "order_" id. Surface a real failure to the buyer
  // (their click must stick); legacy/non-Medusa ids fall through to the nudge only.
  if (id.startsWith('order_')) {
    try {
      const clerkJwt = await getToken()
      const res = await fetch(`${MEDUSA_BASE}/store/buyer/me/orders/${id}/report-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-publishable-api-key': MEDUSA_PUB_KEY,
          ...(clerkJwt ? { Authorization: `Bearer ${clerkJwt}` } : {}),
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string }
        return NextResponse.json(
          { error: data.message ?? 'No se pudo registrar tu aviso de pago.' },
          { status: res.status },
        )
      }
    } catch {
      return NextResponse.json({ error: 'Sin conexión. Inténtalo de nuevo.' }, { status: 502 })
    }
  }

  // ── Best-effort nudge to the seller channel ─────────────────────────────────
  const user = await currentUser()
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'comprador'
  tgNotify(`💸 Pedido ${id}: ${email} avisa que ya hizo el pago (pago directo) — verifica y confírmalo en el panel del vendedor.`).catch(() => {})

  return NextResponse.json({ ok: true })
}
