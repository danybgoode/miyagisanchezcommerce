/**
 * Refund-state machine — the single vocabulary for the two-sided, off-platform-aware
 * refund lifecycle. Pure + next-free so it unit-tests with no network/auth, and so the
 * buyer view, seller view, inbox, and (mirrored) the backend order normalizer all read
 * ONE source of truth instead of an overstated "Reembolso emitido".
 *
 * Lifecycle (SPEI / cash — off-platform money):
 *   solicitado → aceptado → transferencia_pendiente → confirmado   (+ rechazado)
 *
 *   solicitado               buyer asked for a refund; the seller hasn't acted.
 *   aceptado                 seller agreed; for SPEI/cash the money has NOT left yet.
 *   transferencia_pendiente  seller pressed "Ya transferí" — awaiting the buyer's "Recibí".
 *   confirmado               refund complete. The card/escrow rail auto-confirms (the
 *                            refundPaymentWorkflow ran / the authorization was voided);
 *                            the SPEI/cash rail only confirms when the BUYER says "Recibí",
 *                            never on the seller's say-so.
 *   rechazado                seller declined.
 *
 * Card / escrow refunds execute on-platform, so they jump straight to `confirmado`
 * (solicitado → confirmado) the moment the workflow/void succeeds. The off-platform
 * SPEI/cash rail walks the full ladder. Mirrors lib/manual-payment-state.ts.
 *
 * Commerce state lives in Medusa (`order.metadata.return_request`); this module only
 * *reads* and *names* it. The backend `normalizeMedusaOrder` mirrors `deriveRefundState`
 * inline so the UCP/MCP order object an agent reads carries the same `refund_state`.
 * Copy is es-MX to match the live app.
 */

export type RefundState =
  | 'none'
  | 'solicitado'
  | 'aceptado'
  | 'transferencia_pendiente'
  | 'confirmado'
  | 'rechazado'

export type RefundRole = 'buyer' | 'seller'

// ── Derivation ──────────────────────────────────────────────────────────────────

/**
 * The `order.metadata.return_request` record this machine reads. Only the fields the
 * derivation needs are typed; the persisted record carries more (reason, amounts, …).
 */
export interface ReturnRequestLike {
  /** requested | accepted | declined | refunded (the existing return-request status). */
  status?: string | null
  /** null | pending | voiding | voided | manual | refunded | failed (existing refund_status). */
  refund_status?: string | null
  /** Seller pressed "Ya transferí" on the off-platform (SPEI/cash) rail. */
  transfer_sent_at?: string | null
  /** Buyer pressed "Recibí el reembolso" — the only close for the off-platform rail. */
  buyer_confirmed_at?: string | null
  /** Legacy completion marker (pre-machine SPEI/cash records set this on accept). */
  refunded_at?: string | null
}

/**
 * Derive the canonical refund state from the persisted return-request record.
 *
 * Precedence: declined/requested short-circuit first; then the card/escrow rails that
 * actually moved money read `confirmado`; then the off-platform SPEI/cash rail walks the
 * ladder via `transfer_sent_at` / `buyer_confirmed_at`. Pure + method-agnostic.
 */
export function deriveRefundState(rr: ReturnRequestLike | null | undefined): RefundState {
  if (!rr || !rr.status) return 'none'

  if (rr.status === 'requested') return 'solicitado'
  if (rr.status === 'declined') return 'rechazado'

  // status is 'accepted' or 'refunded' from here.
  const refundStatus = rr.refund_status ?? null

  // Card / escrow rails moved (or released) the money on-platform → done.
  if (refundStatus === 'refunded' || refundStatus === 'voided') return 'confirmado'

  // Off-platform SPEI/cash ladder — only the buyer's confirmation closes it.
  if (refundStatus === 'manual') {
    if (rr.buyer_confirmed_at) return 'confirmado'
    // `refunded_at` covers legacy records written before this machine existed: the old
    // accept path stamped it on a SPEI/cash refund, so honour it as "transfer recorded,
    // awaiting the buyer's confirmation" rather than re-opening it as merely accepted.
    if (rr.transfer_sent_at || rr.refunded_at) return 'transferencia_pendiente'
    return 'aceptado'
  }

  // Card refund in flight (pending), escrow voiding, a retryable failure, or no
  // refund_status yet → the seller has accepted but it isn't confirmed.
  return 'aceptado'
}

