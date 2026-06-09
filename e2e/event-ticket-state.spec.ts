import { test, expect } from '@playwright/test'
import {
  canTransitionTicket,
  issueTicket,
  readEventTicket,
  redeemTicket,
} from '../lib/event-ticket-state'

function tokenSeq() {
  let n = 0
  return () => `tkt_${(++n).toString(16).padStart(48, '0')}`
}

test.describe('events and ticketing · ticket state', () => {
  test('mints unique opaque tokens for different attendees', () => {
    const makeToken = tokenSeq()
    const first = issueTicket({
      source: 'free',
      subjectId: 'registration_a',
      eventId: 'event_1',
      now: '2026-06-08T18:00:00.000Z',
      tokenFactory: makeToken,
    }).ticket
    const second = issueTicket({
      source: 'free',
      subjectId: 'registration_b',
      eventId: 'event_1',
      now: '2026-06-08T18:00:00.000Z',
      tokenFactory: makeToken,
    }).ticket

    expect(first.token).toMatch(/^tkt_[a-f0-9]{32,}$/)
    expect(second.token).toMatch(/^tkt_[a-f0-9]{32,}$/)
    expect(first.token).not.toBe(second.token)
  })

  test('re-issue is idempotent for the same attendee', () => {
    const makeToken = tokenSeq()
    const first = issueTicket({
      source: 'paid',
      subjectId: 'line_item_1',
      productId: 'prod_event',
      orderId: 'order_1',
      now: '2026-06-08T18:00:00.000Z',
      tokenFactory: makeToken,
    })
    const again = issueTicket({
      source: 'paid',
      subjectId: 'line_item_1',
      productId: 'prod_event',
      orderId: 'order_1',
      existingTickets: [first.ticket],
      now: '2026-06-08T19:00:00.000Z',
      tokenFactory: makeToken,
    })

    expect(first.created).toBe(true)
    expect(again.created).toBe(false)
    expect(again.ticket.token).toBe(first.ticket.token)
    expect(again.ticket.issued_at).toBe(first.ticket.issued_at)
  })

  test('retries when a new attendee would collide with an existing token', () => {
    const existing = issueTicket({
      source: 'free',
      subjectId: 'registration_a',
      eventId: 'event_1',
      now: '2026-06-08T18:00:00.000Z',
      tokenFactory: tokenSeq(),
    }).ticket
    let calls = 0
    const next = issueTicket({
      source: 'free',
      subjectId: 'registration_b',
      eventId: 'event_1',
      existingTickets: [existing],
      now: '2026-06-08T18:00:00.000Z',
      tokenFactory: () => {
        calls += 1
        return calls === 1 ? existing.token : 'tkt_ffffffffffffffffffffffffffffffffffffffffffffffff'
      },
    }).ticket

    expect(next.token).not.toBe(existing.token)
    expect(next.token).toBe('tkt_ffffffffffffffffffffffffffffffffffffffffffffffff')
  })

  test('rejects illegal transitions and double redemption', () => {
    const ticket = issueTicket({
      source: 'free',
      subjectId: 'registration_a',
      eventId: 'event_1',
      now: '2026-06-08T18:00:00.000Z',
      tokenFactory: tokenSeq(),
    }).ticket

    expect(canTransitionTicket('issued', 'redeemed')).toBe(true)
    expect(canTransitionTicket('redeemed', 'issued')).toBe(false)

    const redeemed = redeemTicket(ticket, {
      now: '2026-06-08T18:05:00.000Z',
      redeemedBy: 'seller_1',
    })
    expect(redeemed.ok).toBe(true)
    if (!redeemed.ok) throw new Error('expected redemption to pass')
    expect(redeemed.ticket.state).toBe('redeemed')
    expect(redeemed.ticket.redeemed_by).toBe('seller_1')

    const doubleRedeem = redeemTicket(redeemed.ticket, {
      now: '2026-06-08T18:06:00.000Z',
      redeemedBy: 'seller_1',
    })
    expect(doubleRedeem).toEqual({ ok: false, error: 'already_redeemed' })
  })

  test('ignores malformed metadata instead of treating it as a ticket', () => {
    expect(readEventTicket({ token: 'https://miyagisanchez.com/e/demo', state: 'issued' })).toBeNull()
    expect(readEventTicket({ token: 'tkt_short', state: 'issued' })).toBeNull()
  })
})
