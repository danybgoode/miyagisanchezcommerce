import 'server-only'

import { db } from '@/lib/supabase'
import { EVENT_TICKETS_METADATA_KEY, isTicketToken, readEventTickets, type EventTicket } from '@/lib/event-ticket-state'
import type { EventRosterRow } from '@/lib/event-tickets'

const MEDUSA_BASE = process.env.MEDUSA_STORE_URL ?? 'http://localhost:9000'
const MEDUSA_INTERNAL_SECRET = process.env.MEDUSA_INTERNAL_SECRET ?? ''

export type PaidTicketRedeemResult =
  | { status: 'valid'; ticket: EventTicket }
  | { status: 'already_used'; ticket?: EventTicket | null }
  | { status: 'not_found' }
  | { status: 'wrong_seller' }
  | { status: 'unavailable' }

export async function issuePaidTicketsForOrder(orderId: string): Promise<EventTicket[]> {
  if (!MEDUSA_INTERNAL_SECRET) return []

  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/events-ticketing/orders/${encodeURIComponent(orderId)}/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': MEDUSA_INTERNAL_SECRET,
      },
    })
    if (!res.ok) {
      console.error('[event-tickets] paid issue failed:', orderId, res.status)
      return []
    }
    const data = await res.json().catch(() => ({})) as { tickets?: unknown }
    return readEventTickets(data.tickets)
  } catch (e) {
    console.error('[event-tickets] paid issue failed:', e)
    return []
  }
}

export async function redeemPaidTicketForSeller(input: {
  token: string
  sellerId: string
  redeemedBy: string
}): Promise<PaidTicketRedeemResult> {
  if (!MEDUSA_INTERNAL_SECRET || !isTicketToken(input.token)) return { status: 'not_found' }

  try {
    const res = await fetch(`${MEDUSA_BASE}/internal/events-ticketing/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': MEDUSA_INTERNAL_SECRET,
      },
      body: JSON.stringify(input),
    })
    const data = await res.json().catch(() => ({})) as PaidTicketRedeemResult
    if (res.status === 409) return {
      status: 'already_used',
      ticket: 'ticket' in data ? data.ticket ?? null : null,
    }
    if (res.status === 403) return { status: 'wrong_seller' }
    if (res.status === 404) return { status: 'not_found' }
    if (!res.ok) return { status: 'unavailable' }
    return data
  } catch (e) {
    console.error('[event-tickets] paid redeem failed:', e)
    return { status: 'unavailable' }
  }
}

export async function getPaidTicketRosterForSeller(input: {
  sellerId: string
  eventOrProductId: string
}): Promise<EventRosterRow[]> {
  const { data } = await db
    .from('marketplace_orders')
    .select('id, listing_id, buyer_name, buyer_email, metadata')
    .eq('shop_id', input.sellerId)
    .order('created_at', { ascending: true })

  return ((data ?? []) as Array<{
    id: string
    listing_id: string | null
    buyer_name: string | null
    buyer_email: string | null
    metadata: Record<string, unknown> | null
  }>).flatMap(order => {
    const tickets = readEventTickets(order.metadata?.[EVENT_TICKETS_METADATA_KEY])
      .filter(ticket =>
        ticket.event_id === input.eventOrProductId ||
        ticket.product_id === input.eventOrProductId ||
        order.listing_id === input.eventOrProductId
      )

    return tickets.map(ticket => ({
      id: `${order.id}:${ticket.token}`,
      source: 'paid' as const,
      attendee_name: ticket.attendee_name ?? order.buyer_name,
      attendee_email: ticket.attendee_email ?? order.buyer_email,
      ticket_token: ticket.token,
      state: ticket.state,
      issued_at: ticket.issued_at,
      redeemed_at: ticket.redeemed_at ?? null,
    }))
  })
}

export async function syncPaidTicketMirror(input: {
  sellerId: string
  ticket: EventTicket
}): Promise<void> {
  if (!input.ticket.order_id) return

  const { data } = await db
    .from('marketplace_orders')
    .select('id, metadata')
    .eq('shop_id', input.sellerId)
    .eq('metadata->>medusa_order_id', input.ticket.order_id)
    .maybeSingle()

  if (!data) return
  const metadata = (data.metadata ?? {}) as Record<string, unknown>
  const tickets = readEventTickets(metadata[EVENT_TICKETS_METADATA_KEY])
  if (!tickets.some(ticket => ticket.token === input.ticket.token)) return

  await db
    .from('marketplace_orders')
    .update({
      metadata: {
        ...metadata,
        [EVENT_TICKETS_METADATA_KEY]: tickets.map(ticket =>
          ticket.token === input.ticket.token ? input.ticket : ticket
        ),
      },
    })
    .eq('id', data.id)
}