/**
 * Convenience seam for components/normalizers that hold a (normalized) order. Reads the
 * order's own `refund_state` when the normalizer already emitted it, else derives from
 * `metadata.return_request`. Returns `'none'` when there is no return request.
 */
export function refundStateFromOrder(order: {
  refund_state?: RefundState | null
  return_request?: ReturnRequestLike | null
  metadata?: Record<string, unknown> | null
}): RefundState {
  if (order.refund_state) return order.refund_state
  const meta = (order.metadata ?? {}) as Record<string, unknown>
  const rr = (order.return_request ?? meta.return_request ?? null) as ReturnRequestLike | null
  return deriveRefundState(rr)
}

// ── Transitions (guards) ────────────────────────────────────────────────────────

/**
 * Legal forward moves. `solicitado → confirmado` is the **card/escrow one-shot** (accept
 * runs the refund workflow inline). The off-platform rail must walk `aceptado →
 * transferencia_pendiente → confirmado` — so `aceptado → confirmado` is **rejected**
 * (a seller can't confirm a SPEI/cash refund without the buyer; the acceptance guard).
 */
const TRANSITIONS: Record<RefundState, readonly RefundState[]> = {
  none:                    ['solicitado'],
  solicitado:              ['aceptado', 'rechazado', 'confirmado'],
  aceptado:                ['transferencia_pendiente'],
  transferencia_pendiente: ['confirmado'],
  confirmado:              [],
  rechazado:               [],
}

export function canTransition(from: RefundState, to: RefundState): boolean {
  if (from === to) return true
  return TRANSITIONS[from]?.includes(to) ?? false
}

/** A seller may mark "Ya transferí" only on an off-platform refund they've accepted. */
export function canSellerMarkTransferred(state: RefundState): boolean {
  return state === 'aceptado'
}

/** A buyer may confirm receipt only once the seller has marked the transfer sent. */
export function canBuyerConfirmReceipt(state: RefundState): boolean {
  return state === 'transferencia_pendiente'
}

// ── Copy (es-MX, honest — never "emitido" before `confirmado`) ─────────────────────

const STATE_BADGE: Record<RefundState, string> = {
  none:                    'Sin devolución',
  solicitado:              'Devolución solicitada',
  aceptado:                'Reembolso aceptado',
  transferencia_pendiente: 'Transferencia pendiente',
  confirmado:              'Reembolso confirmado',
  rechazado:               'Devolución rechazada',
}

/** Short badge label for a refund state (es-MX). */
export function refundBadge(state: RefundState): string {
  return STATE_BADGE[state]
}

const WHO_ACTS_NEXT: Record<RefundState, Record<RefundRole, string>> = {
  none: {
    buyer:  '',
    seller: '',
  },
  solicitado: {
    buyer:  'Esperando respuesta del vendedor',
    seller: 'Responde a la solicitud de devolución',
  },
  aceptado: {
    buyer:  'El vendedor hará la transferencia del reembolso',
    seller: 'Haz la transferencia y marca "Ya transferí"',
  },
  transferencia_pendiente: {
    buyer:  'Confirma cuando recibas el reembolso',
    seller: 'Esperando que el comprador confirme el reembolso',
  },
  confirmado: {
    buyer:  'Reembolso confirmado',
    seller: 'Reembolso confirmado',
  },
  rechazado: {
    buyer:  'El vendedor rechazó la devolución',
    seller: 'Rechazaste la devolución',
  },
}

/** The next-actor line for a given state + role (es-MX). */
export function whoActsNextRefund(state: RefundState, role: RefundRole): string {
  return WHO_ACTS_NEXT[state][role]
}

const STATE_DETAIL: Record<RefundState, string> = {
  none:                    '',
  solicitado:              'El comprador solicitó una devolución.',
  aceptado:                'Aceptaste el reembolso. Envía la transferencia al comprador y marca "Ya transferí".',
  transferencia_pendiente: 'Transferencia registrada — esperando que el comprador confirme que la recibió.',
  confirmado:              'Reembolso confirmado por el comprador.',
  rechazado:               'La solicitud de devolución fue rechazada.',
}

/** A one-line, state-driven explanation (es-MX) for the order detail surfaces. */
export function refundStateDetail(state: RefundState): string {
  return STATE_DETAIL[state]
}
