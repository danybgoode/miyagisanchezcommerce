import { test, expect } from '@playwright/test'
import { buildTransactionLedger, type LedgerOffer, type LedgerOrder } from '../lib/transaction-ledger'

/**
 * Trust & Messaging Polish · Sprint 1 (C.1). Pure-logic guards on the read-only
 * transaction-ledger projection — the single view the chat card (buyer + seller)
 * reads. No network/auth; deterministic. Proves: the dominant-stage precedence
 * (refund > payment > negotiation), the timeline ordering + row statuses, the
 * read-only action intents, and — critically — graceful degrade (offer-only,
 * no-refund, missing-order).
 */

const FUTURE = new Date(Date.now() + 48 * 3600_000).toISOString()
const PAST = new Date(Date.now() - 1000).toISOString()

function offer(over: Partial<LedgerOffer> = {}): LedgerOffer {
  return {
    status: 'pending',
    offer_amount_cents: 100_00,
    counter_amount_cents: null,
    expires_at: FUTURE,
    counter_expires_at: null,
    checkout_expires_at: null,
    currency: 'MXN',
    ...over,
  }
}

test.describe('transaction-ledger · graceful degrade', () => {
  test('no offer AND no order → empty view, no rows, no action', () => {
    const v = buildTransactionLedger({ role: 'buyer' })
    expect(v.isEmpty).toBe(true)
    expect(v.stage).toBe('empty')
    expect(v.timeline).toEqual([])
    expect(v.action).toBeNull()
  })

  test('offer-only (no order) → negotiation view, only a negotiation row', () => {
    const v = buildTransactionLedger({ offer: offer(), role: 'seller' })
    expect(v.isEmpty).toBe(false)
    expect(v.stage).toBe('negotiation')
    expect(v.timeline.map(r => r.key)).toEqual(['negotiation'])
    expect(v.action).toBeNull()
  })

  test('order with NO return request → no refund row (null-safe)', () => {
    const order: LedgerOrder = { payment_method: 'spei', payment_received: true, status: 'delivered' }
    const v = buildTransactionLedger({ order, role: 'buyer' })
    expect(v.timeline.some(r => r.key === 'refund')).toBe(false)
    expect(v.stage).not.toBe('refund')
  })

  test('order that fails to resolve fields still projects (missing-order tolerant)', () => {
    // A mirror-only order (no medusa enrich) → only status/metadata present.
    const v = buildTransactionLedger({ order: { status: 'paid', metadata: {} }, role: 'buyer' })
    expect(v.isEmpty).toBe(false)
    expect(v.timeline.map(r => r.key)).toContain('payment')
  })
})

test.describe('transaction-ledger · negotiation turn-owner', () => {
  test('pending offer: seller acts next, buyer waits — with the 48h deadline', () => {
    const seller = buildTransactionLedger({ offer: offer(), role: 'seller' })
    expect(seller.whoActsNext).toBe('Te toca responder')
    expect(seller.deadlineIso).toBe(FUTURE)
    expect(seller.badge).toBe('Oferta enviada')

    const buyer = buildTransactionLedger({ offer: offer(), role: 'buyer' })
    expect(buyer.whoActsNext).toBe('Esperando al vendedor')
    expect(buyer.deadlineIso).toBe(FUTURE)
  })

  test('countered offer: buyer acts next against the counter deadline', () => {
    const o = offer({ status: 'countered', counter_amount_cents: 80_00, counter_expires_at: FUTURE })
    const buyer = buildTransactionLedger({ offer: o, role: 'buyer' })
    expect(buyer.whoActsNext).toBe('Te toca responder')
    expect(buyer.deadlineIso).toBe(FUTURE)
    const seller = buildTransactionLedger({ offer: o, role: 'seller' })
    expect(seller.whoActsNext).toBe('Esperando tu respuesta')
  })

  test('expired pending offer → no live deadline', () => {
    const v = buildTransactionLedger({ offer: offer({ expires_at: PAST }), role: 'seller' })
    expect(v.deadlineIso).toBeNull()
    expect(v.whoActsNext).toBe('Oferta expirada')
  })
})

