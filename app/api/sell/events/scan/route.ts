import { NextRequest, NextResponse } from 'next/server'
import { isTicketToken } from '@/lib/event-ticket-state'
import { redeemFreeTicketForSeller } from '@/lib/event-tickets'
import { redeemPaidTicketForSeller, syncPaidTicketMirror } from '@/lib/paid-event-tickets'
import { resolveEventSeller } from '@/lib/events-seller'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const context = await resolveEventSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  let body: { token?: string }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Datos inválidos.' }, { status: 400 }) }

  const token = body.token?.trim()
  if (!isTicketToken(token)) return NextResponse.json({ status: 'not_found' }, { status: 404 })

  const free = await redeemFreeTicketForSeller({
    token,
    sellerShopId: context.shop.id,
    redeemedBy: context.userId,
  })
  if (free.status === 'valid') return NextResponse.json({ status: 'valid', source: 'free', ticket: free.ticket })
  if (free.status === 'already_used') return NextResponse.json({ status: 'already_used', source: 'free', ticket: free.ticket }, { status: 409 })
  if (free.status === 'wrong_seller') return NextResponse.json({ status: 'wrong_seller' }, { status: 403 })

  const paid = await redeemPaidTicketForSeller({
    token,
    sellerId: context.seller.id,
    redeemedBy: context.userId,
  })
  if (paid.status === 'valid') {
    await syncPaidTicketMirror({ sellerId: context.seller.id, ticket: paid.ticket })
    return NextResponse.json({ status: 'valid', source: 'paid', ticket: paid.ticket })
  }
  if (paid.status === 'already_used') return NextResponse.json({ status: 'already_used', source: 'paid', ticket: paid.ticket ?? null }, { status: 409 })
  if (paid.status === 'wrong_seller') return NextResponse.json({ status: 'wrong_seller' }, { status: 403 })
  if (paid.status === 'unavailable') return NextResponse.json({ status: 'unavailable' }, { status: 502 })

  return NextResponse.json({ status: 'not_found' }, { status: 404 })
}
