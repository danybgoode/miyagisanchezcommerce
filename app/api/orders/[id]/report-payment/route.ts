/**
 * POST /api/orders/[id]/report-payment
 *
 * Buyer nudge for a manual (SPEI/cash/DiMo) order: signals they've sent payment
 * so the seller verifies + confirms. Lightweight — pings the admin/seller channel.
 * The authoritative action is the seller's "Confirmar pago recibido" (which
 * captures the payment).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { tgNotify } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const user = await currentUser()
  const email = user?.emailAddresses?.[0]?.emailAddress ?? 'comprador'
  tgNotify(`💸 Pedido ${id}: ${email} avisa que ya hizo el pago (pago directo) — verifica y confírmalo en el panel del vendedor.`).catch(() => {})

  return NextResponse.json({ ok: true })
}
