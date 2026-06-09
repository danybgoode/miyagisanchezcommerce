/**
 * Event ticket state machine — the shared vocabulary for paid admission tickets
 * and free RSVP tickets.
 *
 * Tokens are opaque attendee credentials. Door scanners validate the token, not
 * a URL, and every mutation that marks attendance must pass through the
 * `redeemTicket` guard so a ticket is used exactly once.
 *
 * Pure + next-free: checkout, RSVP, roster, and tests can all share the same
 * invariants without importing Next.js server modules.
 */

export const EVENT_TICKET_METADATA_KEY = 'event_ticket'
export const EVENT_TICKETS_METADATA_KEY = 'event_tickets'
export const FREE_REGISTRATION_TICKET_METADATA_KEY = 'ticket'

export type TicketSource = 'paid' | 'free'
export type TicketRedemptionState = 'issued' | 'redeemed'

export interface EventTicket {
  version: 1
  token: string
  source: TicketSource
  state: TicketRedemptionState
  issued_at: string
  subject_id: string
  event_id?: string | null
  product_id?: string | null
  order_id?: string | null
  line_item_id?: string | null
  attendee_name?: string | null
  attendee_email?: string | null
  redeemed_at?: string | null
  redeemed_by?: string | null
}

export interface IssueTicketInput {
  source: TicketSource
  subjectId: string
  eventId?: string | null
  productId?: string | null
  orderId?: string | null
  lineItemId?: string | null
  attendeeName?: string | null
  attendeeEmail?: string | null
  existingTickets?: readonly EventTicket[] | null
  now?: string
  tokenFactory?: () => string
}

export type IssueTicketResult = {
  ticket: EventTicket
  created: boolean
}

export type RedeemTicketResult =
  | { ok: true; ticket: EventTicket }
  | { ok: false; error: 'already_redeemed' | 'illegal_transition' }

const TOKEN_PREFIX = 'tkt_'
const TOKEN_BYTES = 24

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function randomHex(bytes = TOKEN_BYTES): string {
  const out = new Uint8Array(bytes)
  const cryptoObject = globalThis.crypto
  if (!cryptoObject?.getRandomValues) {
    throw new Error('Secure random source unavailable for event ticket token minting.')
  }
  cryptoObject.getRandomValues(out)
  return Array.from(out, b => b.toString(16).padStart(2, '0')).join('')
}

export function mintTicketToken(tokenBytes = TOKEN_BYTES): string {
  return `${TOKEN_PREFIX}${randomHex(tokenBytes)}`
}

export function isTicketToken(value: unknown): value is string {
  return typeof value === 'string' && /^tkt_[a-f0-9]{32,}$/i.test(value)
}

export function readEventTicket(value: unknown): EventTicket | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const token = cleanString(raw.token)
  const source = raw.source === 'paid' || raw.source === 'free' ? raw.source : null
  const state = raw.state === 'issued' || raw.state === 'redeemed' ? raw.state : null
  const issuedAt = cleanString(raw.issued_at)
  const subjectId = cleanString(raw.subject_id)
  if (!isTicketToken(token) || !source || !state || !issuedAt || !subjectId) return null

  return {
    version: 1,
    token,
    source,
    state,
    issued_at: issuedAt,
    subject_id: subjectId,
    event_id: cleanString(raw.event_id),
    product_id: cleanString(raw.product_id),
    order_id: cleanString(raw.order_id),
    line_item_id: cleanString(raw.line_item_id),
    attendee_name: cleanString(raw.attendee_name),
    attendee_email: cleanString(raw.attendee_email),
    redeemed_at: cleanString(raw.redeemed_at),
    redeemed_by: cleanString(raw.redeemed_by),
  }
}

export function readEventTickets(value: unknown): EventTicket[] {
  if (!Array.isArray(value)) return []
  return value.map(readEventTicket).filter((ticket): ticket is EventTicket => !!ticket)
}

function ticketMatchesSubject(ticket: EventTicket, input: Pick<IssueTicketInput, 'source' | 'subjectId'>): boolean {
  return ticket.source === input.source && ticket.subject_id === input.subjectId
}

export function issueTicket(input: IssueTicketInput): IssueTicketResult {
  const existingTickets = readEventTickets(input.existingTickets)
  const existing = existingTickets.find(ticket => ticketMatchesSubject(ticket, input))
  if (existing) return { ticket: existing, created: false }

  const usedTokens = new Set(existingTickets.map(ticket => ticket.token))
  let token = input.tokenFactory?.() ?? mintTicketToken()
  for (let attempt = 0; usedTokens.has(token) && attempt < 5; attempt += 1) {
    token = input.tokenFactory?.() ?? mintTicketToken()
  }
  if (!isTicketToken(token) || usedTokens.has(token)) {
    throw new Error('Unable to mint a unique event ticket token.')
  }

  return {
    created: true,
    ticket: {
      version: 1,
      token,
      source: input.source,
      state: 'issued',
      issued_at: input.now ?? new Date().toISOString(),
      subject_id: input.subjectId,
      event_id: input.eventId ?? null,
      product_id: input.productId ?? null,
      order_id: input.orderId ?? null,
      line_item_id: input.lineItemId ?? null,
      attendee_name: input.attendeeName?.trim() || null,
      attendee_email: input.attendeeEmail?.trim().toLowerCase() || null,
      redeemed_at: null,
      redeemed_by: null,
    },
  }
}

export function canTransitionTicket(from: TicketRedemptionState, to: TicketRedemptionState): boolean {
  return from === 'issued' && to === 'redeemed'
}

export function redeemTicket(ticket: EventTicket, input: {
  now?: string
  redeemedBy?: string | null
} = {}): RedeemTicketResult {
  if (ticket.state === 'redeemed') return { ok: false, error: 'already_redeemed' }
  if (!canTransitionTicket(ticket.state, 'redeemed')) return { ok: false, error: 'illegal_transition' }

  return {
    ok: true,
    ticket: {
      ...ticket,
      state: 'redeemed',
      redeemed_at: input.now ?? new Date().toISOString(),
      redeemed_by: input.redeemedBy ?? null,
    },
  }
}

export function ticketQrPath(token: string): string {
  return `/api/events/tickets/${encodeURIComponent(token)}/qr`
}

export function eventTicketLineItemMetadata(ticket: EventTicket): {
  metadata: { [EVENT_TICKET_METADATA_KEY]: EventTicket }
} {
  return { metadata: { [EVENT_TICKET_METADATA_KEY]: ticket } }
}
