import { NextRequest, NextResponse } from 'next/server'
import { getFreeEventRoster } from '@/lib/event-tickets'
import { getSellerEvent, resolveEventSeller } from '@/lib/events-seller'
import { getPaidTicketRosterForSeller } from '@/lib/paid-event-tickets'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const context = await resolveEventSeller()
  if (!context) return NextResponse.json({ error: 'No autenticado.' }, { status: 401 })

  const freeEvent = await getSellerEvent(id)
  const [freeRows, paidRows] = await Promise.all([
    freeEvent ? getFreeEventRoster(id) : Promise.resolve([]),
    getPaidTicketRosterForSeller({ sellerId: context.seller.id, eventOrProductId: id }),
  ])

  return NextResponse.json({
    event: freeEvent?.event ?? null,
    roster: [...freeRows, ...paidRows],
  })
}
