/**
 * POST /api/print/submissions/[id]/change-request
 * Buyer requests changes to a paid/approved ad (which they can't silently edit).
 * Records the request and pings the admin.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/supabase'
import { getSellerByClerk } from '@/lib/print-server'
import { tgNotify } from '@/lib/telegram'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { userId, getToken } = await auth()
  if (!userId) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { message?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }
  const message = (body.message ?? '').trim().slice(0, 1000)
  if (!message) return NextResponse.json({ error: 'Escribe qué quieres cambiar.' }, { status: 400 })

  const jwt = await getToken()
  const seller = jwt ? await getSellerByClerk(jwt) : null
  if (!seller) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })

  const { data: sub } = await db.from('print_ad_submissions').select('*').eq('id', id).single()
  if (!sub) return NextResponse.json({ error: 'No encontrado.' }, { status: 404 })
  if (sub.seller_id !== seller.id) return NextResponse.json({ error: 'Sin permiso.' }, { status: 403 })

  const prev = (sub.content?.change_requests as Array<unknown>) ?? []
  await db.from('print_ad_submissions')
    .update({ content: { ...(sub.content ?? {}), change_requests: [...prev, { message, at: new Date().toISOString() }] } })
    .eq('id', id)

  tgNotify(`✏️ Edición impresa: ${sub.buyer_email ?? seller.name} solicita cambios (anuncio ${id}): ${message}`).catch(() => {})
  return NextResponse.json({ ok: true })
}
