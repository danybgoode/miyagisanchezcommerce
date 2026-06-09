import { test, expect } from '@playwright/test'
import { offerTurn, offerStatusLabel, type OfferStatus } from '../lib/offers'

/**
 * Trust & Messaging Polish · Sprint 1 (C.3). Pure-logic guards on the negotiation
 * turn-owner + deadline derivation — the single source the chat offer panel AND the
 * transaction-ledger negotiation row read, so "whose turn is it" is never re-inferred
 * from which buttons render. No network/auth; deterministic.
 *
 * Also pins the honest deadline mapping (pending → expires_at, the 48h field; counter
 * → counter_expires_at, 24h; accepted → checkout_expires_at) — the same window the
 * MakeOfferButton copy must not contradict (the 48h/<24h lie this sprint fixes).
 */

const FUTURE_EXPIRES = new Date(Date.now() + 48 * 3600_000).toISOString()
const FUTURE_COUNTER = new Date(Date.now() + 24 * 3600_000).toISOString()
const FUTURE_CHECKOUT = new Date(Date.now() + 12 * 3600_000).toISOString()
const PAST = new Date(Date.now() - 1000).toISOString()

const base = {
  expires_at: FUTURE_EXPIRES,
  counter_expires_at: FUTURE_COUNTER,
  checkout_expires_at: FUTURE_CHECKOUT,
}

test.describe('offerTurn · pending (seller responds, 48h)', () => {
  test('seller acts next against expires_at', () => {
    const t = offerTurn({ status: 'pending', ...base }, 'seller')
    expect(t.line).toBe('Te toca responder')
    expect(t.deadlineIso).toBe(FUTURE_EXPIRES)
  })
  test('buyer waits, same 48h deadline', () => {
    const t = offerTurn({ status: 'pending', ...base }, 'buyer')
    expect(t.line).toBe('Esperando al vendedor')
    expect(t.deadlineIso).toBe(FUTURE_EXPIRES)
  })
  test('expired pending → no live deadline', () => {
    const t = offerTurn({ status: 'pending', ...base, expires_at: PAST }, 'seller')
    expect(t.line).toBe('Oferta expirada')
    expect(t.deadlineIso).toBeNull()
  })
})

test.describe('offerTurn · countered (buyer responds, 24h)', () => {
  test('buyer acts next against counter_expires_at', () => {
    const t = offerTurn({ status: 'countered', ...base }, 'buyer')
    expect(t.line).toBe('Te toca responder')
    expect(t.deadlineIso).toBe(FUTURE_COUNTER)
  })
  test('seller waits', () => {
    const t = offerTurn({ status: 'countered', ...base }, 'seller')
    expect(t.line).toBe('Esperando tu respuesta')
  })
  test('expired counter → no live deadline', () => {
    const t = offerTurn({ status: 'countered', ...base, counter_expires_at: PAST }, 'buyer')
    expect(t.line).toBe('Contraoferta expirada')
    expect(t.deadlineIso).toBeNull()
  })
})

test.describe('offerTurn · accepted (buyer pays, checkout window)', () => {
  test('buyer pays against checkout_expires_at', () => {
    const t = offerTurn({ status: 'accepted', ...base }, 'buyer')
    expect(t.line).toBe('Te toca pagar')
    expect(t.deadlineIso).toBe(FUTURE_CHECKOUT)
  })
  test('seller waits for payment', () => {
    const t = offerTurn({ status: 'accepted', ...base }, 'seller')
    expect(t.line).toBe('Esperando el pago del comprador')
  })
})

test.describe('offerTurn · terminal states carry no deadline', () => {
  for (const status of ['paid', 'declined', 'withdrawn', 'expired'] as OfferStatus[]) {
    test(`${status} → line set, deadline null`, () => {
      const t = offerTurn({ status, ...base }, 'buyer')
      expect(t.line.length).toBeGreaterThan(0)
      expect(t.deadlineIso).toBeNull()
    })
  }
})

test.describe('offerStatusLabel · completeness', () => {
  test('every status has a non-empty es-MX label', () => {
    const all: OfferStatus[] = ['pending', 'countered', 'accepted', 'declined', 'expired', 'withdrawn', 'paid']
    for (const s of all) expect(offerStatusLabel(s).trim().length, s).toBeGreaterThan(0)
  })
})