test.describe('transaction-ledger · payment stage (projects #3b)', () => {
  test('manual order, nothing reported → buyer pays (read-only deep-link intent)', () => {
    const order: LedgerOrder = { payment_method: 'spei', status: 'paid', metadata: {} }
    const v = buildTransactionLedger({ order, role: 'buyer' })
    expect(v.stage).toBe('payment')
    expect(v.badge).toBe('Pago pendiente')
    expect(v.whoActsNext).toBe('Paga ahora')
    expect(v.action).toEqual({ kind: 'pay', label: 'Ya hice el pago' })
    // payment row current, fulfillment still pending
    expect(v.timeline.find(r => r.key === 'payment')?.status).toBe('current')
    expect(v.timeline.find(r => r.key === 'fulfillment')?.status).toBe('pending')
  })

  test('buyer reported paid → seller confirms (deep-link, not in-chat mutation)', () => {
    const order: LedgerOrder = { payment_method: 'spei', buyer_reported_paid: true, status: 'paid' }
    const v = buildTransactionLedger({ order, role: 'seller' })
    expect(v.badge).toBe('Pago reportado — en verificación')
    expect(v.action).toEqual({ kind: 'confirm-payment', label: 'Confirmar pago' })
  })

  test('manual order confirmed + fulfilling → fulfillment stage, payment row done', () => {
    const order: LedgerOrder = { payment_method: 'spei', payment_received: true, status: 'processing' }
    const v = buildTransactionLedger({ order, role: 'seller' })
    expect(v.stage).toBe('fulfillment')
    expect(v.timeline.find(r => r.key === 'payment')?.status).toBe('done')
    expect(v.timeline.find(r => r.key === 'fulfillment')?.status).toBe('current')
  })

  test('card/MP order → payment already settled (no manual badge)', () => {
    const order: LedgerOrder = { payment_method: 'stripe', status: 'shipped' }
    const v = buildTransactionLedger({ order, role: 'buyer' })
    expect(v.stage).toBe('fulfillment')
    expect(v.badge).toBe('Pago confirmado')
    expect(v.timeline.find(r => r.key === 'payment')?.status).toBe('done')
  })
})

test.describe('transaction-ledger · refund stage (Epic B, null-safe)', () => {
  test('return requested → refund dominates, seller responds', () => {
    const order: LedgerOrder = {
      payment_method: 'spei', payment_received: true, status: 'delivered',
      return_request: { status: 'requested' },
    }
    const v = buildTransactionLedger({ order, role: 'seller' })
    expect(v.stage).toBe('refund')
    expect(v.badge).toBe('Devolución solicitada')
    expect(v.action).toEqual({ kind: 'respond-refund', label: 'Responder devolución' })
    expect(v.timeline.find(r => r.key === 'refund')?.status).toBe('current')
  })

  test('off-platform transfer pending → buyer confirms receipt', () => {
    const order: LedgerOrder = {
      payment_method: 'spei', payment_received: true, status: 'delivered',
      return_request: { status: 'accepted', refund_status: 'manual', transfer_sent_at: PAST },
    }
    const v = buildTransactionLedger({ order, role: 'buyer' })
    expect(v.badge).toBe('Transferencia pendiente')
    expect(v.action).toEqual({ kind: 'confirm-refund', label: 'Confirmar reembolso' })
  })

  test('confirmed refund → terminal, no action; row done', () => {
    const order: LedgerOrder = {
      payment_method: 'spei', status: 'delivered',
      return_request: { status: 'refunded', refund_status: 'manual', buyer_confirmed_at: PAST },
    }
    const v = buildTransactionLedger({ order, role: 'buyer' })
    expect(v.badge).toBe('Reembolso confirmado')
    expect(v.action).toBeNull()
    expect(v.timeline.find(r => r.key === 'refund')?.status).toBe('done')
  })

  test('explicit refundState override is honoured over the order', () => {
    const v = buildTransactionLedger({ order: { payment_method: 'spei', status: 'delivered' }, refundState: 'solicitado', role: 'seller' })
    expect(v.stage).toBe('refund')
  })
})

test.describe('transaction-ledger · timeline ordering', () => {
  test('full deal renders negotiation → payment → fulfillment → refund in order', () => {
    const v = buildTransactionLedger({
      offer: offer({ status: 'accepted' }),
      order: {
        payment_method: 'spei', payment_received: true, status: 'delivered',
        return_request: { status: 'requested' },
      },
      role: 'seller',
    })
    expect(v.timeline.map(r => r.key)).toEqual(['negotiation', 'payment', 'fulfillment', 'refund'])
  })
})
