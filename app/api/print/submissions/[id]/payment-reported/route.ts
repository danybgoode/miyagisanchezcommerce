/**
 * POST /api/print/submissions/[id]/payment-reported
 * Buyer signals they've sent a manual (SPEI/DiMo/cash) payment. Flags the
 * submission and pings the admin to verify + confirm in the console.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getSellerByClerk } from '@/lib/print-server'
import { tgNotify } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })
  const jwt = await getToken()
  const seller = jwt ? await getSellerByClerk(jwt) : null
  if (!seller) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })

  const { data: sub } = await db.from('print_ad_submissions').select('*').eq('id', id).single()
  if (!sub) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  if (sub.seller_id !== seller.id) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })
  if (sub.status !== 'pending_payment') return NextResponse.json({ error: 'Este anuncio no está pendiente de pago.' }, { status: 422 })

  await db.from('print_ad_submissions')
    .update({ content: { ...(sub.content ?? {}), payment_reported: true, payment_reported_at: new Date().toISOString() } })
    .eq('id', id)

  tgNotify(`💸 Edición impresa: ${sub.buyer_email ?? seller.name} reporta pago — verificar y confirmar en /admin/print (anuncio ${id})`).catch(() => {})
  return NextResponse.json({ ok: true })
}
