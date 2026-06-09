import 'server-only'

import { db } from '@/lib/supabase'
import {
  FREE_REGISTRATION_TICKET_METADATA_KEY,
  issueTicket,
  readEventTicket,
  redeemTicket,
  ticketQrPath,
  type EventTicket,
} from '@/lib/event-ticket-state'
import type { MarketplaceEvent, MarketplaceEventRegistration } from '@/lib/events-types'

export type EventRosterRow = {
  id: string
  source: 'free' | 'paid'
  attendee_name: string | null
  attendee_email: string | null
  ticket_token: string | null
  state: 'issued' | 'redeemed' | 'missing'
  issued_at: string | null
  redeemed_at: string | null
}

export type FreeTicketRedeemResult =
  | { status: 'valid'; ticket: EventTicket; registration: MarketplaceEventRegistration }
  | { status: 'already_used'; ticket: EventTicket; registration: MarketplaceEventRegistration }
  | { status: 'not_found' }
  | { status: 'wrong_seller' }

export function absoluteTicketQrUrl(siteUrl: string, token: string): string {
  return `${siteUrl.replace(/\/+$/, '')}${ticketQrPath(token)}`
}

function registrationMetadata(registration: Pick<MarketplaceEventRegistration, 'metadata'>): Record<string, unknown> {
  return (registration.metadata ?? {}) as Record<string, unknown>
}

export function ticketFromRegistration(registration: Pick<MarketplaceEventRegistration, 'metadata'>): EventTicket | null {
  return readEventTicket(registrationMetadata(registration)[FREE_REGISTRATION_TICKET_METADATA_KEY])
}

export async function ensureFreeRegistrationTicket(input: {
  event: MarketplaceEvent
  registration: MarketplaceEventRegistration
  now?: string
}): Promise<MarketplaceEventRegistration> {
  const existing = ticketFromRegistration(input.registration)
  if (existing) return input.registration

  const issued = issueTicket({
    source: 'free',
    subjectId: input.registration.id,
    eventId: input.event.id,
    attendeeName: input.registration.name,
    attendeeEmail: input.registration.email,
    now: input.now,
  }).ticket
  const metadata = {
    ...registrationMetadata(input.registration),
    [FREE_REGISTRATION_TICKET_METADATA_KEY]: issued,
  }

  const { data, error } = await db
    .from('marketplace_event_registrations')
    .update({ metadata })
    .eq('id', input.registration.id)
    .select('*')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'event ticket issue failed')
  return data as MarketplaceEventRegistration
}

export async function redeemFreeTicketForSeller(input: {
  token: string
  sellerShopId: string
  redeemedBy: string
  now?: string
}): Promise<FreeTicketRedeemResult> {
  const { data } = await db
    .from('marketplace_event_registrations')
    .select('*, marketplace_events!inner(id, shop_id)')
    .eq('metadata->ticket->>token', input.token)
    .maybeSingle()

  if (!data) return { status: 'not_found' }

  const registration = data as MarketplaceEventRegistration & {
    marketplace_events?: { id: string; shop_id: string } | { id: string; shop_id: string }[]
  }
  const events = registration.marketplace_events
  const event = Array.isArray(events) ? events[0] : events
  if (!event || event.shop_id !== input.sellerShopId) return { status: 'wrong_seller' }

  const currentTicket = ticketFromRegistration(registration)
  if (!currentTicket) return { status: 'not_found' }

  const redeemed = redeemTicket(currentTicket, {
    now: input.now,
    redeemedBy: input.redeemedBy,
  })
  if (!redeemed.ok) {
    return { status: 'already_used', ticket: currentTicket, registration }
  }

  const nextMetadata = {
    ...registrationMetadata(registration),
    [FREE_REGISTRATION_TICKET_METADATA_KEY]: redeemed.ticket,
  }

  const { data: updated } = await db
    .from('marketplace_event_registrations')
    .update({ metadata: nextMetadata })
    .eq('id', registration.id)
    .eq('metadata->ticket->>state', 'issued')
    .select('*')
    .maybeSingle()

  if (!updated) {
    return { status: 'already_used', ticket: currentTicket, registration }
  }

  return {
    status: 'valid',
    ticket: redeemed.ticket,
    registration: updated as MarketplaceEventRegistration,
  }
}

export async function getFreeEventRoster(eventId: string): Promise<EventRosterRow[]> {
  const { data } = await db
    .from('marketplace_event_registrations')
    .select('*')
    .eq('event_id', eventId)
    .eq('status', 'registered')
    .not('verified_at', 'is', null)
    .order('created_at', { ascending: true })

  return ((data ?? []) as MarketplaceEventRegistration[]).map((registration) => {
    const ticket = ticketFromRegistration(registration)
    return {
      id: registration.id,
      source: 'free',
      attendee_name: registration.name,
      attendee_email: registration.email,
      ticket_token: ticket?.token ?? null,
      state: ticket?.state ?? 'missing',
      issued_at: ticket?.issued_at ?? null,
      redeemed_at: ticket?.redeemed_at ?? null,
    }
  })
}
