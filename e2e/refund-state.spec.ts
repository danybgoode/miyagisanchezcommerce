import { test, expect } from '@playwright/test'
import {
  deriveRefundState,
  refundStateFromOrder,
  canTransition,
  canSellerMarkTransferred,
  canBuyerConfirmReceipt,
  refundBadge,
  whoActsNextRefund,
  refundStateDetail,
  type RefundState,
} from '../lib/refund-state'

// Pure-logic spec — no auth, no network. Proves the two-sided off-platform refund
// machine (lib/refund-state.ts) that the buyer view, seller view, inbox, and the
// backend normalizer all read. Mirrors manual-payment-state.spec.ts.

test.describe('refund-state · derivation', () => {
  test('no return request → none', () => {
    expect(deriveRefundState(null)).toBe('none')
    expect(deriveRefundState(undefined)).toBe('none')
    expect(deriveRefundState({})).toBe('none')
  })

  test('buyer requested, seller idle → solicitado', () => {
    expect(deriveRefundState({ status: 'requested' })).toBe('solicitado')
  })

  test('seller declined → rechazado', () => {
    expect(deriveRefundState({ status: 'declined' })).toBe('rechazado')
  })

  test('card refund executed → confirmado (auto)', () => {
    expect(deriveRefundState({ status: 'refunded', refund_status: 'refunded' })).toBe('confirmado')
  })

  test('escrow authorization voided → confirmado (auto)', () => {
    expect(deriveRefundState({ status: 'refunded', refund_status: 'voided' })).toBe('confirmado')
  })

  test('card refund in flight / retryable failure → aceptado (not yet confirmed)', () => {
    expect(deriveRefundState({ status: 'accepted', refund_status: 'pending' })).toBe('aceptado')
    expect(deriveRefundState({ status: 'accepted', refund_status: 'voiding' })).toBe('aceptado')
    expect(deriveRefundState({ status: 'accepted', refund_status: 'failed' })).toBe('aceptado')
    expect(deriveRefundState({ status: 'accepted', refund_status: null })).toBe('aceptado')
  })

  test('SPEI/cash: accepted but not yet transferred → aceptado', () => {
    expect(deriveRefundState({ status: 'accepted', refund_status: 'manual' })).toBe('aceptado')
  })

  test('SPEI/cash: seller marked "Ya transferí" → transferencia_pendiente', () => {
    expect(deriveRefundState({
      status: 'accepted', refund_status: 'manual', transfer_sent_at: '2026-06-08T00:00:00Z',
    })).toBe('transferencia_pendiente')
  })

  test('SPEI/cash: buyer confirmed receipt → confirmado', () => {
    expect(deriveRefundState({
      status: 'refunded', refund_status: 'manual',
      transfer_sent_at: '2026-06-08T00:00:00Z', buyer_confirmed_at: '2026-06-08T01:00:00Z',
    })).toBe('confirmado')
  })

  test('legacy SPEI/cash record (refunded_at, no machine fields) → transferencia_pendiente, not confirmado', () => {
    // The old accept path stamped status:refunded + refund_status:manual + refunded_at
    // without ever asking the buyer. Honour it as "awaiting confirmation", not done.
    expect(deriveRefundState({
      status: 'refunded', refund_status: 'manual', refunded_at: '2026-01-01T00:00:00Z',
    })).toBe('transferencia_pendiente')
  })
})

test.describe('refund-state · refundStateFromOrder seam', () => {
  test('prefers the normalizer-emitted refund_state', () => {
    expect(refundStateFromOrder({ refund_state: 'transferencia_pendiente' })).toBe('transferencia_pendiente')
  })

  test('falls back to metadata.return_request', () => {
    expect(refundStateFromOrder({
      metadata: { return_request: { status: 'requested' } },
    })).toBe('solicitado')
  })

  test('falls back to a top-level return_request', () => {
    expect(refundStateFromOrder({
      return_request: { status: 'accepted', refund_status: 'manual' },
    })).toBe('aceptado')
  })

  test('no return data anywhere → none', () => {
    expect(refundStateFromOrder({})).toBe('none')
  })
})

test.describe('refund-state · transition guards', () => {
  test('legal off-platform ladder', () => {
    expect(canTransition('solicitado', 'aceptado')).toBe(true)
    expect(canTransition('aceptado', 'transferencia_pendiente')).toBe(true)
    expect(canTransition('transferencia_pendiente', 'confirmado')).toBe(true)
    expect(canTransition('solicitado', 'rechazado')).toBe(true)
  })

  test('card one-shot: solicitado → confirmado is legal', () => {
    expect(canTransition('solicitado', 'confirmado')).toBe(true)
  })

  test('THE GUARD: aceptado → confirmado (skipping transferencia_pendiente) is rejected', () => {
    expect(canTransition('aceptado', 'confirmado')).toBe(false)
  })

  test('terminal states do not advance', () => {
    expect(canTransition('confirmado', 'aceptado')).toBe(false)
    expect(canTransition('rechazado', 'aceptado')).toBe(false)
  })

  test('identity is always allowed (idempotent re-writes)', () => {
    const all: RefundState[] = ['none', 'solicitado', 'aceptado', 'transferencia_pendiente', 'confirmado', 'rechazado']
    for (const s of all) expect(canTransition(s, s)).toBe(true)
  })

  test('action gates match the ladder', () => {
    expect(canSellerMarkTransferred('aceptado')).toBe(true)
    expect(canSellerMarkTransferred('transferencia_pendiente')).toBe(false)
    expect(canSellerMarkTransferred('solicitado')).toBe(false)
    expect(canBuyerConfirmReceipt('transferencia_pendiente')).toBe(true)
    expect(canBuyerConfirmReceipt('aceptado')).toBe(false)
  })
})

test.describe('refund-state · copy completeness (es-MX, honest)', () => {
  const states: RefundState[] = ['none', 'solicitado', 'aceptado', 'transferencia_pendiente', 'confirmado', 'rechazado']

  test('every state has a badge', () => {
    for (const s of states) expect(refundBadge(s).length).toBeGreaterThan(0)
  })

  test('every actionable state has both buyer + seller next-actor copy', () => {
    for (const s of states.filter(s => s !== 'none')) {
      expect(whoActsNextRefund(s, 'buyer').length).toBeGreaterThan(0)
      expect(whoActsNextRefund(s, 'seller').length).toBeGreaterThan(0)
    }
  })

  test('honest: "emitido"/"confirmado" never appears before the refund is actually confirmed', () => {
    for (const s of ['solicitado', 'aceptado', 'transferencia_pendiente'] as RefundState[]) {
      expect(refundBadge(s).toLowerCase()).not.toContain('emitido')
      expect(refundBadge(s).toLowerCase()).not.toContain('confirmado')
      expect(refundStateDetail(s).toLowerCase()).not.toContain('emitido')
    }
    expect(refundBadge('confirmado').toLowerCase()).toContain('confirmado') // "Reembolso confirmado"
  })

  test('transferencia_pendiente copy names the pending transfer + the buyer-confirms close', () => {
    expect(refundBadge('transferencia_pendiente').toLowerCase()).toContain('pendiente')
    expect(whoActsNextRefund('transferencia_pendiente', 'buyer').toLowerCase()).toContain('confirma')
  })
})
